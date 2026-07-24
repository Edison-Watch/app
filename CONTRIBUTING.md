# Contributing

Thanks for your interest in improving Edison Watch's client components! This is
early-stage, fast-moving software, so the contribution process is intentionally
lightweight.

## Getting started

This repo holds four components:

- `packages/desktop` - Electron desktop app (npm workspace)
- `packages/shared` - `@edison-watch/shared` React library (npm workspace)
- `crates/stdiod` - Rust daemon (its own Cargo workspace)
- `crates/detectord` - Rust library + daemon (its own Cargo workspace)

For the npm workspaces you'll need Node >= 22:

```sh
npm ci                                # from the repo root, once, for all packages
npm run build -w packages/shared      # the app consumes the built library
```

For the Rust crates you'll need a [Rust toolchain](https://rustup.rs/); the
channel and components for stdiod are pinned in
[`crates/stdiod/rust-toolchain.toml`](./crates/stdiod/rust-toolchain.toml), so
`rustup` will install the right versions automatically.

```sh
cargo build --workspace --manifest-path crates/stdiod/Cargo.toml
cargo build --manifest-path crates/detectord/Cargo.toml
```

## Before you open a pull request

Please make sure the same checks CI runs pass locally for the component you
touched.

npm packages (run inside `packages/shared` or `packages/desktop`):

```sh
npm run typecheck && npm run lint && npm run format:check && npm run test
```

Rust crates (run inside `crates/stdiod` or `crates/detectord`):

```sh
cargo fmt --all --check && \
  cargo clippy --workspace --all-targets -- -D warnings && \
  cargo test --workspace
```

CI is path-filtered per component, so your PR only runs the checks for what it
changes.

## Guidelines

- **Keep changes focused.** Small, single-purpose PRs are easier to review;
  prefer touching one component per PR.
- **Match the surrounding style.** Follow the existing naming, comment density,
  and module layout; the formatters handle formatting.
- **Update docs alongside code.** If you change stdiod's wire protocol, update
  [`crates/stdiod/schema/edison-tunnel-protocol.json`](./crates/stdiod/schema/edison-tunnel-protocol.json)
  (the single source of truth) and
  [`crates/stdiod/ARCHITECTURE.md`](./crates/stdiod/ARCHITECTURE.md). If you
  change a CLI or config surface, update the component's README.
- **Add tests** for new behavior where practical.
- **Describe the why.** A short explanation of the motivation and approach in
  the PR description goes a long way.

## Reporting bugs and security issues

- For ordinary bugs and feature requests, open a
  [GitHub issue](https://github.com/Edison-Watch/app/issues).
- For **security vulnerabilities**, do **not** open a public issue - follow
  [`SECURITY.md`](./SECURITY.md) instead.

## License

By contributing, you agree that your contributions will be licensed under the
[GNU Affero General Public License v3.0](./LICENSE) that covers this project.
