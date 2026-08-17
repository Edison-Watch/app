<div align="center">

# SealGate client apps

<b>Everything SealGate runs on your machine.</b>

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)

</div>

[SealGate](https://edison.watch) is a security gateway that sits between AI
tools (Claude, Cursor, VS Code, and friends) and the MCP servers they call, so
an organization can see, approve, and block what its AI agents do. Those MCP
servers can read files, hold credentials, and reach the network, and they're
configured in a dozen different places on each machine.

The client side of that lives here: a desktop app that finds every MCP server
configured across the AI clients on a machine, quarantines new or unapproved
ones before they run, and encrypts credentials with zero-knowledge keys, plus
the two daemons that do the on-machine work. Everything that gets installed on
a user's device is in this repository, open source and auditable. The gateway
and web dashboard are server-side and live elsewhere (see below).

## What's in this repo

| Component | Path | What it does |
| --- | --- | --- |
| Desktop app | [`packages/desktop/`](./packages/desktop) | Electron menu-bar app: discovery, quarantine review, credential encryption, and settings. The user-facing control plane. |
| stdiod | [`crates/stdiod/`](./crates/stdiod) | Rust daemon that spawns local stdio MCP servers and bridges them to the gateway over one outbound WebSocket. No inbound ports; the processes and their secrets stay on the device. |
| detectord | [`crates/detectord/`](./crates/detectord) | Rust daemon and library that watches the MCP config files of host apps (Claude Code, VS Code, Cursor, ...) and enforces quarantine. |
| Shared library | [`packages/shared/`](./packages/shared) | `@sealgate/shared`: the React components, design tokens, and client utilities the desktop app shares with the web dashboard. |

Each component's README covers its own architecture and usage.

## What's not in this repo

- The SealGate gateway (the server the daemons tunnel to) and the web
  dashboard are server-side and developed separately. The split is deliberate:
  this repo is exactly the code that runs with access to your machine, so it's
  the part you can audit.
- Product and setup docs are at [edison.watch](https://edison.watch).

Each component here started as its own repository
([desktop](https://github.com/Edison-Watch/desktop),
[shared](https://github.com/Edison-Watch/shared),
[stdiod](https://github.com/Edison-Watch/stdiod),
[detectord](https://github.com/Edison-Watch/detectord)) and was merged in with
its git history preserved. Tags carry a component prefix, e.g.
`desktop-v0.5.2`.

## Building

The JavaScript packages are npm workspaces rooted here; the two Rust crates
are independent Cargo workspaces. CI is path-filtered per component
([`.github/workflows/`](./.github/workflows)), so a change to one component
only runs that component's checks.

```sh
# Desktop app + shared library
npm ci
npm run build -w packages/shared
npm run dev -w packages/desktop          # or: npm run build:mac -w packages/desktop

# Daemons
cargo build --workspace --manifest-path crates/stdiod/Cargo.toml
cargo build --manifest-path crates/detectord/Cargo.toml
```

## Contributing and security

See [CONTRIBUTING.md](./CONTRIBUTING.md). For security issues, do not open a
public issue; follow [SECURITY.md](./SECURITY.md) (private advisory or
security@edison.watch).

## License

[AGPL-3.0-only](./LICENSE), for every component in this repository.
