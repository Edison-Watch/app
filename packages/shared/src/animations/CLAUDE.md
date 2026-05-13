# Animations

Each file is a self-contained SVG + CSS-keyframes animation sharing a
common visual vocabulary. Reuse the primitives in `_shared/` and the
metaphors below; don't reinvent.

## Conventions

- Pick a unique 2-4 letter CSS prefix; rediscover existing ones via
  `grep -h 'className="..-anim' */*.tsx`. Top-level class is
  `<prefix>-anim`; every keyframe gets the same prefix.
- Theme with `var(--text-primary)`, `var(--text-muted)`, `var(--accent)`.
  Reach for raw hex (`ORANGE`/`RED`/`DANGER`/`GREEN` from `_shared`) only
  when the semantic must survive theme overrides.
- End every animation with `<ProgressBar />` + a
  `@media (prefers-reduced-motion: reduce)` block that zeroes every
  animated class, forces the phase end-state, hides packets, and sets
  the progress bar to `scaleX(1)`. Canonical:
  `admin/OrgMCPPushAnimation.tsx:219-240`.
- Docstring template + per-phase narration: `feature/KeyEncryptionAnimation.tsx:1-23`.
- Default-export the component; re-export named from `index.ts`. Every
  animation has a sibling `*.stories.tsx`.

## Design-language metaphors

Canonical implementations - copy from these.

- **A. Admin sets policy → packets route through Edison → verdict
  badge.** The dominant arc. `admin/OrgMCPPushAnimation.tsx`.
- **B. Before/after Edison.** Color encodes time: `ORANGE`=pre-Edison,
  `var(--accent)`=Edison-mediated. Split-screen
  (`feature/StdioVsHttpAnimation.tsx`) vs phase-swap with packet recolor
  at the gateway (`admin/AdminFleetAnimation.tsx:111-115`).
- **C. Lethal trifecta.** Three-corner Agent↔Attacker↔Email loop,
  broken by inserting Edison on one edge.
  `threat/TrifectaDefenseAnimation.tsx`.
- **D. Encryption.** Orange open padlock + plaintext → accent closed
  padlock + `$EDISON$1$…` cipher. `feature/KeyEncryptionAnimation.tsx`.
- **E. Visibility.** Eye-slash (`DANGER`) ↔ eye (`var(--accent)`) swap
  + dashed vision rays.
  `admin/AdminFleetBlindAnimation.tsx#AdminNoVisibilityOverlay`.
- **F. Quarantine / shadow MCPs.** Orange-glowing rows labeled
  `NEW`/`QUARANTINED`, ending in a deny badge.
  `feature/DesktopClientAnimation.tsx:67-82`.
- **G. Boundary / sandbox.** Dashed rounded rect labeled `Your
  Infrastructure` / `Deno Sandbox`.
  `feature/FlexibleDeploymentAnimation.tsx:290-297`.
- **H. Org as row stack.** Department row = label + agent + headcount
  pips. `admin/ScalePilotAnimation.tsx:214-271`. Department names -
  Engineering / Sales / Finance / Legal / HR.

Labels carry meaning - don't drift: "Edison Gateway", "Edison Watch",
"Edison On-Prem", "Edison Cloud", "Edison Databases".

## `_shared/`

Surface (`_shared/index.ts`):

- `colors.ts`: `ORANGE`/`RED`/`DANGER`/`GREEN`
- `svg-paths.ts`: `EYE_PATH`, `EYE_SLASH_PATH`, `ADMIN_PATH`,
  `SHIELD_CHECK_PATH`, `PERSON_PATH`, `POISON_PATH`
- `icons.tsx`: `McpIcon`, `RobotIcon`, `AgentIcon`, `EdisonLogo`,
  `McpPacket`, `ProgressBar`
- `badges.tsx`: `VerdictBadge` - allow/deny circle (metaphor A glyph)
- `flow.tsx`: `FlowLine` - dashed `3 3` connector
- `gateway.tsx`: `EdisonGateway` - pulse ring + logo + optional label
- `admin.tsx`: `AdminFigure` - top-of-fleet persona
