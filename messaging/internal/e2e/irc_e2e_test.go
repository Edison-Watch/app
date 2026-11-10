// End-to-end test against a real IRC server. It needs one listening on
// SEALGATE_TEST_IRC_ADDR (testing/run-ergo.sh starts ergo on 127.0.0.1:6667)
// and is skipped otherwise.
//
// The flow mirrors what a user and an agent do: add the server and log in
// through the control API, then join a channel, read, reply, react, DM and
// search through the MCP tools, with a separate IRC client on the other end.
package e2e

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/rs/zerolog"

	"github.com/Edison-Watch/app/messaging/internal/control"
	"github.com/Edison-Watch/app/messaging/internal/host"
	"github.com/Edison-Watch/app/messaging/internal/mcptools"
)

type peer struct {
	t    *testing.T
	conn net.Conn
	mu   sync.Mutex
	seen []string
}

func dialPeer(t *testing.T, addr, nick string) *peer {
	c, err := net.DialTimeout("tcp", addr, 5*time.Second)
	if err != nil {
		t.Fatalf("dial IRC: %v", err)
	}
	p := &peer{t: t, conn: c}
	go func() {
		sc := bufio.NewScanner(c)
		for sc.Scan() {
			line := sc.Text()
			if strings.HasPrefix(line, "PING") {
				p.send("PONG" + strings.TrimPrefix(line, "PING"))
			}
			p.mu.Lock()
			p.seen = append(p.seen, line)
			p.mu.Unlock()
		}
	}()
	p.send("NICK " + nick)
	p.send("USER " + nick + " 0 * :" + nick)
	p.waitFor(" 001 ", 10*time.Second)
	t.Cleanup(func() { p.send("QUIT :done"); _ = c.Close() })
	return p
}

func (p *peer) send(line string) { _, _ = fmt.Fprintf(p.conn, "%s\r\n", line) }

func (p *peer) waitFor(substr string, timeout time.Duration) string {
	p.t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		p.mu.Lock()
		for _, l := range p.seen {
			if strings.Contains(l, substr) {
				p.mu.Unlock()
				return l
			}
		}
		p.mu.Unlock()
		time.Sleep(100 * time.Millisecond)
	}
	p.t.Fatalf("peer never saw %q", substr)
	return ""
}

type ctl struct {
	t    *testing.T
	info control.Info
}

func (c *ctl) do(method, path string, body any, out any) int {
	c.t.Helper()
	var r io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		r = bytes.NewReader(data)
	}
	req, _ := http.NewRequest(method, c.info.URL+path, r)
	req.Header.Set("Authorization", "Bearer "+c.info.Token)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer resp.Body.Close()
	if out != nil {
		_ = json.NewDecoder(resp.Body).Decode(out)
	}
	return resp.StatusCode
}

func call(t *testing.T, s *mcp.ClientSession, tool string, args map[string]any, out any) {
	t.Helper()
	res, err := s.CallTool(context.Background(), &mcp.CallToolParams{Name: tool, Arguments: args})
	if err != nil {
		t.Fatalf("%s: %v", tool, err)
	}
	text := res.Content[0].(*mcp.TextContent).Text
	if res.IsError {
		t.Fatalf("%s returned an error: %s", tool, text)
	}
	if out != nil {
		if err = json.Unmarshal([]byte(text), out); err != nil {
			t.Fatalf("%s: bad JSON %q: %v", tool, text, err)
		}
	}
}

type chatsOut struct {
	Chats []*host.Chat `json:"chats"`
}

type msgsOut struct {
	Messages []*host.Message `json:"messages"`
}

func eventually(t *testing.T, what string, fn func() bool) {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		if fn() {
			return
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func TestIRCEndToEnd(t *testing.T) {
	addr := os.Getenv("SEALGATE_TEST_IRC_ADDR")
	if addr == "" {
		t.Skip("SEALGATE_TEST_IRC_ADDR not set; start testing/run-ergo.sh")
	}
	suffix := fmt.Sprintf("%d", time.Now().UnixNano()%100000)
	myNick, peerNick, channel := "sg"+suffix, "alice"+suffix, "#sgtest"+suffix

	dir := t.TempDir()
	log := zerolog.New(zerolog.NewTestWriter(t)).Level(zerolog.WarnLevel)
	h, err := host.New(dir, log, host.NewIRC())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(func() { cancel(); h.Stop() })
	if err = h.Start(ctx); err != nil {
		t.Fatal(err)
	}
	srv, err := control.Start(h, log, "test")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(srv.Stop)
	var info control.Info
	data, _ := os.ReadFile(control.InfoPath(dir))
	_ = json.Unmarshal(data, &info)
	c := &ctl{t: t, info: info}

	// The control API refuses calls without the token.
	resp, _ := http.Get(info.URL + "/v1/status")
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status without token: got %d, want 401", resp.StatusCode)
	}

	// Add the test server and log in, as the desktop app does.
	if code := c.do("PUT", "/v1/irc/networks/localtest", map[string]any{"displayname": "Local test IRC", "address": addr}, nil); code != 200 {
		t.Fatalf("add network: %d", code)
	}
	var login host.LoginState
	c.do("POST", "/v1/logins", map[string]string{"network": "irc"}, &login)
	if login.Step == nil || login.Step.UserInputParams == nil {
		t.Fatalf("first login step is not user input: %+v", login)
	}
	c.do("POST", "/v1/logins/irc/"+login.ID, map[string]string{"network": "localtest", "nick": myNick, "credentials": ":"}, &login)
	if !login.Done || login.Account == "" {
		t.Fatalf("login did not complete: %+v", login)
	}
	account := login.Account

	mcpSrv := mcp.NewServer(&mcp.Implementation{Name: "sealgate-messaging", Version: "test"}, nil)
	mcptools.Register(mcpSrv, h)
	st, ct := mcp.NewInMemoryTransports()
	go func() { _ = mcpSrv.Run(ctx, st) }()
	sess, err := mcp.NewClient(&mcp.Implementation{Name: "e2e", Version: "test"}, nil).Connect(ctx, ct, nil)
	if err != nil {
		t.Fatal(err)
	}

	eventually(t, "account connected", func() bool {
		var out struct {
			Accounts []*host.Account `json:"accounts"`
		}
		call(t, sess, "list_accounts", nil, &out)
		return len(out.Accounts) == 1 && out.Accounts[0].State == "CONNECTED"
	})

	// The agent joins a channel; the peer joins and talks.
	var started struct {
		Chat *host.Chat `json:"chat"`
	}
	call(t, sess, "start_chat", map[string]any{"account": account, "identifier": channel}, &started)
	chanID := started.Chat.ID
	p := dialPeer(t, addr, peerNick)
	p.send("JOIN " + channel)
	p.waitFor(" JOIN ", 5*time.Second)
	p.send("PRIVMSG " + channel + " :status report: the build is green")
	p.send("PRIVMSG " + myNick + " :can you check the deploy?")

	var msgs msgsOut
	eventually(t, "channel message", func() bool {
		call(t, sess, "get_messages", map[string]any{"chat_id": chanID}, &msgs)
		return len(msgs.Messages) > 0 && msgs.Messages[len(msgs.Messages)-1].Text == "status report: the build is green"
	})
	incoming := msgs.Messages[len(msgs.Messages)-1]
	if incoming.Sender != peerNick || incoming.FromMe {
		t.Fatalf("unexpected sender: %+v", incoming)
	}

	// Reply, react, DM.
	var sent struct {
		Message *host.Message `json:"message"`
	}
	call(t, sess, "send_message", map[string]any{"chat_id": chanID, "text": "thanks, noted", "reply_to": incoming.ID}, &sent)
	if sent.Message.Status != "sent" || sent.Message.ReplyTo != incoming.ID {
		t.Fatalf("unexpected sent message: %+v", sent.Message)
	}
	p.waitFor("PRIVMSG "+channel+" :thanks, noted", 10*time.Second)
	call(t, sess, "react_to_message", map[string]any{"chat_id": chanID, "message_id": incoming.ID, "emoji": "👍"}, nil)

	var chats chatsOut
	eventually(t, "DM chat", func() bool {
		call(t, sess, "list_chats", map[string]any{"query": peerNick}, &chats)
		return len(chats.Chats) == 1 && chats.Chats[0].Type == "dm"
	})
	dm := chats.Chats[0]
	if dm.Unread != 1 || dm.LastMessage != "can you check the deploy?" {
		t.Fatalf("unexpected DM chat: %+v", dm)
	}
	call(t, sess, "send_message", map[string]any{"chat_id": dm.ID, "text": "deploy looks fine"}, &sent)
	p.waitFor("PRIVMSG "+peerNick+" :deploy looks fine", 10*time.Second)
	call(t, sess, "mark_chat_read", map[string]any{"chat_id": dm.ID}, nil)
	call(t, sess, "list_chats", map[string]any{"query": peerNick}, &chats)
	if chats.Chats[0].Unread != 0 {
		t.Fatalf("chat still unread after mark_chat_read: %+v", chats.Chats[0])
	}

	// The agent can open a DM itself.
	call(t, sess, "start_chat", map[string]any{"account": account, "identifier": peerNick}, &started)
	if started.Chat.ID != dm.ID {
		t.Fatalf("start_chat with %s returned %s, want existing DM %s", peerNick, started.Chat.ID, dm.ID)
	}

	// Search spans chats and includes our own messages.
	call(t, sess, "search_messages", map[string]any{"query": "deploy"}, &msgs)
	if len(msgs.Messages) != 2 {
		t.Fatalf("search for deploy: got %d results, want 2: %+v", len(msgs.Messages), msgs.Messages)
	}

	// Errors are tool errors, not protocol errors.
	res, err := sess.CallTool(ctx, &mcp.CallToolParams{Name: "send_message", Arguments: map[string]any{"chat_id": "!nope:sealgate.local", "text": "x"}})
	if err != nil || !res.IsError {
		t.Fatalf("sending to an unknown chat should be a tool error, got err=%v res=%+v", err, res)
	}

	// Removing the account through the control API.
	if code := c.do("DELETE", "/v1/accounts/"+account, nil, nil); code != 200 {
		t.Fatalf("logout: %d", code)
	}
	if len(h.Accounts()) != 0 {
		t.Fatalf("account still listed after logout: %+v", h.Accounts())
	}
}
