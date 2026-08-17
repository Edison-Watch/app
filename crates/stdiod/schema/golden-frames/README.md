# Golden frames

One JSON file per wire example. Each file is a single JSON object exactly as it
appears on the WebSocket, with no envelope and no metadata around it.

They exist so every implementation of the tunnel protocol (the Rust daemon here,
the backend in the sealgate repo, a Kotlin/Android client later) can be
tested against the same bytes instead of against each other's assumptions. The
JSON Schema at `../tunnel-protocol.json` pins the shapes; these files pin the
values that shapes alone leave ambiguous, such as explicit `null` versus an
absent field and a JSON-RPC `id` that is a string rather than a number.

Behavioural requirements referenced below (T-xx) are in `../../PROTOCOL.md`.

## Compatibility rules

Every implementation MUST:

1. Parse every fixture in this directory into its frame type. A fixture that
   fails to parse is a protocol break, not a bad fixture.
2. Reserialize the parsed value and reparse it, producing a semantically equal
   object.
3. Preserve the `type` tag through the round trip.

"Semantically equal" means:

- Member order is irrelevant.
- `null` and absent are equivalent for optional members (T-17). A comparison
  should drop null-valued members from both trees before comparing.
- The `mcp_frame.frame` body is opaque and is compared verbatim as JSON. No
  implementation may rewrite it (T-20).
- Unknown members are ignored on parse (T-18), so they may be dropped by a round
  trip. Do not add fixtures that rely on unknown members surviving.

## Coverage

At least one fixture per variant of the `TunnelFrame` enum in
`../../crates/sealgate-tunnel-protocol/src/lib.rs`. The Rust test
`../../crates/sealgate-tunnel-protocol/tests/golden_frames.rs` (repo path: `crates/stdiod/crates/sealgate-tunnel-protocol/tests/golden_frames.rs`) enforces both directions:
a fixture for an unknown variant fails to parse, and a variant with no fixture
fails the coverage assertion.

| File | Variant | Why it exists |
|------|---------|---------------|
| `client_hello.json` | `client_hello` | Handshake frame with a non-empty `currently_running` |
| `server_hello.json` | `server_hello` | Snapshot with one enabled and one disabled server, `working_dir` set and null |
| `desired_state_update.json` | `desired_state_update` | All three lists populated |
| `mcp_frame_request.json` | `mcp_frame` | Numeric JSON-RPC id |
| `mcp_frame_response.json` | `mcp_frame` | String JSON-RPC id |
| `mcp_frame_notification.json` | `mcp_frame` | No id at all |
| `tunnel_error_device_wide.json` | `tunnel_error` | `server_id` and `related_jsonrpc_id` as explicit nulls, as the backend emits them |
| `tunnel_error_per_server.json` | `tunnel_error` | `server_offline` with a multi-line stderr tail |
| `tunnel_error_related_jsonrpc_id.json` | `tunnel_error` | `related_jsonrpc_id` carrying a value |
| `server_env_update.json` | `server_env_update` | Env merge payload |
| `server_spec_update.json` | `server_spec_update` | Both optional maps present |
| `server_spec_update_explicit_nulls.json` | `server_spec_update` | Both optional maps as explicit null |
| `server_spawn_result_ok.json` | `server_spawn_result` | Success with `error: null` |
| `server_spawn_result_err.json` | `server_spawn_result` | Failure with a reason string |
| `ping.json` | `ping` | Bare tag |
| `pong.json` | `pong` | Bare tag |

`announce_server` is defined in the JSON Schema but implemented in no client, so
it has no fixture. Add one when it ships.

## Adding a fixture

1. Add the file here, named after the variant. When a variant needs several
   fixtures, suffix them (`mcp_frame_request.json`, `mcp_frame_response.json`).
2. Write the frame as the wire actually carries it. If the backend emits a field
   as an explicit null, keep the null.
3. Add a row to the table above.
4. When the fixture covers a **new** variant, add the tag to `EXPECTED_VARIANTS`
   in `../../crates/sealgate-tunnel-protocol/tests/golden_frames.rs` (repo path: `crates/stdiod/crates/sealgate-tunnel-protocol/tests/golden_frames.rs`).
5. Run `cargo test --workspace` from `crates/stdiod`.
