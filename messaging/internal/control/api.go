// Package control serves the local API the desktop app uses to manage
// messaging: which networks exist, adding and removing accounts, and stepping
// through logins. It listens on loopback only and requires a bearer token
// that is written, with the address, to control.json in the data directory
// (readable only by the user). Credentials typed during login therefore go
// from the desktop app straight to this process, never through SealGate.
package control

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/rs/zerolog"
	"maunium.net/go/mautrix/bridgev2"

	"github.com/Edison-Watch/app/messaging/internal/host"
)

type Info struct {
	URL     string `json:"url"`
	Token   string `json:"token"`
	PID     int    `json:"pid"`
	Version string `json:"version"`
}

type Server struct {
	h       *host.Host
	log     zerolog.Logger
	token   string
	srv     *http.Server
	path    string
	version string
}

func InfoPath(dataDir string) string { return filepath.Join(dataDir, "control.json") }

func Start(h *host.Host, log zerolog.Logger, version string) (*Server, error) {
	tok := make([]byte, 24)
	_, _ = rand.Read(tok)
	s := &Server{h: h, log: log, token: hex.EncodeToString(tok), path: InfoPath(h.DataDir), version: version}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, err
	}
	s.srv = &http.Server{Handler: s.routes(), ReadHeaderTimeout: 10 * time.Second}
	go func() {
		if err := s.srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Err(err).Msg("control API stopped")
		}
	}()
	info := Info{URL: "http://" + ln.Addr().String(), Token: s.token, PID: os.Getpid(), Version: version}
	data, _ := json.Marshal(info)
	tmp := s.path + ".tmp"
	if err = os.WriteFile(tmp, data, 0o600); err != nil {
		return nil, err
	}
	if err = os.Rename(tmp, s.path); err != nil {
		return nil, err
	}
	log.Info().Str("url", info.URL).Msg("control API listening")
	return s, nil
}

func (s *Server) Stop() {
	_ = os.Remove(s.path)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	_ = s.srv.Shutdown(ctx)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, code int, err error) {
	writeJSON(w, code, map[string]string{"error": err.Error()})
}

func (s *Server) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if subtle.ConstantTimeCompare([]byte(got), []byte(s.token)) != 1 {
			writeErr(w, http.StatusUnauthorized, errors.New("missing or wrong token"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

type networkView struct {
	ID    string              `json:"id"`
	Name  string              `json:"name"`
	Flows []bridgev2.LoginFlow `json:"flows"`
}

var ircNameRe = regexp.MustCompile(`^[a-z0-9-]{1,32}$`)

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /v1/status", func(w http.ResponseWriter, r *http.Request) {
		var nets []networkView
		for _, b := range s.h.Bridges() {
			nets = append(nets, networkView{ID: b.Net.ID(), Name: b.Net.DisplayName(), Flows: b.Logins.Flows()})
		}
		accts := s.h.Accounts()
		if accts == nil {
			accts = []*host.Account{}
		}
		writeJSON(w, 200, map[string]any{"version": s.version, "networks": nets, "accounts": accts})
	})
	mux.HandleFunc("POST /v1/logins", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Network string `json:"network"`
			Flow    string `json:"flow"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeErr(w, 400, err)
			return
		}
		b, err := s.h.Bridge(req.Network)
		if err != nil {
			writeErr(w, 404, err)
			return
		}
		if req.Flow == "" {
			if flows := b.Logins.Flows(); len(flows) > 0 {
				req.Flow = flows[0].ID
			}
		}
		st, err := b.Logins.Start(req.Flow)
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		writeJSON(w, 200, st)
	})
	getProc := func(w http.ResponseWriter, r *http.Request) (*host.Bridge, *host.LoginProc, bool) {
		b, err := s.h.Bridge(r.PathValue("network"))
		if err != nil {
			writeErr(w, 404, err)
			return nil, nil, false
		}
		lp, err := b.Logins.Get(r.PathValue("id"))
		if err != nil {
			writeErr(w, 404, err)
			return nil, nil, false
		}
		return b, lp, true
	}
	mux.HandleFunc("GET /v1/logins/{network}/{id}", func(w http.ResponseWriter, r *http.Request) {
		if _, lp, ok := getProc(w, r); ok {
			writeJSON(w, 200, lp.State())
		}
	})
	mux.HandleFunc("POST /v1/logins/{network}/{id}", func(w http.ResponseWriter, r *http.Request) {
		_, lp, ok := getProc(w, r)
		if !ok {
			return
		}
		var values map[string]string
		if err := json.NewDecoder(r.Body).Decode(&values); err != nil {
			writeErr(w, 400, err)
			return
		}
		st, err := lp.Submit(values)
		if err != nil {
			writeErr(w, 400, err)
			return
		}
		writeJSON(w, 200, st)
	})
	mux.HandleFunc("DELETE /v1/logins/{network}/{id}", func(w http.ResponseWriter, r *http.Request) {
		if b, lp, ok := getProc(w, r); ok {
			b.Logins.Cancel(lp.ID)
			writeJSON(w, 200, map[string]bool{"ok": true})
		}
	})
	mux.HandleFunc("DELETE /v1/accounts/{id}", func(w http.ResponseWriter, r *http.Request) {
		if err := s.h.Logout(r.Context(), r.PathValue("id")); err != nil {
			writeErr(w, 404, err)
			return
		}
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	// IRC is the one network whose servers are configurable: the user names
	// the server to connect to. Other networks have a fixed service.
	mux.HandleFunc("GET /v1/irc/networks", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"networks": s.h.Config.IRC.Networks})
	})
	mux.HandleFunc("PUT /v1/irc/networks/{name}", func(w http.ResponseWriter, r *http.Request) {
		name := r.PathValue("name")
		if !ircNameRe.MatchString(name) {
			writeErr(w, 400, errors.New("name must be lowercase letters, digits and dashes"))
			return
		}
		var n host.IRCNetwork
		if err := json.NewDecoder(r.Body).Decode(&n); err != nil {
			writeErr(w, 400, err)
			return
		}
		if _, _, err := net.SplitHostPort(n.Address); err != nil {
			writeErr(w, 400, errors.New("address must be host:port"))
			return
		}
		if n.DisplayName == "" {
			n.DisplayName = name
		}
		b, err := s.h.Bridge("irc")
		if err != nil {
			writeErr(w, 404, err)
			return
		}
		s.h.Config.IRC.Networks[name] = &n
		if err = s.h.Config.Save(); err != nil {
			writeErr(w, 500, err)
			return
		}
		b.Net.(*host.IRC).SetNetwork(name, &n)
		writeJSON(w, 200, map[string]bool{"ok": true})
	})
	return s.auth(mux)
}
