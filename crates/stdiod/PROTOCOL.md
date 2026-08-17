# stdiod tunnel protocol - normative client requirements

Normative requirements for any client that speaks the Edison Watch stdio tunnel
protocol: the Rust daemon in this repo today, a Kotlin/Android client later.

Scope and status:

- This document describes **protocol_version 2 as implemented**. Where
  `ARCHITECTURE.md` describes behaviour that is not in the code, it is listed in
  [Known deltas from ARCHITECTURE.md](#known-deltas-from-architecturemd) and is
  not normative here.
- Wire *shapes* are owned by `schema/tunnel-protocol.json` (canonical) and its
  vendored backend copy `src/stdio_tunnel/tunnel-protocol.json` in the
  edison-watch repo. This document covers *behaviour* that a schema cannot
  express.
- Executable examples of every frame live in `schema/golden-frames/`.
- Key words MUST / MUST NOT / SHOULD / MAY are used in the RFC 2119 sense.

Peers referenced below (read-only context for a client implementer):

| Role | Source |
|------|--------|
| Wire types | `crates/edison-tunnel-protocol/src/lib.rs` |
| Reference client | `crates/edison-stdiod/src/{daemon,tunnel,proc,env_store,state,config}.rs` |
| Backend endpoint | edison-watch `src/api/v1/routes/stdio_tunnel.py` |
| Backend frame router | edison-watch `src/stdio_tunnel/registry.py` |
| Backend wire types | edison-watch `src/stdio_tunnel/protocol.py` |

---

## 1. Connection and authentication

**T-01** A client MUST maintain at most one WebSocket to
`<backend>/api/v1/stdio-tunnel/ws` per device. The backend keys live
connections by the `Devices` row id and closes the previous connection with
code 1008 / reason `connection replaced` when a second one registers.
*Source: `tunnel.rs::build_ws_url`; `registry.py::DeviceTunnelRegistry.register`.*

**T-02** The WebSocket scheme MUST be derived from the backend origin scheme:
`https` becomes `wss`, `http` becomes `ws`. Any other input scheme MUST be
rejected before connecting.
*Source: `tunnel.rs::build_ws_url`.*

**T-03** A client MUST reject a cleartext `http` backend origin unless its host
is `localhost` or a loopback IP, and MUST reject origins carrying userinfo, a
path, a query, or a fragment.
*Source: `config.rs::normalize_backend_url`, `config.rs::is_loopback_host`.*

**T-04** A client MUST send `Authorization: Bearer <credential>` on the upgrade
request. The backend accepts an `ewc_`-prefixed client credential carrying the
`tunnel:connect` scope, or a legacy API key; anything else is closed with 1008.
*Source: `tunnel.rs::build_request`; `stdio_tunnel.py::_authenticate_ws`.*

**T-05** A client MUST send `X-Edison-Device-Id`. When the credential is an
`ewc_` client credential, the header value MUST equal the credential's bound
`device_id`, otherwise the backend closes with 1008 / `device id does not match
client credential`.
*Source: `stdio_tunnel.py::_authenticate_ws`.*

**T-06** A client SHOULD send `X-Edison-Secret-Key` when it holds one. The
header is optional at v2. Both the bearer token and the secret key MUST be
treated as sensitive and MUST NOT appear in logs or in `last_error` text.
*Source: `tunnel.rs::build_request` (`HeaderValue::set_sensitive`);
`daemon_auth.rs::connection_error_message`.*

**T-07** A client MUST accept that the backend may complete the upgrade and
*then* refuse the session: when the org feature flag `stdio_tunnel_enabled` is
off, the backend sends a device-wide `tunnel_error{code:"stdio_tunnel_disabled"}`
and closes with 1008. See T-49.
*Source: `stdio_tunnel.py::_stdio_tunnel_ws_inner`.*

---

## 2. Handshake

**T-08** The first frame a client sends after the upgrade MUST be
`client_hello`. The backend closes with 1008 / `expected client_hello` on any
other frame type, and with 1003 / `bad client_hello` if the frame does not
parse.
*Source: `stdio_tunnel.py::_stdio_tunnel_ws_inner`; `daemon.rs::run_one_session`.*

**T-09** A client MUST send `client_hello.protocol_version`, and the value MUST
fall inside the backend's supported window: the backend accepts the handshake
iff `MIN_SUPPORTED_PROTOCOL_VERSION <= client_hello.protocol_version <=
PROTOCOL_VERSION`. Both bounds are `2` today, so the window is degenerate and
`2` is the only accepted value; the window exists so the backend can keep
speaking an older version through a rollout of clients that update on an app
store's schedule. A version outside the window closes the socket with 1008 and
a reason naming `protocol_version` (see T-62). A client MUST NOT assume the
window is wider than the pair of bounds the backend advertises, and MUST NOT
infer the bounds from a successful handshake.
*Source: `protocol.py::PROTOCOL_VERSION`,
`protocol.py::MIN_SUPPORTED_PROTOCOL_VERSION`, `stdio_tunnel.py` version check;
`lib.rs::PROTOCOL_VERSION`.*

**T-10** `client_hello.device_id` MUST equal the `X-Edison-Device-Id` header
value on the same connection. The backend closes with 1008 / `device_id
mismatch between header and client_hello` otherwise.
*Source: `stdio_tunnel.py::_stdio_tunnel_ws_inner`.*

**T-11** `client_hello.currently_running` MUST list the `server_id`s the client
currently has live at connect time, and MUST be an empty array when none are.
The reference client filters out children that have already exited.
*Source: `daemon.rs::run_one_session` (`currently_running`).*

**T-12** `client_hello.os` MUST be one of `macos`, `linux`, `windows` at v2.
Adding a value is a protocol change that requires the schema, the Rust enum,
and the pydantic literal to move together.
*Source: `lib.rs::Os`; `protocol.py::ClientHello.os`; `tunnel-protocol.json`.*

**T-13** A client MUST treat the `server_hello` reply as the authoritative
desired-state snapshot for the session (see T-23). `server_hello.protocol_version`
carries the backend's own `PROTOCOL_VERSION`, which is the top of the window in
T-09 and so MAY be higher than the client's. A client MUST NOT reject a
`server_hello` on the strength of that value and MUST NOT end the session over
it: the backend already judged the pair compatible by accepting the handshake,
and it is the only peer that knows both bounds. The reference client logs the
difference at `info` and continues.
*Source: `daemon.rs::drain_incoming` (`ServerHello` arm).*

---

## 3. Serialization rules

**T-14** Every frame MUST be one JSON object sent as a WebSocket **text**
message, carrying a `type` discriminator whose value is the snake_case variant
tag. Binary and continuation messages MUST be ignored.
*Source: `tunnel.rs::run_frame_loop`; `lib.rs::TunnelFrame` (`#[serde(tag = "type")]`).*

**T-15** An unrecognised `type` value is a **hard parse failure**. Neither
current implementation has a catch-all variant: serde rejects the unknown tag
and pydantic's discriminated union rejects it. This is the stated policy, so a
new frame variant is a coordinated change across schema, Rust, and pydantic and
can never be assumed safe to send.
*Source: `lib.rs::TunnelFrame::from_json`; `protocol.py::parse_tunnel_frame`.*

**T-16** On a parse failure a client MUST log and drop that single frame and
MUST keep the connection open. It MUST NOT close the socket, MUST NOT reply
with an error frame, and MUST NOT attempt to guess the intent of the frame. The
backend behaves identically.
*Source: `tunnel.rs::run_frame_loop` (`unparseable tunnel frame; dropping`);
`registry.py::run_receive_loop` (`sent unparseable frame`).*

**T-17** Optional fields MAY arrive as an explicit `null`. A client MUST accept
`null` and absent as equivalent for every optional field. The backend
serializes with `model_dump(mode="json", exclude_none=False)`, so
`tunnel_error.server_id`, `tunnel_error.related_jsonrpc_id`,
`server_spawn_result.error`, `desired_server.working_dir`,
`server_spec_update.env`, and `server_spec_update.templated_args` routinely
appear on the wire as explicit nulls.
*Source: `registry.py::DeviceConnection.send_frame`.*

**T-18** A client MUST ignore object members it does not recognise rather than
failing the frame. Both current implementations do (serde without
`deny_unknown_fields`, pydantic with default extra handling) even though the
JSON Schema declares `additionalProperties: false`.
*Source: `lib.rs` struct definitions; `protocol.py` model definitions;
`schema/tunnel-protocol.json`.*

**T-19** The JSON-RPC `id` inside `mcp_frame.frame` MAY be a number or a string,
and `tunnel_error.related_jsonrpc_id` MAY likewise be either (or null). A client
MUST NOT coerce one to the other; the value is echoed verbatim.
*Source: `lib.rs::TunnelError.related_jsonrpc_id` (`serde_json::Value`);
`protocol.py::TunnelError.related_jsonrpc_id` (`int | str | None`).*

**T-20** `mcp_frame.frame` is **opaque**. A client MUST forward the JSON-RPC
body verbatim in both directions and MUST NOT inspect, rewrite, reorder, filter,
or synthesise MCP payloads. Method names, `params`, and `result` are the
backend's business.
*Source: `proc.rs::stdout_pump` / `stdin_pump`; `lib.rs` module docs.*

**T-21** Frames produced while the socket is down MUST be dropped silently
rather than queued for later delivery. The backend has already failed any
in-flight calls by then (T-50), so replaying stale frames would be incorrect.
*Source: `tunnel.rs::OutgoingHandle::send` (returns `false` when cleared).*

---

## 4. Desired-state reconciliation

**T-22** On every connect and reconnect, a client MUST reconcile against the
`server_hello.servers` snapshot and MUST treat that snapshot as complete. Any
state accumulated from earlier `desired_state_update` deltas is superseded.
*Source: `daemon.rs::Supervisor::apply_snapshot`.*

**T-23** Applying a snapshot, a client MUST stop every running server that is
absent from the snapshot or present with `enabled: false`.
*Source: `daemon.rs::apply_snapshot` (`to_drop`).*

**T-24** A client MUST treat `desired_state_update.added` and
`desired_state_update.updated` identically. The backend does not track a shadow
of what the client holds and sends the full current set under `updated`.
*Source: `daemon.rs::apply_delta`; `stdio_tunnel.py::push_desired_state`.*

**T-25** For a server already running, a client MUST kill and respawn it when
the incoming `DesiredServer` differs from the one it was started from, or when
the child has already exited. When the incoming spec is byte-identical and the
child is alive, the client MUST leave it running so an MCP session is not torn
down needlessly.
*Source: `daemon.rs::apply_snapshot` / `apply_delta` (`existing.desired_raw == d
&& !existing.has_exited()`); `proc.rs::ChildServer.desired_raw`.*

**T-26** Comparison for T-25 MUST use the **raw** `DesiredServer` as received,
before any local env overlay or `templated_args` substitution. Comparing the
enriched form would miss changes and would bake stale substitutions in.
*Source: `proc.rs::ChildServer.desired_raw` doc comment.*

**T-27** `desired_state_update.removed` entries MUST stop the named server and
MUST drop that server's locally stored values.
*Source: `daemon.rs::apply_delta` (`env_store.remove`).*

**T-28** Frames MUST be applied in arrival order. The backend relies on this:
`push_env_and_await_spawn` sends `server_env_update` **before** the
`desired_state_update` that triggers the spawn, so the env is staged by the time
the spawn reads it.
*Source: `stdio_tunnel.py::push_env_and_await_spawn` docstring.*

**T-29** A client MUST NOT expect secrets in steady-state desired state. The
backend always sends `env: {}` in `DesiredServer` for stdio tunnel servers;
values travel only in `server_env_update` / `server_spec_update`.
*Source: `stdio_tunnel.py::_load_desired_servers` (`env={}`).*

**T-30** `server_env_update` MUST be **merged** into the stored env for that
`server_id`: keys present in the frame overwrite, keys absent are preserved, and
any stored `templated_args` are untouched. The backend forwards only changed
keys.
*Source: `env_store.rs::EnvStore::merge_env`; `daemon.rs::apply_env_update`.*

**T-31** `server_spec_update` MUST merge `env` and `templated_args`
independently: a field that is absent or null MUST leave the corresponding
stored map untouched, and a field that is present MUST be merged key-by-key.
`command`, args structure, and `working_dir` are never carried by this frame.
*Source: `env_store.rs::EnvStore::merge_template_values`; `daemon.rs::apply_spec_update`.*

**T-32** After a `server_env_update` or `server_spec_update`, a client MUST
restart that server if it is currently running, so the new values take effect
without waiting for a desired-state push.
*Source: `daemon.rs::apply_env_update` / `apply_spec_update`.*

**T-33** A `server_env_update` or `server_spec_update` for a `server_id` the
client does not yet know MUST be stored rather than dropped, and applied when
the matching desired state arrives.
*Source: `daemon.rs::apply_env_update` doc comment (no-op on unknown server, value still persisted).*

**T-34** At spawn time the stored env MUST win wholesale when it is non-empty;
when it is empty or absent the client MUST fall back to `DesiredServer.env`. The
two maps are not merged.
*Source: `env_store.rs::resolve_env_for_spawn`.*

**T-35** `templated_args` MUST be applied as literal substring replacements over
each element of `DesiredServer.args`. Keys include their braces (`"{PP}"`). A
client MUST NOT parse a template syntax of its own or alter the args structure.
*Source: `env_store.rs::substitute_templated_args`.*

**T-36** `server_id` is the routing key in every per-server frame and MUST be
echoed exactly. The backend currently uses the server's name as `server_id`.
*Source: `stdio_tunnel.py::_load_desired_servers` (`server_id=row.name`).*

---

## 5. Spawn acknowledgements

**T-37** After a successful start a client MUST send
`server_spawn_result{server_id, ok: true, error: null}`.
*Source: `daemon.rs::Supervisor::try_spawn` (Ok arm).*

**T-38** After a failed start a client MUST send
`server_spawn_result{server_id, ok: false, error: "<reason>"}` with a
human-readable reason.
*Source: `daemon.rs::try_spawn` (Err arm).*

**T-39** The result MUST be sent promptly: the backend blocks the HTTP
create/update response on it for `SPAWN_ACK_TIMEOUT_SECONDS` (10s) and returns a
504 to the operator when nothing arrives. A client that needs longer to
initialise SHOULD still ack as soon as the unit is started, and report a later
failure via `tunnel_error` (T-42).
*Source: `stdio_tunnel.py::SPAWN_ACK_TIMEOUT_SECONDS`,
`registry.py::wait_for_spawn_result`.*

**T-40** A client MUST emit a spawn result for every spawn attempt, including
attempts triggered by reconnect reconciliation that no HTTP caller is waiting
on. The backend drops unsolicited results silently.
*Source: `registry.py::_dispatch_inbound` (`ServerSpawnResult` arm).*

**T-41** A client MUST NOT send a spawn result for a server it declines to start
because `enabled` is false. The backend does not wait for one in that case.
*Source: `daemon.rs::apply_snapshot` / `apply_delta` (disabled servers skipped);
`stdio_tunnel.py::push_env_and_await_spawn` (early return when not enabled).*

---

## 6. Failure signalling

This group is the load-bearing part of the contract: without it, an in-flight
tool call against a dead server hangs until the caller gives up.

**T-42** When a server's output pump reaches EOF or errors (the child died, the
module went away), the client MUST, on that pump's shutdown path, emit
`tunnel_error{server_id: "<the dead server>", related_jsonrpc_id: null, code:
"server_offline", message: "<diagnostic>"}` before the pump exits.
*Source: `proc.rs::stdout_pump` (trailing `report_terminal`), `proc.rs::report_terminal`.*

**T-43** The `server_offline` report MUST be emitted at most once per child
lifetime, even when several code paths observe the death concurrently (output
pump EOF, input pump write error, a frame addressed to an exited child). The
reference client uses a one-shot latch.
*Source: `proc.rs::ChildDiagnostics::take_terminal_error` (`reported.swap`).*

**T-44** A spawn failure MUST produce **both** `server_spawn_result{ok:false}`
and `tunnel_error{code:"spawn_failed", server_id}`, in that order. The backend
treats `spawn_failed` and `server_offline` as terminal for the current child:
both drop the cached MCP client and both write a `server_crashed` audit row.
*Source: `daemon.rs::try_spawn` (Err arm); `registry.py::_dispatch_inbound`.*

**T-45** A per-server failure MUST NOT close the WebSocket and MUST NOT affect
other servers on the same device.
*Source: `proc.rs` pumps (per-child tasks); `ARCHITECTURE.md` "Active failure signalling".*

**T-46** An inbound `mcp_frame` naming a `server_id` the client does not have
MUST be dropped with a log entry. The client MUST NOT synthesise an error frame
for it. The backend does the same in the other direction.
*Source: `daemon.rs::drain_incoming` (`mcp_frame for unknown server; dropping`);
`registry.py::_dispatch_inbound`.*

**T-47** When an inbound `mcp_frame` targets a server the client knows to be
dead, the client MUST answer with the pending terminal `tunnel_error` if it has
not already been reported (T-43), so the caller's request fails instead of
disappearing.
*Source: `daemon.rs::drain_incoming` (`child.take_terminal_error`).*

**T-48** Diagnostic text attached to a terminal `tunnel_error` MUST be redacted
before it leaves the device: known secret values are replaced, credential-shaped
lines are dropped, and the tail is bounded. The reference client keeps at most
20 lines / 8 KiB of stderr, truncating each line at 500 characters.
*Source: `proc.rs::ChildDiagnostics::record_stderr`, `proc.rs::sanitize_diagnostic_line`.*

**T-49** A **device-wide** `tunnel_error` from the backend (`server_id` null) is
a session-level rejection. A client MUST end the session, surface
`tunnel_error.message` to the user, and fall back to its reconnect policy. A
**per-server** `tunnel_error` from the backend MUST NOT end the session.
*Source: `daemon.rs::drain_incoming` (`if err.server_id.is_none() { bail!(...) }`);
`registry.py::_dispatch_inbound` (device-wide errors broadcast to every inbox).*

**T-50** A client MUST NOT retry MCP requests across a disconnect. On close the
backend fails every outstanding call with a `device_offline` error and the
calling agent decides whether to retry.
*Source: `registry.py::_mark_closed`.*

**T-51** A client SHOULD detect a server that has stopped consuming input and
recover by restarting it. The reference client emits
`tunnel_error{code:"server_unresponsive"}` and then kills and respawns the child
when the per-child queue is full.
*Source: `daemon.rs::drain_incoming` (`TrySendError::Full` arm),
`daemon.rs::restart_unresponsive`.*

### Error codes at v2

`tunnel_error.code` is a closed set of bare strings; there is no namespacing and
no numeric mapping. A receiver MUST tolerate an unrecognised code (log and
carry on) rather than failing the frame.

| Code | Direction | Meaning | Governed by |
|------|-----------|---------|-------------|
| `server_offline` | client → backend | The child for `server_id` is gone: its output pump hit EOF or errored, its input pump failed to write, or a frame arrived for a child already known dead. Terminal for that child, and emitted at most once per child lifetime | T-42, T-43, T-47 |
| `spawn_failed` | client → backend | The client tried to start `server_id` and could not (binary missing, exec refused, module URI unrecognised). Always accompanies a `server_spawn_result{ok:false}` and follows it | T-44 |
| `server_unresponsive` | client → backend | The child for `server_id` stopped consuming its input: the per-child queue filled, so this request could not be delivered. The client then kills and respawns the child | T-51 |
| `stdio_tunnel_disabled` | backend → client | Device-wide (`server_id` null): the org has the `stdio_tunnel_enabled` feature flag off. The backend closes with 1008 straight after | T-07, T-49 |
| `device_offline` | backend-internal | The backend fails every outstanding call with this when a device's socket closes. A client never sends or receives it on the wire | T-50 |

---

## 7. Heartbeat and liveness

**T-52** A client MUST send application-level `ping` frames on its own cadence.
These are `TunnelFrame` JSON frames, not WebSocket control frames. The backend
answers each with `pong` and never initiates a ping of its own.
*Source: `daemon.rs::heartbeat`; `registry.py::_dispatch_inbound` (`Ping` arm).*

**T-53** A client MUST answer an inbound `ping` with `pong`.
*Source: `daemon.rs::drain_incoming` (`Ping` arm).*

**T-54** Liveness MUST be judged on **any** inbound frame, not on `pong` alone.
Traffic of any kind proves the peer is alive.
*Source: `daemon.rs::drain_incoming` (bumps `last_pong` for every frame).*

**T-55** When no inbound frame arrives within the staleness window, a client MUST
tear the session down and reconnect. The reference client pings every 15s
(`HEARTBEAT_INTERVAL`) and declares staleness after 25s
(`HEARTBEAT_STALE_AFTER`).
*Source: `daemon.rs::HEARTBEAT_INTERVAL`, `daemon.rs::HEARTBEAT_STALE_AFTER`, `daemon.rs::heartbeat`.*

**T-56** The heartbeat cadence is a **client-class parameter**. The backend
imposes no cadence and applies no idle timeout of its own, so a battery- or
radio-constrained client MAY stretch both the interval and the staleness window.
A client MUST keep the staleness window comfortably longer than its own ping
interval.
*Source: `registry.py::run_receive_loop` (no timeout, no server-side ping).*

**T-57** A client SHOULD detect suspend/resume by comparing wall-clock time
between heartbeat ticks and tear the session down immediately when the gap far
exceeds the interval, rather than waiting out a monotonic timer that was frozen
while the host slept. The reference threshold is 45s
(`HEARTBEAT_RESUME_GAP`).
*Source: `daemon.rs::HEARTBEAT_RESUME_GAP`, `daemon.rs::heartbeat`.*

**T-58** A client SHOULD enable TCP keepalive on the socket to shorten zombie
detection. The Rust daemon does not configure this today (see deltas).

---

## 8. Reconnect policy

**T-59** A client MUST back off exponentially between reconnect attempts,
doubling from a floor and capping at a ceiling, with jitter applied to each
wait. The reference curve is 1s doubling to a 30s cap with plus or minus 25%
jitter.
*Source: `daemon.rs::BACKOFF_MIN`, `daemon.rs::BACKOFF_MAX`, `daemon.rs::jittered`.*

**T-60** A client MUST retry forever on transient failures: DNS failure,
connection refused, TLS failure, a 5xx on the upgrade, and any close that is not
covered by T-61 or T-62.
*Source: `daemon.rs::run` (non-auth, non-protocol error branch).*

**T-61** A client MUST STOP retrying on an authentication rejection and enter a
`needs_reauth` state: HTTP 401 or 403 on the upgrade, or a 1008 close whose
reason is `client credential revoked` or `client installation revoked`. It MUST
stop its child servers, record the reason, and wait for the stored credential to
change before reconnecting.
*Source: `tunnel.rs::ConnectError::needs_reauth`,
`tunnel.rs::SessionCloseError::needs_reauth`, `tunnel.rs::session_close_error`,
`daemon.rs::run` (`needs_reauth` branch), `daemon.rs::wait_for_config`.*

**T-62** A client MUST STOP retrying and enter a `needs_upgrade` state on a 1008
close whose reason mentions `protocol_version` (the rejection in T-09), and MUST
wait for a binary/config change rather than reconnecting on a timer. Retrying
would loop forever: the version is a property of the binary, not of the network.
The match MUST be on the `protocol_version` token rather than on a fixed prefix
or an exact string. The backend owns the wording and has already reworded it
once, and every other 1008 reason names a credential, a device, or a frame, so
the token is unambiguous on its own.
*Source: `tunnel.rs::session_close_error`, `tunnel.rs::SessionCloseError::needs_upgrade`,
`daemon.rs::run` (`needs_upgrade` branch).*

**T-63** Other 4xx upgrade rejections are classified as transient
(`UpgradeRejected`) and are retried under the normal backoff. A client MAY
instead settle to a steady long interval for these, which is what
`ARCHITECTURE.md` describes.
*Source: `tunnel.rs::connect` (non-401/403 statuses).*

**T-64** Child servers MUST survive a transient disconnect. A client MUST NOT
kill children on a plain reconnect; it rewires its outbound channel to the new
socket and reconciles against the fresh snapshot.
*Source: `daemon.rs::run` (supervisor outlives sessions), `tunnel.rs::OutgoingHandle`.*

**T-65** A client MUST stop all children when the connection identity changes:
different backend origin, credential kind, client installation id, or device id.
It MUST also switch to the matching per-installation value store.
*Source: `daemon_auth.rs::requires_child_reset`, `daemon_auth.rs::env_namespace`,
`daemon.rs::Supervisor::switch_env_store`.*

**T-66** A client MUST reset its backoff to the floor when the connection
configuration changes or a session ends cleanly, so a fresh login reconnects
immediately.
*Source: `daemon.rs::run` (`backoff = BACKOFF_MIN`).*

---

## 9. Client-state surface

The desktop tray reads the daemon's `state.json` directly, so its shape is part
of the client contract even though it never touches the wire.

**T-67** A client that ships with the Edison desktop app MUST publish a
`state.json` with these members: `connection_state`, `backend_url`, `device_id`,
`device_label`, `last_connected_at`, `last_error`, `servers[]`, `generation`.
Every member except `servers` and `generation` is nullable.
*Source: `state.rs::State`; consumer `packages/desktop/src/main/stdiod/types.ts::StdiodLiveState`.*

**T-68** `connection_state` MUST be one of `starting`, `connected`,
`reconnecting`, `needs_reauth`, `needs_upgrade`. `needs_reauth` and
`needs_upgrade` are states of this enum; there are no separate boolean fields.
*Source: `state.rs::ConnectionState`; `types.ts::ConnectionState`.*

**T-69** Each `servers[]` entry MUST carry `name`, `state` (one of `starting`,
`running`, `crashed`), and a nullable `pid`. A reader MUST accept all three
values; a writer MUST report the value its own observations support and MUST
NOT report `running` for a child it knows to be dead. `crashed` means the
client observed the process exit (an exit status, or a reap during shutdown).
A client MUST NOT report `crashed` on the strength of a failed interaction
alone: a child whose stdin no longer accepts writes is terminal for MCP and
gets its `server_offline` under T-42, but until its exit is observed it is
still a running process and the entry stays `running`. The supervisor's next
reconciliation kills and respawns such a child, so the state is self-healing.

A subprocess client can honestly distinguish only two of the three. The
reference client reports `crashed` once it has an exit observation for the
child and `running` otherwise, keeping the entry until reconciliation respawns
or drops it. It never reports `starting`: a stdio MCP server writes nothing until the
backend opens a session against it, which can be hours after the spawn, so
treating "no output yet" as `starting` would pin healthy idle children there,
and the daemon has no other health signal to key on. A client class with a real
activation step (the in-process client in the appendix, which acquires OS
permissions and adapters before it can serve) MAY report `starting` for the
duration of that step.
*Source: `daemon.rs::child_entry`, `state.rs::ServerEntry`,
`state.rs::ServerStatus`; `types.ts::StdiodServerEntry`.*

**T-70** Writes MUST be atomic (write to a temporary path, then rename) so a
polling reader never sees a torn file.
*Source: `state.rs::State::write_atomic`.*

**T-71** `generation` MUST increase on every write so a poller can cheaply
detect "nothing changed".
*Source: `state.rs::StateWriter::update`.*

**T-72** A client MUST write on connection-state transitions and child
spawn/death, and MUST NOT write per forwarded frame. Death is the one that is
easy to miss: nothing else wakes the supervisor when a child dies on its own,
so the reference client publishes the `crashed` entry from the same pump path
that emits `server_offline`, once per death and only when that path saw the
process exit (T-69). Without that write the tray would keep showing `running`
until the next reconciliation, which may be hours away.
*Source: `state.rs` module docs; `daemon.rs::Supervisor::publish_state`;
`proc.rs::report_terminal` / `proc.rs::mark_entry_crashed`.*

**T-73** Persisting state is best-effort: a write failure MUST be logged and
swallowed, never allowed to stall the reconnect loop.
*Source: `state.rs::StateWriter::update`.*

---

## Known deltas from ARCHITECTURE.md

`ARCHITECTURE.md` is the narrative design document and runs ahead of the code in
several places. None of the following is normative.

**Frames described but not implemented anywhere** (absent from the JSON Schema,
the Rust `TunnelFrame` enum, and the backend pydantic union):

| Frame | Where it appears |
|-------|------------------|
| `device_status` | ARCHITECTURE.md "Control frames" |
| `creds_invalidated` | ARCHITECTURE.md "Control frames", `state.rs::ConnectionState::NeedsReauth` comment |
| `fetch_logs_request` / `fetch_logs_response` | ARCHITECTURE.md "Control frames" |

**Frame in the schema only:** `announce_server` is defined in
`schema/tunnel-protocol.json` but implemented in neither Rust nor pydantic. It
is on the backend check script's allow-list
(`scripts/check_tunnel_protocol_schema.py::_SCHEMA_AHEAD_VARIANTS`) and has no
golden fixture.

**Behavioural deltas:**

| ARCHITECTURE.md says | Implementation |
|----------------------|----------------|
| Version types are generated from JSON Schema via `schemars`/`typify` | Both Rust and pydantic types are hand-written and kept in step by `check_tunnel_protocol_schema.py` |
| Schema path `schema/edison-tunnel-protocol.json` | Actual path is `schema/tunnel-protocol.json` |
| WS Ping every 15s, close if no Pong within 10s | Application-level `ping` frames every 15s; staleness declared after 25s of *any* silence (`HEARTBEAT_STALE_AFTER`) |
| TCP keepalive is enabled | Not configured; `tokio-tungstenite` defaults apply (T-58) |
| Backoff caps at 60s | Caps at 30s (`BACKOFF_MAX`) |
| Other 4xx backs off to a steady 60s | Classified as a transient `UpgradeRejected` and retried on the normal curve (T-63) |
| `needs_reauth=true` / `needs_upgrade=true` in `state.json` | Values of the `connection_state` enum, not boolean fields (T-68) |
| `state.json` example fields | The real struct also has `device_id` and `generation` (T-67) |
| `server_hello` example shows `env` per server | Steady-state pushes always send `env: {}` (T-29) |
| `state.json` example shows a `starting` child | The reference client reports only `running` / `crashed` (T-69) |

The version-window delta is closed: `ARCHITECTURE.md` described a backend that
refuses clients below a minimum supported version, and the backend now checks
`MIN_SUPPORTED_PROTOCOL_VERSION <= client <= PROTOCOL_VERSION` (T-09) rather
than strict equality. Both bounds are `2`, so nothing observable changes at v2;
what changed is that widening the window is now a one-line backend edit instead
of a protocol redesign.

**Schema versus implementation:** the schema declares
`additionalProperties: false` on every variant, while both implementations
ignore unknown members (T-18). `TunnelError.related_jsonrpc_id` is typed as
`string | integer | null` in the schema and as `int | str | None` in pydantic,
but as an unconstrained `serde_json::Value` in Rust, so the Rust client accepts
JSON-RPC ids the other two would reject.

**Reported state:** `state.rs::ServerStatus` defines three values and the
reference client produces two of them, `running` and `crashed` (T-69).
`starting` is reserved for a client class that has an observable activation
step; a subprocess client has none.

---

## Appendix: intentional divergence for non-subprocess clients

A client that hosts capability modules in-process rather than spawning
subprocesses (the planned Android/iOS client, design at
`dev-docs/architecture/mobile-hardware-gateway-design.md` in the edison-watch
repo) maps three concepts differently while satisfying every MUST above.

| Concept | Subprocess client | In-process client |
|---------|-------------------|-------------------|
| `DesiredServer.command` | An executable resolved on PATH | A virtual URI (`edison-mobile://<module>`) naming a built-in module. An unrecognised URI is a spawn failure, so it reports `server_spawn_result{ok:false}` per T-38 |
| Spawn | `fork`/`exec` plus stdio pumps | Activate the module: acquire OS permissions and adapters, then ack per T-37 |
| Child death | Output pump EOF | Module fatal (adapter revoked, permission withdrawn), reported as `tunnel_error{code:"server_offline"}` per T-42 |
| `DesiredServer.args` / `env` / `working_dir` | Process argv, environment, cwd | Module configuration. `templated_args` substitution still applies as literal string rewriting per T-35 |
| Reported `state` (T-69) | `running` / `crashed`; no observable start-up phase | MAY add `starting` while the module acquires permissions and adapters, since that step is observable |
| Heartbeat cadence | 15s ping / 25s stale | MAY be stretched for battery and radio budget per T-56 |

Constraints that hold regardless of client class: one WebSocket per device
(T-01), `client_hello` first with a matching `device_id` (T-08, T-10), opaque
MCP bodies (T-20), the snapshot being authoritative on reconnect (T-22),
`server_offline` on module death (T-42), and no MCP retries across a disconnect
(T-50).

Adding `android` / `ios` to `client_hello.os` is a protocol change under T-12
and requires the schema, the Rust enum, and the pydantic literal to move
together, along with a new golden fixture.
