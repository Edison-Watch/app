// Package store keeps the local copy of every bridged chat: rooms, room state,
// timeline events, profiles and uploaded media. It stands in for the Matrix
// homeserver a mautrix bridge normally talks to, so nothing leaves the machine
// except what the bridges themselves send to their networks.
package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	_ "go.mau.fi/util/dbutil/litestream" // registers the sqlite3-fk-wal driver
)

const schema = `
CREATE TABLE IF NOT EXISTS rooms (
	room_id    TEXT PRIMARY KEY,
	bridge     TEXT NOT NULL,
	creator    TEXT NOT NULL,
	is_direct  INTEGER NOT NULL DEFAULT 0,
	created_ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS state (
	room_id   TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
	type      TEXT NOT NULL,
	state_key TEXT NOT NULL,
	sender    TEXT NOT NULL,
	content   TEXT NOT NULL,
	ts        INTEGER NOT NULL,
	PRIMARY KEY (room_id, type, state_key)
);
CREATE TABLE IF NOT EXISTS events (
	seq      INTEGER PRIMARY KEY AUTOINCREMENT,
	event_id TEXT NOT NULL UNIQUE,
	room_id  TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
	sender   TEXT NOT NULL,
	type     TEXT NOT NULL,
	content  TEXT NOT NULL,
	ts       INTEGER NOT NULL,
	redacted INTEGER NOT NULL DEFAULT 0,
	status   TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS events_room_seq ON events(room_id, seq);
CREATE TABLE IF NOT EXISTS profiles (
	user_id     TEXT PRIMARY KEY,
	displayname TEXT NOT NULL DEFAULT '',
	avatar_url  TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS media (
	mxc  TEXT PRIMARY KEY,
	mime TEXT NOT NULL,
	name TEXT NOT NULL,
	data BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS reads (
	room_id  TEXT NOT NULL REFERENCES rooms(room_id) ON DELETE CASCADE,
	user_id  TEXT NOT NULL,
	event_id TEXT NOT NULL,
	ts       INTEGER NOT NULL,
	PRIMARY KEY (room_id, user_id)
);
`

// ErrNotFound is returned when a room, event or media item does not exist.
var ErrNotFound = errors.New("not found")

type Store struct {
	DB *sql.DB

	listenersLock sync.Mutex
	listeners     []func(*Event)
}

type Event struct {
	Seq      int64           `json:"-"`
	EventID  string          `json:"event_id"`
	RoomID   string          `json:"room_id"`
	Sender   string          `json:"sender"`
	Type     string          `json:"type"`
	Content  json.RawMessage `json:"content"`
	TS       int64           `json:"ts"`
	Redacted bool            `json:"redacted"`
	Status   string          `json:"status"`
}

type Room struct {
	RoomID    string `json:"room_id"`
	Bridge    string `json:"bridge"`
	Creator   string `json:"creator"`
	IsDirect  bool   `json:"is_direct"`
	CreatedTS int64  `json:"created_ts"`
}

func Open(path string) (*Store, error) {
	uri := fmt.Sprintf("file:%s?_txlock=immediate", path)
	db, err := sql.Open("sqlite3-fk-wal", uri)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err = db.Exec(schema); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("init schema: %w", err)
	}
	return &Store{DB: db}, nil
}

func (s *Store) Close() error { return s.DB.Close() }

// OnEvent registers a callback that runs after every stored timeline event.
func (s *Store) OnEvent(fn func(*Event)) {
	s.listenersLock.Lock()
	s.listeners = append(s.listeners, fn)
	s.listenersLock.Unlock()
}

func (s *Store) CreateRoom(ctx context.Context, r *Room) error {
	_, err := s.DB.ExecContext(ctx,
		`INSERT INTO rooms (room_id, bridge, creator, is_direct, created_ts) VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT (room_id) DO UPDATE SET is_direct=excluded.is_direct`,
		r.RoomID, r.Bridge, r.Creator, r.IsDirect, r.CreatedTS)
	return err
}

func (s *Store) DeleteRoom(ctx context.Context, roomID string) error {
	_, err := s.DB.ExecContext(ctx, `DELETE FROM rooms WHERE room_id=?`, roomID)
	return err
}

func (s *Store) GetRoom(ctx context.Context, roomID string) (*Room, error) {
	var r Room
	err := s.DB.QueryRowContext(ctx,
		`SELECT room_id, bridge, creator, is_direct, created_ts FROM rooms WHERE room_id=?`, roomID,
	).Scan(&r.RoomID, &r.Bridge, &r.Creator, &r.IsDirect, &r.CreatedTS)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return &r, err
}

func (s *Store) ListRooms(ctx context.Context) ([]*Room, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT room_id, bridge, creator, is_direct, created_ts FROM rooms`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Room
	for rows.Next() {
		var r Room
		if err = rows.Scan(&r.RoomID, &r.Bridge, &r.Creator, &r.IsDirect, &r.CreatedTS); err != nil {
			return nil, err
		}
		out = append(out, &r)
	}
	return out, rows.Err()
}

func (s *Store) SetState(ctx context.Context, roomID, evtType, stateKey, sender string, content json.RawMessage, ts int64) error {
	_, err := s.DB.ExecContext(ctx,
		`INSERT INTO state (room_id, type, state_key, sender, content, ts) VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT (room_id, type, state_key) DO UPDATE SET sender=excluded.sender, content=excluded.content, ts=excluded.ts`,
		roomID, evtType, stateKey, sender, string(content), ts)
	return err
}

func (s *Store) GetState(ctx context.Context, roomID, evtType, stateKey string) (json.RawMessage, string, error) {
	var content, sender string
	err := s.DB.QueryRowContext(ctx,
		`SELECT content, sender FROM state WHERE room_id=? AND type=? AND state_key=?`, roomID, evtType, stateKey,
	).Scan(&content, &sender)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, "", ErrNotFound
	}
	return json.RawMessage(content), sender, err
}

// GetStateByType returns state_key -> content for one state event type in a room.
func (s *Store) GetStateByType(ctx context.Context, roomID, evtType string) (map[string]json.RawMessage, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT state_key, content FROM state WHERE room_id=? AND type=?`, roomID, evtType)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]json.RawMessage{}
	for rows.Next() {
		var key, content string
		if err = rows.Scan(&key, &content); err != nil {
			return nil, err
		}
		out[key] = json.RawMessage(content)
	}
	return out, rows.Err()
}

func (s *Store) AddEvent(ctx context.Context, e *Event) error {
	if e.TS == 0 {
		e.TS = time.Now().UnixMilli()
	}
	res, err := s.DB.ExecContext(ctx,
		`INSERT INTO events (event_id, room_id, sender, type, content, ts, status) VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (event_id) DO NOTHING`,
		e.EventID, e.RoomID, e.Sender, e.Type, string(e.Content), e.TS, e.Status)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil
	}
	e.Seq, _ = res.LastInsertId()
	s.listenersLock.Lock()
	ls := append([]func(*Event){}, s.listeners...)
	s.listenersLock.Unlock()
	for _, fn := range ls {
		fn(e)
	}
	return nil
}

func (s *Store) SetEventStatus(ctx context.Context, eventID, status string) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE events SET status=? WHERE event_id=?`, status, eventID)
	return err
}

func (s *Store) RedactEvent(ctx context.Context, eventID string) error {
	_, err := s.DB.ExecContext(ctx, `UPDATE events SET redacted=1, content='{}' WHERE event_id=?`, eventID)
	return err
}

const eventCols = `seq, event_id, room_id, sender, type, content, ts, redacted, status`

func scanEvent(row interface{ Scan(...any) error }) (*Event, error) {
	var e Event
	var content string
	if err := row.Scan(&e.Seq, &e.EventID, &e.RoomID, &e.Sender, &e.Type, &content, &e.TS, &e.Redacted, &e.Status); err != nil {
		return nil, err
	}
	e.Content = json.RawMessage(content)
	return &e, nil
}

func (s *Store) GetEvent(ctx context.Context, eventID string) (*Event, error) {
	e, err := scanEvent(s.DB.QueryRowContext(ctx, `SELECT `+eventCols+` FROM events WHERE event_id=?`, eventID))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return e, err
}

// Timeline returns events of the given types in a room, newest first, older
// than beforeSeq when it is positive.
func (s *Store) Timeline(ctx context.Context, roomID string, types []string, beforeSeq int64, limit int) ([]*Event, error) {
	q := `SELECT ` + eventCols + ` FROM events WHERE room_id=?`
	args := []any{roomID}
	if len(types) > 0 {
		q += ` AND type IN (?` + strings.Repeat(`,?`, len(types)-1) + `)`
		for _, t := range types {
			args = append(args, t)
		}
	}
	if beforeSeq > 0 {
		q += ` AND seq < ?`
		args = append(args, beforeSeq)
	}
	q += ` ORDER BY seq DESC LIMIT ?`
	args = append(args, limit)
	return s.queryEvents(ctx, q, args...)
}

// Relations returns events that relate to any of the given event IDs (edits,
// reactions, redactions), oldest first.
func (s *Store) Relations(ctx context.Context, roomID string, targets []string) ([]*Event, error) {
	if len(targets) == 0 {
		return nil, nil
	}
	q := `SELECT ` + eventCols + ` FROM events WHERE room_id=? AND redacted=0 AND type IN ('m.reaction','m.room.message')
		AND json_extract(content, '$."m.relates_to".event_id') IN (?` + strings.Repeat(`,?`, len(targets)-1) + `)
		AND json_extract(content, '$."m.relates_to".rel_type') IN ('m.annotation','m.replace') ORDER BY seq ASC`
	args := []any{roomID}
	for _, t := range targets {
		args = append(args, t)
	}
	return s.queryEvents(ctx, q, args...)
}

// Search finds message events whose body contains query (case-insensitive).
func (s *Store) Search(ctx context.Context, roomID, query string, limit int) ([]*Event, error) {
	q := `SELECT ` + eventCols + ` FROM events WHERE type='m.room.message' AND redacted=0
		AND json_extract(content, '$.body') LIKE ? ESCAPE '\'`
	escaped := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(query)
	args := []any{"%" + escaped + "%"}
	if roomID != "" {
		q += ` AND room_id=?`
		args = append(args, roomID)
	}
	q += ` ORDER BY seq DESC LIMIT ?`
	args = append(args, limit)
	return s.queryEvents(ctx, q, args...)
}

// LastMessage returns the newest message event in a room, or nil.
func (s *Store) LastMessage(ctx context.Context, roomID string) (*Event, error) {
	evts, err := s.Timeline(ctx, roomID, []string{"m.room.message"}, 0, 1)
	if err != nil || len(evts) == 0 {
		return nil, err
	}
	return evts[0], nil
}

// CountAfter counts message events newer than afterSeq not sent by user.
func (s *Store) CountAfter(ctx context.Context, roomID string, afterSeq int64, notSender string) (int, error) {
	var n int
	err := s.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM events WHERE room_id=? AND type='m.room.message' AND seq>? AND sender!=? AND redacted=0`,
		roomID, afterSeq, notSender).Scan(&n)
	return n, err
}

func (s *Store) queryEvents(ctx context.Context, q string, args ...any) ([]*Event, error) {
	rows, err := s.DB.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []*Event
	for rows.Next() {
		e, err := scanEvent(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *Store) SetProfile(ctx context.Context, userID string, displayname, avatar *string) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO profiles (user_id) VALUES (?) ON CONFLICT DO NOTHING`, userID)
	if err != nil {
		return err
	}
	if displayname != nil {
		if _, err = s.DB.ExecContext(ctx, `UPDATE profiles SET displayname=? WHERE user_id=?`, *displayname, userID); err != nil {
			return err
		}
	}
	if avatar != nil {
		_, err = s.DB.ExecContext(ctx, `UPDATE profiles SET avatar_url=? WHERE user_id=?`, *avatar, userID)
	}
	return err
}

func (s *Store) GetDisplayName(ctx context.Context, userID string) string {
	var name string
	_ = s.DB.QueryRowContext(ctx, `SELECT displayname FROM profiles WHERE user_id=?`, userID).Scan(&name)
	return name
}

func (s *Store) PutMedia(ctx context.Context, mxc, mime, name string, data []byte) error {
	_, err := s.DB.ExecContext(ctx,
		`INSERT INTO media (mxc, mime, name, data) VALUES (?, ?, ?, ?) ON CONFLICT (mxc) DO NOTHING`, mxc, mime, name, data)
	return err
}

func (s *Store) GetMedia(ctx context.Context, mxc string) (data []byte, mime, name string, err error) {
	err = s.DB.QueryRowContext(ctx, `SELECT data, mime, name FROM media WHERE mxc=?`, mxc).Scan(&data, &mime, &name)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return
}

func (s *Store) SetRead(ctx context.Context, roomID, userID, eventID string, ts int64) error {
	_, err := s.DB.ExecContext(ctx,
		`INSERT INTO reads (room_id, user_id, event_id, ts) VALUES (?, ?, ?, ?)
		 ON CONFLICT (room_id, user_id) DO UPDATE SET event_id=excluded.event_id, ts=excluded.ts`,
		roomID, userID, eventID, ts)
	return err
}

// ReadSeq returns the seq of the user's read marker in a room, or 0.
func (s *Store) ReadSeq(ctx context.Context, roomID, userID string) int64 {
	var seq int64
	_ = s.DB.QueryRowContext(ctx,
		`SELECT e.seq FROM reads r JOIN events e ON e.event_id=r.event_id WHERE r.room_id=? AND r.user_id=?`,
		roomID, userID).Scan(&seq)
	return seq
}
