<div align="center">

# Edison Watch - App

<b>Everything Edison Watch runs on your machine.</b>

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)

</div>

This monorepo contains every client-side component of
[Edison Watch](https://edison.watch) - the pieces that are installed on your
machine, all open source and auditable. The server side lives elsewhere; the
trust boundary is exactly this repo.

## Components

| Component | Path | What it is |
| --- | --- | --- |
| Desktop app | [`packages/app/`](./packages/app) | Electron menu-bar app: discover, quarantine, and encrypt your AI tools' MCP servers |
| Shared library | [`packages/shared/`](./packages/shared) | `@edison-watch/shared` - React components, design tokens, and client utilities |
| stdiod | [`crates/stdiod/`](./crates/stdiod) | Rust daemon that runs local stdio MCP servers and tunnels them to the gateway |
| detectord | [`crates/detectord/`](./crates/detectord) | Rust library + daemon that detects and tracks MCP client configuration files |

Each component was formerly its own repository
([desktop](https://github.com/Edison-Watch/desktop),
[shared](https://github.com/Edison-Watch/shared),
[stdiod](https://github.com/Edison-Watch/stdiod),
[detectord](https://github.com/Edison-Watch/detectord)); their full git
histories were preserved in the import (tags are prefixed per component, e.g.
`desktop-v0.5.2`).

## Layout

- `packages/*` are npm workspaces rooted at this directory - run `npm ci` here,
  not inside a package.
- `crates/stdiod` and `crates/detectord` are two independent Cargo workspaces -
  run `cargo` commands from inside each.
- CI lives in [`.github/workflows/`](./.github/workflows), one prefixed set of
  workflows per component, path-filtered so a change to one component only runs
  that component's checks.

## Building

```sh
# Desktop app + shared library
npm ci
npm run build -w packages/shared
npm run dev -w packages/app          # or: npm run build:mac -w packages/app

# Daemons
cargo build --workspace --manifest-path crates/stdiod/Cargo.toml
cargo build --manifest-path crates/detectord/Cargo.toml
```

See each component's own README for details.

## License

[AGPL-3.0-only](./LICENSE), for every component in this repository.
