package mcptools

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type echoIn struct {
	Text string `json:"text"`
}

// Two clients handshake on the same stream, as happens when the gateway
// reconnects to a running server through sealgate-stdiod.
func TestReinitShimAnswersRepeatedInitialize(t *testing.T) {
	inR, inW := io.Pipe()
	outR, outW := io.Pipe()
	shim := NewReinitShim(inR, outW)
	s := mcp.NewServer(&mcp.Implementation{Name: "t", Version: "1"}, nil)
	mcp.AddTool(s, &mcp.Tool{Name: "echo"}, func(ctx context.Context, _ *mcp.CallToolRequest, in echoIn) (*mcp.CallToolResult, any, error) {
		return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: in.Text}}}, nil, nil
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { _ = s.Run(ctx, &mcp.IOTransport{Reader: shim.Reader(), Writer: shim.Writer()}) }()

	replies := make(chan map[string]any, 16)
	go func() {
		sc := bufio.NewScanner(outR)
		for sc.Scan() {
			var m map[string]any
			if json.Unmarshal(sc.Bytes(), &m) == nil {
				replies <- m
			}
		}
	}()
	send := func(s string) { _, _ = io.WriteString(inW, s+"\n") }
	next := func() map[string]any {
		select {
		case m := <-replies:
			return m
		case <-time.After(5 * time.Second):
			t.Fatal("no reply")
			return nil
		}
	}
	initReq := `{"jsonrpc":"2.0","id":ID,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"c","version":"1"}}}`
	callReq := `{"jsonrpc":"2.0","id":ID,"method":"tools/call","params":{"name":"echo","arguments":{"text":"call ID"}}}`
	for _, n := range []string{"1", "2"} {
		send(strings.ReplaceAll(initReq, "ID", n))
		if r := next(); mustJSON(r["id"]) != n || r["result"] == nil {
			t.Fatalf("initialize %s: unexpected reply %v", n, r)
		}
		send(`{"jsonrpc":"2.0","method":"notifications/initialized"}`)
		send(strings.ReplaceAll(callReq, "ID", "1"+n))
		if r := next(); mustJSON(r["id"]) != "1"+n || !strings.Contains(mustJSON(r["result"]), "call 1"+n) {
			t.Fatalf("tool call after initialize %s: unexpected reply %v", n, r)
		}
	}
}

func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }
