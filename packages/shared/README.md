# @edison/shared

Shared React components, design tokens, and client-side utilities used by Edison Watch.

This repository is public so that the shared client code used across Edison Watch can be audited and evaluated. It is intentionally an Edison Watch package, not a generic component library or a hosted service SDK.

## Contents

- React UI components and Edison design tokens
- Product and security animations used in the Edison Watch clients
- Agent registry data and SVG assets
- Browser-side authentication, configuration, and crypto utilities

## Development

Requirements: Node.js 22 or later and npm.

```bash
npm ci
npm run typecheck
npm run test
npm run build
```

The build writes ESM, CommonJS, and TypeScript declaration files to `dist/`.

Additional commands:

```bash
npm run test:coverage
npm run storybook
npm run build-storybook
```

## Package Status

`@edison/shared` is not currently published to npm. Edison Watch repositories consume it from source, including through Git submodules. The package manifest and build output are maintained so that this can change without redesigning the public module surface.

Supported package entrypoints include:

- `@edison/shared`
- `@edison/shared/auth`, `@edison/shared/config`, and `@edison/shared/crypto`
- `@edison/shared/ui` and `@edison/shared/ui/*`
- `@edison/shared/hooks/*`
- `@edison/shared/agent-registry`, `@edison/shared/animations`, and `@edison/shared/svg`
- `@edison/shared/theme/tokens.css`

Consumers of the UI and auth modules must provide the declared peer dependencies: React, React DOM, React Router, and Supabase JS.

## Configuration Scope

The client configuration in `src/config/env-config.ts` intentionally contains Edison Watch service endpoints and browser-facing configuration values. This makes the client behavior auditable and supports the Edison Watch applications that consume this package.

Only values that are safe to expose in browser applications belong in this repository. Do not add server credentials, private keys, privileged API tokens, or other secrets.

## Visual Regression Tests

Visual tests are currently run manually when UI changes warrant them:

```bash
npm run build-storybook
npm run test:visual
```

After intentional visual changes, update and commit the baselines with:

```bash
npm run test:visual:update
```

## Contributing

Issues and focused contributions are welcome. Please open an issue with a clear description, expected behavior, and a minimal reproduction where possible. Broader organization-level contribution and security policies will be published separately.

## License

This project is licensed under the [GNU Affero General Public License v3.0 only](LICENSE).
