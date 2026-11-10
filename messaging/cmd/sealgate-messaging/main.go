// sealgate-messaging runs messaging bridges (mautrix network connectors) on
// the user's computer and exposes the chats to SealGate as an MCP server.
//
//	sealgate-messaging mcp     MCP over stdio; what sealgate-stdiod runs
//	sealgate-messaging serve   no stdio; MCP over loopback HTTP (tests, dev)
//	sealgate-messaging version
//
// Both modes run the bridges and the control API the desktop app uses for
// logins. Only one instance may own a data directory at a time.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/gofrs/flock"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/rs/zerolog"

	"github.com/Edison-Watch/app/messaging/internal/control"
	"github.com/Edison-Watch/app/messaging/internal/host"
	"github.com/Edison-Watch/app/messaging/internal/mcptools"
)

var Version = "0.1.0-dev"

func defaultDataDir() string {
	if d := os.Getenv("SEALGATE_MESSAGING_DIR"); d != "" {
		return d
	}
	home, _ := os.UserHomeDir()
	switch runtime.GOOS {
	case "windows":
		if d := os.Getenv("LOCALAPPDATA"); d != "" {
			return filepath.Join(d, "SealGate", "messaging")
		}
		return filepath.Join(home, "AppData", "Local", "SealGate", "messaging")
	case "darwin":
		return filepath.Join(home, "Library", "Application Support", "SealGate", "messaging")
	default:
		if d := os.Getenv("XDG_DATA_HOME"); d != "" {
			return filepath.Join(d, "sealgate", "messaging")
		}
		return filepath.Join(home, ".local", "share", "sealgate", "messaging")
	}
}

func openLog(dataDir, level string) (zerolog.Logger, io.Closer, error) {
	path := filepath.Join(dataDir, "messaging.log")
	if fi, err := os.Stat(path); err == nil && fi.Size() > 20<<20 {
		_ = os.Rename(path, path+".1")
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return zerolog.Nop(), nil, err
	}
	lvl, err := zerolog.ParseLevel(level)
	if err != nil {
		lvl = zerolog.InfoLevel
	}
	// stdout is the MCP channel in mcp mode, so logs go to the file and stderr.
	w := zerolog.MultiLevelWriter(f, zerolog.ConsoleWriter{Out: os.Stderr, TimeFormat: time.TimeOnly})
	return zerolog.New(w).Level(lvl).With().Timestamp().Logger(), f, nil
}

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: sealgate-messaging <mcp|serve|version> [--data DIR] [--log-level LEVEL] [--mcp-http ADDR]")
		os.Exit(2)
	}
	mode := os.Args[1]
	if mode == "version" || mode == "--version" {
		fmt.Println(Version)
		return
	}
	fs := flag.NewFlagSet(mode, flag.ExitOnError)
	dataDir := fs.String("data", defaultDataDir(), "data directory")
	level := fs.String("log-level", "info", "log level")
	mcpHTTP := fs.String("mcp-http", "", "serve mode: also serve MCP over HTTP on this loopback address")
	_ = fs.Parse(os.Args[2:])
	if mode != "mcp" && mode != "serve" {
		fmt.Fprintf(os.Stderr, "unknown command %q\n", mode)
		os.Exit(2)
	}
	if err := run(mode, *dataDir, *level, *mcpHTTP); err != nil {
		fmt.Fprintln(os.Stderr, "sealgate-messaging:", err)
		os.Exit(1)
	}
}

func run(mode, dataDir, level, mcpHTTP string) error {
	if err := os.MkdirAll(dataDir, 0o700); err != nil {
		return err
	}
	lock := flock.New(filepath.Join(dataDir, "lock"))
	ok, err := lock.TryLock()
	if err != nil {
		return err
	} else if !ok {
		return fmt.Errorf("another sealgate-messaging is already running for %s", dataDir)
	}
	defer func() { _ = lock.Unlock() }()

	log, closer, err := openLog(dataDir, level)
	if err != nil {
		return err
	}
	defer closer.Close()
	log.Info().Str("version", Version).Str("mode", mode).Str("data", dataDir).Msg("starting")

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	h, err := host.New(dataDir, log, host.NewIRC())
	if err != nil {
		return err
	}
	defer h.Stop()
	if err = h.Start(ctx); err != nil {
		return err
	}
	ctl, err := control.Start(h, log, Version)
	if err != nil {
		return err
	}
	defer ctl.Stop()

	newServer := func() *mcp.Server {
		s := mcp.NewServer(&mcp.Implementation{Name: "sealgate-messaging", Title: "Messaging", Version: Version}, &mcp.ServerOptions{
			Instructions: "Read and send messages in the chat apps connected on this computer. " +
				"Start with list_chats to find a chat ID, then get_messages or send_message.",
		})
		mcptools.Register(s, h)
		return s
	}

	if mode == "mcp" {
		// The daemon reuses this stdio stream across gateway reconnects; see
		// mcptools.ReinitShim.
		shim := mcptools.NewReinitShim(os.Stdin, os.Stdout)
		err = newServer().Run(ctx, &mcp.IOTransport{Reader: shim.Reader(), Writer: shim.Writer()})
		if err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, io.EOF) {
			log.Err(err).Msg("MCP session ended")
		}
		log.Info().Msg("stdin closed, stopping")
		return nil
	}

	if mcpHTTP != "" {
		host, _, err := net.SplitHostPort(mcpHTTP)
		if err != nil || (host != "127.0.0.1" && host != "localhost" && host != "::1") {
			return errors.New("--mcp-http must be a loopback address")
		}
		srv := mcp.NewServer(&mcp.Implementation{Name: "sealgate-messaging", Version: Version}, nil)
		mcptools.Register(srv, h)
		handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return srv }, nil)
		hs := &http.Server{Addr: mcpHTTP, Handler: handler, ReadHeaderTimeout: 10 * time.Second}
		go func() {
			if err := hs.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Err(err).Msg("MCP HTTP server stopped")
			}
		}()
		defer hs.Close()
		log.Info().Str("addr", mcpHTTP).Msg("MCP over HTTP listening")
	}
	<-ctx.Done()
	log.Info().Msg("signal received, stopping")
	return nil
}
