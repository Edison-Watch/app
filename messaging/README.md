# sealgate-messaging (prototype)

sealgate-messaging lets an AI agent read and send messages in the chat apps on
the user's computer, through SealGate. Everything runs on the user's computer.
SealGate stores no chats and runs no bridges.

## How it works

The binary embeds [mautrix](https://github.com/mautrix/go) network connectors,
the same bridges Beeper uses. A mautrix bridge normally needs a Matrix
homeserver. This binary replaces the homeserver with a local SQLite store, so
one process runs with no Matrix server.

| Package | What it does |
| --- | --- |
| `internal/localmx` | A bridgev2 Matrix connector that writes rooms, state and events to the local store instead of a homeserver. |
| `internal/store` | The local database: rooms, state, timeline, profiles, media. |
| `internal/host` | Runs each bridge, keeps accounts and logins, and gives a chat and message view with sending. |
| `internal/mcptools` | The MCP tools an agent sees: list_accounts, list_chats, get_messages, search_messages, send_message, react_to_message, mark_chat_read, start_chat. |
| `internal/control` | A loopback API with a bearer token. The desktop app uses it to add accounts. Login credentials go from the app to this process only. |

The desktop app turns the feature on by running `sealgate-stdiod server add
messaging-<computer> --command <binary> --arg mcp`. The stdio daemon then runs
the binary and tunnels its tools to the gateway. Each computer gets its own
server, because each computer has its own accounts.

Data lives in one folder per user:

| OS | Folder |
| --- | --- |
| Linux | `~/.local/share/sealgate/messaging` |
| macOS | `~/Library/Application Support/SealGate/messaging` |
| Windows | `%LOCALAPPDATA%\SealGate\messaging` |

## Networks

The prototype ships one network, IRC (mautrix-irc). IRC is the test network:
an IRC server runs locally in Docker, so the tests need no third-party
accounts. Another mautrix network is added by implementing `host.Network` and
passing it to `host.New` in `cmd/sealgate-messaging`.

## Build and test

You need Go 1.26 or later. The binary uses cgo for SQLite.

```sh
go test ./...                                   # unit tests
bash testing/run-ergo.sh                        # local IRC server on 6667
SEALGATE_TEST_IRC_ADDR=127.0.0.1:6667 go test ./...   # adds the end-to-end test
```

`packages/desktop/scripts/build-messaging.sh` builds the binary for the
desktop app. It uses zig as the C compiler for cross builds: a static musl
binary for Linux, and a `windows-gnu` binary for Windows.

```sh
TARGET_OS=linux bash ../packages/desktop/scripts/build-messaging.sh
TARGET_OS=windows bash ../packages/desktop/scripts/build-messaging.sh
```

To test the desktop app on Linux and Windows VMs, follow
[testing/vm/README.md](testing/vm/README.md). It builds both VMs on a Linux host
and connects them to a local backend and IRC server.

## Known limits of the prototype

- Only IRC is wired in. WhatsApp, Signal and the others are not.
- The binary does not show QR codes as images yet. The desktop UI renders a QR step as text data.
- Media is stored in the local database, with no size limit or cleanup.
- There is no backfill of chat history from before the account was added.
- The desktop app has no macOS packaging rule tested for the binary.
