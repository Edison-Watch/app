// Package mcptools exposes the local messaging host as MCP tools. These are
// what an AI agent sees through SealGate.
package mcptools

import (
	"context"
	"encoding/json"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/Edison-Watch/app/messaging/internal/host"
)

func boolPtr(b bool) *bool { return &b }

func readOnly() *mcp.ToolAnnotations {
	return &mcp.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: boolPtr(false)}
}

func writes() *mcp.ToolAnnotations {
	return &mcp.ToolAnnotations{ReadOnlyHint: false, DestructiveHint: boolPtr(false), OpenWorldHint: boolPtr(true)}
}

func result(v any) (*mcp.CallToolResult, any, error) {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return nil, nil, err
	}
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(data)}}}, nil, nil
}

func fail(err error) (*mcp.CallToolResult, any, error) {
	return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: err.Error()}}}, nil, nil
}

func limitOr(n, def, max int) int {
	if n <= 0 {
		return def
	}
	if n > max {
		return max
	}
	return n
}

type listChatsIn struct {
	Query   string `json:"query,omitempty" jsonschema:"Only chats whose name or topic contains this text"`
	Account string `json:"account,omitempty" jsonschema:"Only chats of this account ID, from list_accounts"`
	Limit   int    `json:"limit,omitempty" jsonschema:"Maximum number of chats, default 50"`
}

type getMessagesIn struct {
	ChatID string `json:"chat_id" jsonschema:"Chat ID from list_chats"`
	Before string `json:"before,omitempty" jsonschema:"Only messages older than this message ID, for paging back"`
	Limit  int    `json:"limit,omitempty" jsonschema:"Maximum number of messages, default 30"`
}

type searchIn struct {
	Query  string `json:"query" jsonschema:"Text to look for in message bodies"`
	ChatID string `json:"chat_id,omitempty" jsonschema:"Only search this chat"`
	Limit  int    `json:"limit,omitempty" jsonschema:"Maximum number of results, default 30"`
}

type sendIn struct {
	ChatID  string `json:"chat_id" jsonschema:"Chat ID from list_chats"`
	Text    string `json:"text" jsonschema:"Message text"`
	ReplyTo string `json:"reply_to,omitempty" jsonschema:"Message ID to reply to"`
}

type reactIn struct {
	ChatID    string `json:"chat_id" jsonschema:"Chat ID from list_chats"`
	MessageID string `json:"message_id" jsonschema:"Message ID to react to"`
	Emoji     string `json:"emoji" jsonschema:"The reaction, usually one emoji"`
}

type chatIn struct {
	ChatID string `json:"chat_id" jsonschema:"Chat ID from list_chats"`
}

type startChatIn struct {
	Account    string `json:"account" jsonschema:"Account ID from list_accounts"`
	Identifier string `json:"identifier" jsonschema:"Who or what to open: a username for a direct chat, or a channel name such as #general on IRC"`
}

type noIn struct{}

// Register adds every messaging tool to the server.
func Register(s *mcp.Server, h *host.Host) {
	mcp.AddTool(s, &mcp.Tool{
		Name:        "list_accounts",
		Description: "List the messaging accounts connected on this computer, with their connection state.",
		Annotations: readOnly(),
	}, func(ctx context.Context, _ *mcp.CallToolRequest, _ noIn) (*mcp.CallToolResult, any, error) {
		return result(map[string]any{"accounts": h.Accounts()})
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "list_chats",
		Description: "List chats across all connected accounts, most recently active first, with unread counts and the last message.",
		Annotations: readOnly(),
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in listChatsIn) (*mcp.CallToolResult, any, error) {
		chats, err := h.ListChats(ctx, in.Query, in.Account, limitOr(in.Limit, 50, 200))
		if err != nil {
			return fail(err)
		}
		return result(map[string]any{"chats": chats})
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "get_messages",
		Description: "Read messages in one chat, oldest first. Use before to page back through older messages.",
		Annotations: readOnly(),
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in getMessagesIn) (*mcp.CallToolResult, any, error) {
		msgs, err := h.GetMessages(ctx, in.ChatID, in.Before, limitOr(in.Limit, 30, 200))
		if err != nil {
			return fail(err)
		}
		return result(map[string]any{"messages": msgs})
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "search_messages",
		Description: "Search message text across all chats, or one chat. Newest matches first.",
		Annotations: readOnly(),
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in searchIn) (*mcp.CallToolResult, any, error) {
		msgs, err := h.SearchMessages(ctx, in.Query, in.ChatID, limitOr(in.Limit, 30, 200))
		if err != nil {
			return fail(err)
		}
		return result(map[string]any{"messages": msgs})
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "send_message",
		Description: "Send a text message to a chat, optionally as a reply. Returns the sent message once the network accepts it.",
		Annotations: writes(),
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in sendIn) (*mcp.CallToolResult, any, error) {
		msg, err := h.SendText(ctx, in.ChatID, in.Text, in.ReplyTo)
		if err != nil {
			return fail(err)
		}
		return result(map[string]any{"message": msg})
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "react_to_message",
		Description: "Add a reaction to a message.",
		Annotations: writes(),
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in reactIn) (*mcp.CallToolResult, any, error) {
		if err := h.React(ctx, in.ChatID, in.MessageID, in.Emoji); err != nil {
			return fail(err)
		}
		return result(map[string]any{"ok": true})
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "mark_chat_read",
		Description: "Mark every message in a chat as read on this computer.",
		Annotations: &mcp.ToolAnnotations{ReadOnlyHint: false, DestructiveHint: boolPtr(false), IdempotentHint: true, OpenWorldHint: boolPtr(false)},
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in chatIn) (*mcp.CallToolResult, any, error) {
		if err := h.MarkRead(ctx, in.ChatID); err != nil {
			return fail(err)
		}
		return result(map[string]any{"ok": true})
	})

	mcp.AddTool(s, &mcp.Tool{
		Name:        "start_chat",
		Description: "Open a direct chat with someone, or join a group chat by name where the network allows it, and return the chat.",
		Annotations: writes(),
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in startChatIn) (*mcp.CallToolResult, any, error) {
		chat, err := h.StartChat(ctx, in.Account, in.Identifier)
		if err != nil {
			return fail(err)
		}
		return result(map[string]any{"chat": chat})
	})
}
