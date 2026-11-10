package host

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"maunium.net/go/mautrix/bridgev2"
	"maunium.net/go/mautrix/bridgev2/database"
	"maunium.net/go/mautrix/bridgev2/provisionutil"
	"maunium.net/go/mautrix/event"
	"maunium.net/go/mautrix/id"

	"github.com/Edison-Watch/app/messaging/internal/localmx"
	"github.com/Edison-Watch/app/messaging/internal/store"
)

type Chat struct {
	ID            string `json:"id"`
	Account       string `json:"account"`
	Network       string `json:"network"`
	Name          string `json:"name"`
	Type          string `json:"type"`
	Topic         string `json:"topic,omitempty"`
	Members       int    `json:"members"`
	Unread        int    `json:"unread"`
	LastMessageAt string `json:"last_message_at,omitempty"`
	LastMessage   string `json:"last_message,omitempty"`
	lastTS        int64
}

type Reaction struct {
	Emoji   string   `json:"emoji"`
	Senders []string `json:"senders"`
}

type Message struct {
	ID        string      `json:"id"`
	ChatID    string      `json:"chat_id"`
	ChatName  string      `json:"chat_name,omitempty"`
	Sender    string      `json:"sender"`
	SenderID  string      `json:"sender_id"`
	FromMe    bool        `json:"from_me"`
	Kind      string      `json:"kind"`
	Text      string      `json:"text"`
	Timestamp string      `json:"timestamp"`
	ReplyTo   string      `json:"reply_to,omitempty"`
	Edited    bool        `json:"edited,omitempty"`
	Reactions []*Reaction `json:"reactions,omitempty"`
	Status    string      `json:"status,omitempty"`
}

func formatTS(ms int64) string { return time.UnixMilli(ms).UTC().Format(time.RFC3339) }

// portalFor returns the bridge and portal behind a room, or an error when the
// room is not a bridged chat (management rooms, deleted portals).
func (h *Host) portalFor(ctx context.Context, roomID string) (*Bridge, *bridgev2.Portal, error) {
	room, err := h.Store.GetRoom(ctx, roomID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return nil, nil, fmt.Errorf("unknown chat %q", roomID)
		}
		return nil, nil, err
	}
	b, err := h.Bridge(room.Bridge)
	if err != nil {
		return nil, nil, err
	}
	portal, err := b.BR.GetPortalByMXID(ctx, id.RoomID(roomID))
	if err != nil {
		return nil, nil, err
	} else if portal == nil {
		return nil, nil, fmt.Errorf("chat %q is not a bridged chat", roomID)
	}
	return b, portal, nil
}

func (h *Host) chatName(ctx context.Context, b *Bridge, roomID string, portal *bridgev2.Portal) string {
	if raw, _, err := h.Store.GetState(ctx, roomID, event.StateRoomName.Type, ""); err == nil {
		var c event.RoomNameEventContent
		if json.Unmarshal(raw, &c) == nil && c.Name != "" {
			return c.Name
		}
	}
	if portal != nil && portal.Name != "" {
		return portal.Name
	}
	if portal != nil && portal.OtherUserID != "" {
		if n := h.Store.GetDisplayName(ctx, string(b.MX.FormatGhostMXID(portal.OtherUserID))); n != "" {
			return n
		}
		return string(portal.OtherUserID)
	}
	return roomID
}

func chatType(p *bridgev2.Portal) string {
	switch p.RoomType {
	case database.RoomTypeDM:
		return "dm"
	case database.RoomTypeSpace:
		return "space"
	default:
		return "group"
	}
}

func (h *Host) chatFor(ctx context.Context, room *store.Room) (*Chat, error) {
	b, portal, err := h.portalFor(ctx, room.RoomID)
	if err != nil {
		return nil, err
	}
	c := &Chat{
		ID: room.RoomID, Network: b.Net.ID(), Name: h.chatName(ctx, b, room.RoomID, portal), Type: chatType(portal),
		Account: AccountID(b.Net.ID(), string(portal.Receiver)),
	}
	if portal.Receiver == "" {
		if ul := b.User.GetDefaultLogin(); ul != nil {
			c.Account = AccountID(b.Net.ID(), string(ul.ID))
		}
	}
	if raw, _, err := h.Store.GetState(ctx, room.RoomID, event.StateTopic.Type, ""); err == nil {
		var t event.TopicEventContent
		if json.Unmarshal(raw, &t) == nil {
			c.Topic = t.Topic
		}
	}
	if members, err := h.Store.GetStateByType(ctx, room.RoomID, event.StateMember.Type); err == nil {
		for uid := range members {
			if !strings.HasSuffix(uid, "bot:"+localmx.ServerName) {
				c.Members++
			}
		}
	}
	if last, err := h.Store.LastMessage(ctx, room.RoomID); err == nil && last != nil {
		c.lastTS = last.TS
		c.LastMessageAt = formatTS(last.TS)
		var mc event.MessageEventContent
		if json.Unmarshal(last.Content, &mc) == nil {
			c.LastMessage = truncate(mc.Body, 120)
		}
	}
	c.Unread, _ = h.Store.CountAfter(ctx, room.RoomID, h.Store.ReadSeq(ctx, room.RoomID, string(UserMXID)), string(UserMXID))
	return c, nil
}

func truncate(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n]) + "..."
	}
	return s
}

func (h *Host) ListChats(ctx context.Context, query, account string, limit int) ([]*Chat, error) {
	rooms, err := h.Store.ListRooms(ctx)
	if err != nil {
		return nil, err
	}
	var out []*Chat
	q := strings.ToLower(query)
	for _, r := range rooms {
		c, err := h.chatFor(ctx, r)
		if err != nil {
			continue
		}
		if account != "" && c.Account != account {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(c.Name), q) && !strings.Contains(strings.ToLower(c.Topic), q) {
			continue
		}
		out = append(out, c)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].lastTS > out[j].lastTS })
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (h *Host) GetChat(ctx context.Context, chatID string) (*Chat, error) {
	room, err := h.Store.GetRoom(ctx, chatID)
	if err != nil {
		return nil, fmt.Errorf("unknown chat %q", chatID)
	}
	return h.chatFor(ctx, room)
}

func (h *Host) senderName(ctx context.Context, sender string) string {
	if id.UserID(sender) == UserMXID {
		return "me"
	}
	if n := h.Store.GetDisplayName(ctx, sender); n != "" {
		return n
	}
	return sender
}

// buildMessages turns stored message events into the public view, folding in
// edits and reactions. evts must be message events.
func (h *Host) buildMessages(ctx context.Context, roomID string, evts []*store.Event) ([]*Message, error) {
	var ids []string
	for _, e := range evts {
		ids = append(ids, e.EventID)
	}
	rels, err := h.Store.Relations(ctx, roomID, ids)
	if err != nil {
		return nil, err
	}
	edits := map[string]string{}
	reacts := map[string]map[string][]string{}
	for _, r := range rels {
		var c struct {
			RelatesTo struct {
				RelType string `json:"rel_type"`
				EventID string `json:"event_id"`
				Key     string `json:"key"`
			} `json:"m.relates_to"`
			NewContent struct {
				Body string `json:"body"`
			} `json:"m.new_content"`
		}
		if json.Unmarshal(r.Content, &c) != nil {
			continue
		}
		switch c.RelatesTo.RelType {
		case "m.replace":
			edits[c.RelatesTo.EventID] = c.NewContent.Body
		case "m.annotation":
			if reacts[c.RelatesTo.EventID] == nil {
				reacts[c.RelatesTo.EventID] = map[string][]string{}
			}
			reacts[c.RelatesTo.EventID][c.RelatesTo.Key] = append(reacts[c.RelatesTo.EventID][c.RelatesTo.Key], h.senderName(ctx, r.Sender))
		}
	}
	var out []*Message
	for _, e := range evts {
		var mc event.MessageEventContent
		if json.Unmarshal(e.Content, &mc) != nil {
			continue
		}
		if mc.RelatesTo != nil && mc.RelatesTo.Type == event.RelReplace {
			continue // edits are folded into their target
		}
		m := &Message{
			ID: e.EventID, ChatID: roomID, SenderID: e.Sender, Sender: h.senderName(ctx, e.Sender),
			FromMe: id.UserID(e.Sender) == UserMXID, Kind: strings.TrimPrefix(string(mc.MsgType), "m."),
			Text: mc.Body, Timestamp: formatTS(e.TS), Status: e.Status,
		}
		if e.Redacted {
			m.Kind, m.Text = "deleted", ""
		}
		if mc.RelatesTo != nil && mc.RelatesTo.InReplyTo != nil {
			m.ReplyTo = string(mc.RelatesTo.InReplyTo.EventID)
		}
		if body, ok := edits[e.EventID]; ok {
			m.Text, m.Edited = body, true
		}
		for emoji, senders := range reacts[e.EventID] {
			m.Reactions = append(m.Reactions, &Reaction{Emoji: emoji, Senders: senders})
		}
		sort.Slice(m.Reactions, func(i, j int) bool { return m.Reactions[i].Emoji < m.Reactions[j].Emoji })
		out = append(out, m)
	}
	return out, nil
}

// GetMessages returns up to limit messages, oldest first, optionally before
// the given message ID.
func (h *Host) GetMessages(ctx context.Context, chatID, before string, limit int) ([]*Message, error) {
	if _, _, err := h.portalFor(ctx, chatID); err != nil {
		return nil, err
	}
	var beforeSeq int64
	if before != "" {
		e, err := h.Store.GetEvent(ctx, before)
		if err != nil {
			return nil, fmt.Errorf("unknown message %q", before)
		}
		beforeSeq = e.Seq
	}
	evts, err := h.Store.Timeline(ctx, chatID, []string{event.EventMessage.Type}, beforeSeq, limit*2)
	if err != nil {
		return nil, err
	}
	msgs, err := h.buildMessages(ctx, chatID, evts)
	if err != nil {
		return nil, err
	}
	if len(msgs) > limit {
		msgs = msgs[:limit]
	}
	for i, j := 0, len(msgs)-1; i < j; i, j = i+1, j-1 {
		msgs[i], msgs[j] = msgs[j], msgs[i]
	}
	return msgs, nil
}

func (h *Host) SearchMessages(ctx context.Context, query, chatID string, limit int) ([]*Message, error) {
	evts, err := h.Store.Search(ctx, chatID, query, limit)
	if err != nil {
		return nil, err
	}
	byRoom := map[string][]*store.Event{}
	var order []string
	for _, e := range evts {
		if _, ok := byRoom[e.RoomID]; !ok {
			order = append(order, e.RoomID)
		}
		byRoom[e.RoomID] = append(byRoom[e.RoomID], e)
	}
	var out []*Message
	for _, rid := range order {
		b, portal, err := h.portalFor(ctx, rid)
		if err != nil {
			continue
		}
		msgs, err := h.buildMessages(ctx, rid, byRoom[rid])
		if err != nil {
			return nil, err
		}
		name := h.chatName(ctx, b, rid, portal)
		for _, m := range msgs {
			m.ChatName = name
		}
		out = append(out, msgs...)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Timestamp > out[j].Timestamp })
	return out, nil
}

// sendAsUser stores an event from the local user and hands it to the bridge,
// then waits for the network's verdict.
func (h *Host) sendAsUser(ctx context.Context, b *Bridge, roomID string, evtType event.Type, content any) (string, error) {
	raw, err := json.Marshal(content)
	if err != nil {
		return "", err
	}
	evtID := localmx.NewEventID()
	ch := make(chan *bridgev2.MessageStatus, 1)
	h.waitLock.Lock()
	h.waiters[evtID] = ch
	h.waitLock.Unlock()
	defer func() {
		h.waitLock.Lock()
		delete(h.waiters, evtID)
		h.waitLock.Unlock()
	}()
	stored := &store.Event{
		EventID: string(evtID), RoomID: roomID, Sender: string(UserMXID), Type: evtType.Type,
		Content: raw, TS: time.Now().UnixMilli(), Status: "pending",
	}
	if err = h.Store.AddEvent(ctx, stored); err != nil {
		return "", err
	}
	evt := localmx.ToMatrixEvent(stored)
	evt.Type = evtType
	b.BR.QueueMatrixEvent(b.BR.BackgroundCtx, evt)
	select {
	case st := <-ch:
		if st.Status == event.MessageStatusSuccess {
			_ = h.Store.SetEventStatus(ctx, string(evtID), "sent")
			return string(evtID), nil
		}
		_ = h.Store.SetEventStatus(ctx, string(evtID), "failed")
		msg := st.Message
		if msg == "" && st.InternalError != nil {
			msg = st.InternalError.Error()
		}
		if msg == "" {
			msg = string(st.ErrorReason)
		}
		return string(evtID), fmt.Errorf("the network rejected the message: %s", msg)
	case <-time.After(30 * time.Second):
		_ = h.Store.SetEventStatus(ctx, string(evtID), "unknown")
		return string(evtID), ErrTimeout
	case <-ctx.Done():
		return string(evtID), ctx.Err()
	}
}

func (h *Host) SendText(ctx context.Context, chatID, text, replyTo string) (*Message, error) {
	b, _, err := h.portalFor(ctx, chatID)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(text) == "" {
		return nil, errors.New("text is empty")
	}
	content := &event.MessageEventContent{MsgType: event.MsgText, Body: text}
	if replyTo != "" {
		if _, err := h.Store.GetEvent(ctx, replyTo); err != nil {
			return nil, fmt.Errorf("unknown message %q", replyTo)
		}
		content.RelatesTo = (&event.RelatesTo{}).SetReplyTo(id.EventID(replyTo))
	}
	evtID, err := h.sendAsUser(ctx, b, chatID, event.EventMessage, content)
	if err != nil {
		return nil, err
	}
	e, err := h.Store.GetEvent(ctx, evtID)
	if err != nil {
		return nil, err
	}
	msgs, err := h.buildMessages(ctx, chatID, []*store.Event{e})
	if err != nil || len(msgs) == 0 {
		return nil, err
	}
	return msgs[0], nil
}

func (h *Host) React(ctx context.Context, chatID, messageID, emoji string) error {
	b, _, err := h.portalFor(ctx, chatID)
	if err != nil {
		return err
	}
	if _, err = h.Store.GetEvent(ctx, messageID); err != nil {
		return fmt.Errorf("unknown message %q", messageID)
	}
	content := &event.ReactionEventContent{RelatesTo: event.RelatesTo{
		Type: event.RelAnnotation, EventID: id.EventID(messageID), Key: emoji,
	}}
	_, err = h.sendAsUser(ctx, b, chatID, event.EventReaction, content)
	return err
}

func (h *Host) MarkRead(ctx context.Context, chatID string) error {
	if _, _, err := h.portalFor(ctx, chatID); err != nil {
		return err
	}
	last, err := h.Store.LastMessage(ctx, chatID)
	if err != nil || last == nil {
		return err
	}
	return h.Store.SetRead(ctx, chatID, string(UserMXID), last.EventID, time.Now().UnixMilli())
}

// StartChat opens a DM with a person, or joins a named group chat where the
// network supports that (IRC channels), and returns the chat.
func (h *Host) StartChat(ctx context.Context, accountID, identifier string) (*Chat, error) {
	b, ul, err := h.FindLogin(accountID)
	if err != nil {
		return nil, err
	}
	if joiner, ok := b.Net.(ChatJoiner); ok && joiner.IsJoinIdentifier(identifier) {
		if err = joiner.JoinChat(ctx, ul, identifier); err != nil {
			return nil, err
		}
		deadline := time.Now().Add(15 * time.Second)
		for time.Now().Before(deadline) {
			chats, _ := h.ListChats(ctx, "", accountID, 0)
			for _, c := range chats {
				if strings.EqualFold(c.Name, identifier) {
					return c, nil
				}
			}
			time.Sleep(300 * time.Millisecond)
		}
		return nil, fmt.Errorf("joined %s but the chat did not appear in time", identifier)
	}
	resp, err := provisionutil.ResolveIdentifier(ctx, ul, identifier, true)
	if err != nil {
		return nil, err
	}
	if resp == nil || resp.DMRoomID == "" {
		return nil, fmt.Errorf("could not open a chat with %q", identifier)
	}
	return h.GetChat(ctx, string(resp.DMRoomID))
}
