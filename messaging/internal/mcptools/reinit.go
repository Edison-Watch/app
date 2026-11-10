package mcptools

import (
	"bufio"
	"bytes"
	"encoding/json"
	"io"
	"sync"
)

// ReinitShim sits on the stdio stream between sealgate-stdiod and the MCP
// server.
//
// The daemon keeps this process running for as long as the server is
// enabled and pipes every gateway connection into the same stdin/stdout.
// When the gateway reconnects it sends a fresh "initialize" on that stream.
// The Node and Python SDKs answer a repeated initialize; the Go SDK rejects
// it ("duplicate initialize received"). The shim lets the first initialize
// through, remembers the server's answer, and answers later ones itself with
// the same result, dropping their "notifications/initialized" follow-up.
type ReinitShim struct {
	in  *io.PipeReader
	out *shimWriter
}

type rpcHead struct {
	ID     json.RawMessage `json:"id,omitempty"`
	Method string          `json:"method,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
}

type shimWriter struct {
	w  io.WriteCloser
	mu sync.Mutex

	stateMu  sync.Mutex
	initID   json.RawMessage
	initRes  json.RawMessage
	resReady chan struct{}
	buf      []byte
}

// Write passes the server's output through, watching for the answer to the
// first initialize. The SDK writes one JSON message per line.
func (s *shimWriter) Write(p []byte) (int, error) {
	s.buf = append(s.buf, p...)
	for {
		i := bytes.IndexByte(s.buf, '\n')
		if i < 0 {
			break
		}
		line := s.buf[:i]
		s.stateMu.Lock()
		if s.initRes == nil && s.initID != nil {
			var h rpcHead
			if json.Unmarshal(line, &h) == nil && bytes.Equal(h.ID, s.initID) && h.Result != nil {
				s.initRes = append(json.RawMessage{}, h.Result...)
				close(s.resReady)
			}
		}
		s.stateMu.Unlock()
		s.buf = s.buf[i+1:]
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.w.Write(p)
}

func (s *shimWriter) Close() error { return s.w.Close() }

func (s *shimWriter) reply(id, result json.RawMessage) {
	msg, _ := json.Marshal(map[string]any{"jsonrpc": "2.0", "id": id, "result": result})
	s.mu.Lock()
	defer s.mu.Unlock()
	_, _ = s.w.Write(append(msg, '\n'))
}

// NewReinitShim wraps the given input and output streams.
func NewReinitShim(in io.Reader, out io.WriteCloser) *ReinitShim {
	pr, pw := io.Pipe()
	sw := &shimWriter{w: out, resReady: make(chan struct{})}
	go func() {
		sc := bufio.NewScanner(in)
		sc.Buffer(make([]byte, 64*1024), 64<<20)
		seenInit, dropInitialized := false, false
		for sc.Scan() {
			line := sc.Bytes()
			var h rpcHead
			_ = json.Unmarshal(line, &h)
			switch {
			case h.Method == "initialize" && !seenInit:
				seenInit = true
				sw.stateMu.Lock()
				sw.initID = append(json.RawMessage{}, h.ID...)
				sw.stateMu.Unlock()
			case h.Method == "initialize":
				<-sw.resReady
				sw.reply(h.ID, sw.initRes)
				dropInitialized = true
				continue
			case h.Method == "notifications/initialized" && dropInitialized:
				dropInitialized = false
				continue
			}
			if _, err := pw.Write(append(append([]byte{}, line...), '\n')); err != nil {
				return
			}
		}
		_ = pw.CloseWithError(sc.Err())
	}()
	return &ReinitShim{in: pr, out: sw}
}

func (r *ReinitShim) Reader() io.ReadCloser  { return r.in }
func (r *ReinitShim) Writer() io.WriteCloser { return r.out }
