// Package localmx is a bridgev2 Matrix connector with no Matrix server behind
// it. Where the stock connector turns bridge output into homeserver API calls,
// this one writes rooms, state and events into the local store, so a mautrix
// network connector can run as a plain local process.
package localmx

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/bridgev2"
	"maunium.net/go/mautrix/bridgev2/database"
	"maunium.net/go/mautrix/bridgev2/networkid"
	"maunium.net/go/mautrix/bridgev2/status"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"

	"github.com/Edison-Watch/app/messaging/internal/store"
)

// ServerName is the fake server part of every local Matrix ID.
const ServerName = "sealgate.local"

// Callbacks lets the host observe what the bridge reports.
type Callbacks struct {
	BridgeStatus  func(bridgeID string, state *status.BridgeState)
	MessageStatus func(bridgeID string, st *bridgev2.MessageStatus, evt *bridgev2.MessageStatusEventInfo)
}

type Connector struct {
	BridgeID string
	Store    *store.Store
	Bridge   *bridgev2.Bridge
	CB       Callbacks
}

var _ bridgev2.MatrixConnector = (*Connector)(nil)

func New(bridgeID string, st *store.Store, cb Callbacks) *Connector {
	return &Connector{BridgeID: bridgeID, Store: st, CB: cb}
}

func (c *Connector) Init(br *bridgev2.Bridge)        { c.Bridge = br }
func (c *Connector) Start(ctx context.Context) error { return nil }
func (c *Connector) PreStop()                        {}
func (c *Connector) Stop()                           {}
func (c *Connector) ServerName() string              { return ServerName }

func (c *Connector) GetCapabilities() *bridgev2.MatrixCapabilities {
	return &bridgev2.MatrixCapabilities{
		AutoJoinInvites:       true,
		BatchSending:          false,
		ArbitraryMemberChange: true,
		ExtraProfileMeta:      false,
	}
}

func (c *Connector) ghostPrefix() string { return "@" + c.BridgeID + "_" }

func (c *Connector) FormatGhostMXID(userID networkid.UserID) id.UserID {
	return id.UserID(c.ghostPrefix() + id.EncodeUserLocalpart(string(userID)) + ":" + ServerName)
}

func (c *Connector) ParseGhostMXID(userID id.UserID) (networkid.UserID, bool) {
	localpart, server, err := userID.Parse()
	if err != nil || server != ServerName || !strings.HasPrefix("@"+localpart, c.ghostPrefix()) {
		return "", false
	}
	decoded, err := id.DecodeUserLocalpart(strings.TrimPrefix("@"+localpart, c.ghostPrefix()))
	if err != nil {
		return "", false
	}
	return networkid.UserID(decoded), true
}

func (c *Connector) GhostIntent(userID networkid.UserID) bridgev2.MatrixAPI {
	return &Intent{C: c, MXID: c.FormatGhostMXID(userID)}
}

func (c *Connector) BotIntent() bridgev2.MatrixAPI {
	return &Intent{C: c, MXID: id.UserID("@" + c.BridgeID + "bot:" + ServerName)}
}

func (c *Connector) NewUserIntent(ctx context.Context, userID id.UserID, accessToken string) (bridgev2.MatrixAPI, string, error) {
	// The local user's own messages are stored directly, so there is no
	// double puppet. A nil intent tells the bridge to skip it.
	return nil, accessToken, nil
}

func (c *Connector) SendBridgeStatus(ctx context.Context, state *status.BridgeState) error {
	if c.CB.BridgeStatus != nil {
		c.CB.BridgeStatus(c.BridgeID, state)
	}
	return nil
}

func (c *Connector) SendMessageStatus(ctx context.Context, st *bridgev2.MessageStatus, evt *bridgev2.MessageStatusEventInfo) {
	if c.CB.MessageStatus != nil {
		c.CB.MessageStatus(c.BridgeID, st, evt)
	}
}

const mediaPrefix = "mxc://" + ServerName + "/"

func (c *Connector) GenerateContentURI(ctx context.Context, mediaID networkid.MediaID) (id.ContentURIString, error) {
	return id.ContentURIString(mediaPrefix + "d." + c.BridgeID + "." + base64.RawURLEncoding.EncodeToString(mediaID)), nil
}

func (c *Connector) ParseContentURI(ctx context.Context, uri id.ContentURIString) (networkid.MediaID, error) {
	rest, ok := strings.CutPrefix(string(uri), mediaPrefix+"d."+c.BridgeID+".")
	if !ok {
		return nil, fmt.Errorf("not a direct media URI for %s", c.BridgeID)
	}
	return base64.RawURLEncoding.DecodeString(rest)
}

func (c *Connector) GetPowerLevels(ctx context.Context, roomID id.RoomID) (*event.PowerLevelsEventContent, error) {
	raw, _, err := c.Store.GetState(ctx, string(roomID), event.StatePowerLevels.Type, "")
	pl := &event.PowerLevelsEventContent{}
	if err == nil {
		if err = json.Unmarshal(raw, pl); err != nil {
			return nil, err
		}
		return pl, nil
	} else if !errors.Is(err, store.ErrNotFound) {
		return nil, err
	}
	pl.Users = map[id.UserID]int{c.BotIntent().GetMXID(): 100}
	return pl, nil
}

func (c *Connector) GetMembers(ctx context.Context, roomID id.RoomID) (map[id.UserID]*event.MemberEventContent, error) {
	raw, err := c.Store.GetStateByType(ctx, string(roomID), event.StateMember.Type)
	if err != nil {
		return nil, err
	}
	out := make(map[id.UserID]*event.MemberEventContent, len(raw))
	for key, val := range raw {
		var m event.MemberEventContent
		if json.Unmarshal(val, &m) == nil {
			out[id.UserID(key)] = &m
		}
	}
	return out, nil
}

func (c *Connector) GetMemberInfo(ctx context.Context, roomID id.RoomID, userID id.UserID) (*event.MemberEventContent, error) {
	raw, _, err := c.Store.GetState(ctx, string(roomID), event.StateMember.Type, string(userID))
	if errors.Is(err, store.ErrNotFound) {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	var m event.MemberEventContent
	return &m, json.Unmarshal(raw, &m)
}

func (c *Connector) BatchSend(ctx context.Context, roomID id.RoomID, req *mautrix.ReqBeeperBatchSend, extras []*bridgev2.MatrixSendExtra) (*mautrix.RespBeeperBatchSend, error) {
	return nil, errors.New("batch sending is not supported by the local connector")
}

func hashID(sigil string, parts ...string) string {
	h := sha256.Sum256([]byte(strings.Join(parts, "\x00")))
	return sigil + strings.ToLower(base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(h[:15])) + ":" + ServerName
}

func (c *Connector) GenerateDeterministicRoomID(key networkid.PortalKey) id.RoomID {
	return id.RoomID(hashID("!", c.BridgeID, string(key.ID), string(key.Receiver)))
}

func (c *Connector) GenerateDeterministicEventID(roomID id.RoomID, key networkid.PortalKey, messageID networkid.MessageID, partID networkid.PartID) id.EventID {
	return id.EventID(hashID("$", c.BridgeID, string(roomID), string(messageID), string(partID)))
}

func (c *Connector) GenerateReactionEventID(roomID id.RoomID, target *database.Message, sender networkid.UserID, emojiID networkid.EmojiID) id.EventID {
	return id.EventID(hashID("$", c.BridgeID, "reaction", string(roomID), string(target.ID), string(target.PartID), string(sender), string(emojiID)))
}

// NewEventID returns a random event ID in the local server namespace.
func NewEventID() id.EventID {
	b := make([]byte, 18)
	_, _ = rand.Read(b)
	return id.EventID("$" + base64.RawURLEncoding.EncodeToString(b) + ":" + ServerName)
}

func nowMilli(ts time.Time) int64 {
	if ts.IsZero() {
		return time.Now().UnixMilli()
	}
	return ts.UnixMilli()
}
