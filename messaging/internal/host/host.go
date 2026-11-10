// Package host runs every bridge in one process against the local store and
// exposes the operations the MCP tools and the desktop app's control API need:
// accounts, login steps, chats, messages and sending.
package host

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/rs/zerolog"
	"go.mau.fi/util/dbutil"
	"maunium.net/go/mautrix/bridgev2"
	"maunium.net/go/mautrix/bridgev2/bridgeconfig"
	"maunium.net/go/mautrix/bridgev2/commands"
	"maunium.net/go/mautrix/bridgev2/status"
	"maunium.net/go/mautrix/id"

	"github.com/Edison-Watch/app/messaging/internal/localmx"
	"github.com/Edison-Watch/app/messaging/internal/store"
)

// UserMXID is the single local user every bridge acts for.
const UserMXID = id.UserID("@me:" + localmx.ServerName)

// Network is one bridge kind that can be compiled in (IRC, WhatsApp, ...).
type Network interface {
	ID() string
	DisplayName() string
	Connector() bridgev2.NetworkConnector
	// Configure is called before the bridge starts, with the persisted config.
	Configure(cfg *Config) error
}

// ChatJoiner is implemented by networks where joining a chat by name is not
// covered by bridgev2's identifier resolving (IRC channels).
type ChatJoiner interface {
	JoinChat(ctx context.Context, login *bridgev2.UserLogin, name string) error
	IsJoinIdentifier(identifier string) bool
}

type Bridge struct {
	Net    Network
	BR     *bridgev2.Bridge
	MX     *localmx.Connector
	DB     *dbutil.Database
	User   *bridgev2.User
	Logins *LoginManager
}

type Host struct {
	DataDir string
	Log     zerolog.Logger
	Store   *store.Store
	Config  *Config

	bridges     map[string]*Bridge
	bridgeOrder []string

	stateLock sync.Mutex
	states    map[string]status.BridgeState

	waitLock sync.Mutex
	waiters  map[id.EventID]chan *bridgev2.MessageStatus
}

func New(dataDir string, log zerolog.Logger, nets ...Network) (*Host, error) {
	if err := os.MkdirAll(filepath.Join(dataDir, "bridges"), 0o700); err != nil {
		return nil, err
	}
	cfg, err := LoadConfig(dataDir)
	if err != nil {
		return nil, err
	}
	st, err := store.Open(filepath.Join(dataDir, "local.db"))
	if err != nil {
		return nil, err
	}
	h := &Host{
		DataDir: dataDir, Log: log, Store: st, Config: cfg,
		bridges: map[string]*Bridge{},
		states:  map[string]status.BridgeState{},
		waiters: map[id.EventID]chan *bridgev2.MessageStatus{},
	}
	for _, n := range nets {
		if err = h.addBridge(n); err != nil {
			return nil, fmt.Errorf("bridge %s: %w", n.ID(), err)
		}
	}
	return h, nil
}

func bridgeConfig() *bridgeconfig.BridgeConfig {
	return &bridgeconfig.BridgeConfig{
		CommandPrefix:                 "!" ,
		PrivateChatPortalMeta:         true,
		AsyncEvents:                   false,
		BridgeStatusNotices:           "none",
		UnknownErrorAutoReconnect:     30 * time.Second,
		UnknownErrorMaxAutoReconnects: 10,
		BridgeMatrixLeave:             false,
		PortalEventBuffer:             64,
		DeduplicateMatrixMessages:     true,
		Permissions: bridgeconfig.PermissionConfig{
			string(UserMXID): {SendEvents: true, Commands: true, Login: true, DoublePuppet: false, Admin: true, ManageRelay: false, MaxLogins: 0},
		},
		Backfill: bridgeconfig.BackfillConfig{Enabled: false},
	}
}

func (h *Host) addBridge(n Network) error {
	if err := n.Configure(h.Config); err != nil {
		return err
	}
	log := h.Log.With().Str("bridge", n.ID()).Logger()
	dbPath := filepath.Join(h.DataDir, "bridges", n.ID()+".db")
	db, err := dbutil.NewFromConfig("sealgate-messaging", dbutil.Config{PoolConfig: dbutil.PoolConfig{
		Type: "sqlite3-fk-wal", URI: "file:" + dbPath + "?_txlock=immediate", MaxOpenConns: 5, MaxIdleConns: 1,
	}}, dbutil.ZeroLogger(log.With().Str("db_section", "main").Logger()))
	if err != nil {
		return err
	}
	mx := localmx.New(n.ID(), h.Store, localmx.Callbacks{
		BridgeStatus:  h.onBridgeStatus,
		MessageStatus: h.onMessageStatus,
	})
	br := bridgev2.NewBridge("", db, log, bridgeConfig(), mx, n.Connector(), commands.NewProcessor)
	b := &Bridge{Net: n, BR: br, MX: mx, DB: db}
	b.Logins = &LoginManager{b: b, procs: map[string]*LoginProc{}}
	h.bridges[n.ID()] = b
	h.bridgeOrder = append(h.bridgeOrder, n.ID())
	return nil
}

func (h *Host) Start(ctx context.Context) error {
	for _, bid := range h.bridgeOrder {
		b := h.bridges[bid]
		if err := b.BR.StartConnectors(ctx); err != nil {
			return fmt.Errorf("start %s: %w", bid, err)
		}
		user, err := b.BR.GetUserByMXID(ctx, UserMXID)
		if err != nil {
			return err
		}
		b.User = user
		if err = b.BR.StartLogins(ctx); err != nil {
			return fmt.Errorf("start logins %s: %w", bid, err)
		}
		go b.BR.PostStart(ctx)
	}
	return nil
}

func (h *Host) Stop() {
	for _, bid := range h.bridgeOrder {
		h.bridges[bid].BR.StopWithTimeout(5 * time.Second)
	}
	_ = h.Store.Close()
}

func (h *Host) Bridge(id string) (*Bridge, error) {
	b, ok := h.bridges[id]
	if !ok {
		return nil, fmt.Errorf("unknown network %q", id)
	}
	return b, nil
}

func (h *Host) Bridges() []*Bridge {
	out := make([]*Bridge, 0, len(h.bridgeOrder))
	for _, bid := range h.bridgeOrder {
		out = append(out, h.bridges[bid])
	}
	return out
}

func stateKey(bridgeID string, remoteID string) string { return bridgeID + "/" + remoteID }

func (h *Host) onBridgeStatus(bridgeID string, st *status.BridgeState) {
	if st.RemoteID == "" {
		return
	}
	h.stateLock.Lock()
	h.states[stateKey(bridgeID, string(st.RemoteID))] = *st
	h.stateLock.Unlock()
}

func (h *Host) onMessageStatus(bridgeID string, st *bridgev2.MessageStatus, evt *bridgev2.MessageStatusEventInfo) {
	h.waitLock.Lock()
	ch, ok := h.waiters[evt.SourceEventID]
	h.waitLock.Unlock()
	if ok {
		select {
		case ch <- st:
		default:
		}
	}
}

// Account is one logged-in network account.
type Account struct {
	ID          string `json:"id"`
	Network     string `json:"network"`
	NetworkName string `json:"network_name"`
	RemoteName  string `json:"remote_name"`
	State       string `json:"state"`
	Error       string `json:"error,omitempty"`
}

func AccountID(bridgeID, loginID string) string { return bridgeID + ":" + loginID }

func (h *Host) Accounts() []*Account {
	var out []*Account
	for _, b := range h.Bridges() {
		if b.User == nil {
			continue
		}
		for _, ul := range b.User.GetUserLogins() {
			a := &Account{
				ID: AccountID(b.Net.ID(), string(ul.ID)), Network: b.Net.ID(), NetworkName: b.Net.DisplayName(),
				RemoteName: ul.RemoteName, State: "UNKNOWN",
			}
			h.stateLock.Lock()
			if st, ok := h.states[stateKey(b.Net.ID(), string(ul.ID))]; ok {
				a.State = string(st.StateEvent)
				if st.Message != "" {
					a.Error = st.Message
				} else if st.Error != "" {
					a.Error = string(st.Error)
				}
			}
			h.stateLock.Unlock()
			out = append(out, a)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out
}

// FindLogin resolves an account ID ("network:login") to its bridge and login.
func (h *Host) FindLogin(accountID string) (*Bridge, *bridgev2.UserLogin, error) {
	for _, b := range h.Bridges() {
		if b.User == nil {
			continue
		}
		for _, ul := range b.User.GetUserLogins() {
			if AccountID(b.Net.ID(), string(ul.ID)) == accountID {
				return b, ul, nil
			}
		}
	}
	return nil, nil, fmt.Errorf("unknown account %q", accountID)
}

func (h *Host) Logout(ctx context.Context, accountID string) error {
	_, ul, err := h.FindLogin(accountID)
	if err != nil {
		return err
	}
	ul.Logout(ctx)
	return nil
}

var ErrTimeout = errors.New("timed out waiting for the network to accept the message")
