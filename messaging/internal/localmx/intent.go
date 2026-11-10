package localmx

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"os"
	"time"

	"maunium.net/go/mautrix"
	"maunium.net/go/mautrix/bridgev2"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"

	"github.com/Edison-Watch/app/messaging/internal/store"
)

// Intent acts as one Matrix user (the bridge bot or a ghost) against the
// local store.
type Intent struct {
	C    *Connector
	MXID id.UserID
}

var _ bridgev2.MatrixAPI = (*Intent)(nil)

func (in *Intent) GetMXID() id.UserID  { return in.MXID }
func (in *Intent) IsDoublePuppet() bool { return false }

func (in *Intent) ensureRoom(ctx context.Context, roomID id.RoomID) error {
	_, err := in.C.Store.GetRoom(ctx, string(roomID))
	if errors.Is(err, store.ErrNotFound) {
		return in.C.Store.CreateRoom(ctx, &store.Room{
			RoomID: string(roomID), Bridge: in.C.BridgeID, Creator: string(in.MXID), CreatedTS: time.Now().UnixMilli(),
		})
	}
	return err
}

func (in *Intent) SendMessage(ctx context.Context, roomID id.RoomID, eventType event.Type, content *event.Content, extra *bridgev2.MatrixSendExtra) (*mautrix.RespSendEvent, error) {
	if err := in.ensureRoom(ctx, roomID); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(content)
	if err != nil {
		return nil, err
	}
	var ts time.Time
	if extra != nil {
		ts = extra.Timestamp
	}
	evtID := NewEventID()
	if eventType == event.EventRedaction {
		target := content.AsRedaction().Redacts
		if target == "" {
			var r struct {
				Redacts id.EventID `json:"redacts"`
			}
			_ = json.Unmarshal(raw, &r)
			target = r.Redacts
		}
		if target != "" {
			if err = in.C.Store.RedactEvent(ctx, string(target)); err != nil {
				return nil, err
			}
		}
	}
	err = in.C.Store.AddEvent(ctx, &store.Event{
		EventID: string(evtID), RoomID: string(roomID), Sender: string(in.MXID),
		Type: eventType.Type, Content: raw, TS: nowMilli(ts),
	})
	if err != nil {
		return nil, err
	}
	return &mautrix.RespSendEvent{EventID: evtID}, nil
}

func (in *Intent) SendState(ctx context.Context, roomID id.RoomID, eventType event.Type, stateKey string, content *event.Content, ts time.Time) (*mautrix.RespSendEvent, error) {
	if err := in.ensureRoom(ctx, roomID); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(content)
	if err != nil {
		return nil, err
	}
	if err = in.C.Store.SetState(ctx, string(roomID), eventType.Type, stateKey, string(in.MXID), raw, nowMilli(ts)); err != nil {
		return nil, err
	}
	return &mautrix.RespSendEvent{EventID: NewEventID()}, nil
}

func (in *Intent) MarkRead(ctx context.Context, roomID id.RoomID, eventID id.EventID, ts time.Time) error {
	return in.C.Store.SetRead(ctx, string(roomID), string(in.MXID), string(eventID), nowMilli(ts))
}

func (in *Intent) MarkUnread(ctx context.Context, roomID id.RoomID, unread bool) error { return nil }

func (in *Intent) MarkTyping(ctx context.Context, roomID id.RoomID, typingType bridgev2.TypingType, timeout time.Duration) error {
	return nil
}

func (in *Intent) DownloadMedia(ctx context.Context, uri id.ContentURIString, file *event.EncryptedFileInfo) ([]byte, error) {
	data, _, _, err := in.C.Store.GetMedia(ctx, string(uri))
	return data, err
}

func (in *Intent) DownloadMediaToFile(ctx context.Context, uri id.ContentURIString, file *event.EncryptedFileInfo, writable bool, callback func(*os.File) error) error {
	data, err := in.DownloadMedia(ctx, uri, file)
	if err != nil {
		return err
	}
	f, err := os.CreateTemp("", "sealgate-media-*")
	if err != nil {
		return err
	}
	defer func() { _ = f.Close(); _ = os.Remove(f.Name()) }()
	if _, err = f.Write(data); err != nil {
		return err
	}
	if _, err = f.Seek(0, io.SeekStart); err != nil {
		return err
	}
	return callback(f)
}

func newMediaURI() id.ContentURIString {
	b := make([]byte, 18)
	_, _ = rand.Read(b)
	return id.ContentURIString(mediaPrefix + "u." + base64.RawURLEncoding.EncodeToString(b))
}

func (in *Intent) UploadMedia(ctx context.Context, roomID id.RoomID, data []byte, fileName, mimeType string) (id.ContentURIString, *event.EncryptedFileInfo, error) {
	uri := newMediaURI()
	return uri, nil, in.C.Store.PutMedia(ctx, string(uri), mimeType, fileName, data)
}

func (in *Intent) UploadMediaStream(ctx context.Context, roomID id.RoomID, size int64, requireFile bool, cb bridgev2.FileStreamCallback) (id.ContentURIString, *event.EncryptedFileInfo, error) {
	f, err := os.CreateTemp("", "sealgate-upload-*")
	if err != nil {
		return "", nil, err
	}
	defer func() { _ = f.Close(); _ = os.Remove(f.Name()) }()
	res, err := cb(f)
	if err != nil {
		return "", nil, err
	}
	var data []byte
	if res.ReplacementFile != "" {
		data, err = os.ReadFile(res.ReplacementFile)
		_ = os.Remove(res.ReplacementFile)
	} else {
		var buf bytes.Buffer
		if _, err = f.Seek(0, io.SeekStart); err == nil {
			_, err = io.Copy(&buf, f)
		}
		data = buf.Bytes()
	}
	if err != nil {
		return "", nil, err
	}
	return in.UploadMedia(ctx, roomID, data, res.FileName, res.MimeType)
}

func (in *Intent) SetDisplayName(ctx context.Context, name string) error {
	return in.C.Store.SetProfile(ctx, string(in.MXID), &name, nil)
}

func (in *Intent) SetAvatarURL(ctx context.Context, avatarURL id.ContentURIString) error {
	s := string(avatarURL)
	return in.C.Store.SetProfile(ctx, string(in.MXID), nil, &s)
}

func (in *Intent) SetExtraProfileMeta(ctx context.Context, data any) error { return nil }
func (in *Intent) SetProfile(ctx context.Context, data any) error          { return nil }

func (in *Intent) member(ctx context.Context, roomID id.RoomID, userID id.UserID) error {
	content := &event.MemberEventContent{
		Membership:  event.MembershipJoin,
		Displayname: in.C.Store.GetDisplayName(ctx, string(userID)),
	}
	raw, _ := json.Marshal(content)
	return in.C.Store.SetState(ctx, string(roomID), event.StateMember.Type, string(userID), string(in.MXID), raw, time.Now().UnixMilli())
}

func (in *Intent) CreateRoom(ctx context.Context, req *mautrix.ReqCreateRoom) (id.RoomID, error) {
	roomID := req.BeeperLocalRoomID
	if roomID == "" {
		b := make([]byte, 15)
		_, _ = rand.Read(b)
		roomID = id.RoomID("!" + base64.RawURLEncoding.EncodeToString(b) + ":" + ServerName)
	}
	now := time.Now().UnixMilli()
	err := in.C.Store.CreateRoom(ctx, &store.Room{
		RoomID: string(roomID), Bridge: in.C.BridgeID, Creator: string(in.MXID), IsDirect: req.IsDirect, CreatedTS: now,
	})
	if err != nil {
		return "", err
	}
	for _, st := range req.InitialState {
		raw, err := json.Marshal(&st.Content)
		if err != nil {
			return "", err
		}
		key := ""
		if st.StateKey != nil {
			key = *st.StateKey
		}
		if err = in.C.Store.SetState(ctx, string(roomID), st.Type.Type, key, string(in.MXID), raw, now); err != nil {
			return "", err
		}
	}
	if req.Name != "" {
		raw, _ := json.Marshal(&event.RoomNameEventContent{Name: req.Name})
		_ = in.C.Store.SetState(ctx, string(roomID), event.StateRoomName.Type, "", string(in.MXID), raw, now)
	}
	if req.Topic != "" {
		raw, _ := json.Marshal(&event.TopicEventContent{Topic: req.Topic})
		_ = in.C.Store.SetState(ctx, string(roomID), event.StateTopic.Type, "", string(in.MXID), raw, now)
	}
	if req.PowerLevelOverride != nil {
		raw, _ := json.Marshal(req.PowerLevelOverride)
		_ = in.C.Store.SetState(ctx, string(roomID), event.StatePowerLevels.Type, "", string(in.MXID), raw, now)
	}
	members := append([]id.UserID{in.MXID}, req.Invite...)
	members = append(members, req.BeeperInitialMembers...)
	for _, m := range members {
		if err = in.member(ctx, roomID, m); err != nil {
			return "", err
		}
	}
	return roomID, nil
}

func (in *Intent) DeleteRoom(ctx context.Context, roomID id.RoomID, puppetsOnly bool) error {
	return in.C.Store.DeleteRoom(ctx, string(roomID))
}

func (in *Intent) EnsureJoined(ctx context.Context, roomID id.RoomID, params ...bridgev2.EnsureJoinedParams) error {
	if err := in.ensureRoom(ctx, roomID); err != nil {
		return err
	}
	return in.member(ctx, roomID, in.MXID)
}

func (in *Intent) EnsureInvited(ctx context.Context, roomID id.RoomID, userID id.UserID) error {
	if err := in.ensureRoom(ctx, roomID); err != nil {
		return err
	}
	return in.member(ctx, roomID, userID)
}

func (in *Intent) TagRoom(ctx context.Context, roomID id.RoomID, tag event.RoomTag, isTagged bool) error {
	return nil
}

func (in *Intent) MuteRoom(ctx context.Context, roomID id.RoomID, until time.Time) error { return nil }

func (in *Intent) GetEvent(ctx context.Context, roomID id.RoomID, eventID id.EventID) (*event.Event, error) {
	e, err := in.C.Store.GetEvent(ctx, string(eventID))
	if err != nil {
		return nil, err
	}
	return ToMatrixEvent(e), nil
}

// ToMatrixEvent converts a stored event into a parsed mautrix event.
func ToMatrixEvent(e *store.Event) *event.Event {
	evt := &event.Event{
		ID:        id.EventID(e.EventID),
		RoomID:    id.RoomID(e.RoomID),
		Sender:    id.UserID(e.Sender),
		Type:      event.Type{Type: e.Type, Class: event.MessageEventType},
		Timestamp: e.TS,
		Content:   event.Content{VeryRaw: json.RawMessage(e.Content)},
	}
	_ = evt.Content.ParseRaw(evt.Type)
	return evt
}
