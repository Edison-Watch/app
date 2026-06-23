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
  - dashed vision rays.
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

## Copywriting

Captions and labels are read by **security-literate, not AI-literate**
buyers (enterprise IT admins, CISOs). Lead with verbs they already use
(`approve`, `block`, `ticket`, `audit`, `scope`, `permission`); never
ship AI-Twitter shorthand in a user-visible label. Canonical voice:
`admin/SecurityBusinessValueAnimation.tsx` ("Routine request -
approved automatically", "Sensitive data leaving the company -
blocked"). Grounding: SANS 2025 CISO AI report finds "insufficient AI
knowledge" is a top defense inhibitor.

Banlist for labels and captions - plain-English replacement on the
right. Internal codenames (metaphor C, etc.) may still use the
jargon; **user-visible text may not**.

| Don't write                                    | Write instead                                                                                   |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Lethal trifecta                                | "Three-way risk" or label the three corners (private data / outside content / outbound channel) |
| MCP / MCP server                               | "Connector" or the tool name ("Slack connector")                                                |
| MCP proxy                                      | "Edison Gateway" (canonical)                                                                    |
| Prompt injection                               | "Hidden instructions in content" / "poisoned content"                                           |
| Jailbreak                                      | "Bypasses the agent's rules"                                                                    |
| Tool call / tool-use                           | Name the action: "send email", "read file"                                                      |
| Agentic / A2A                                  | "AI agent" / "one AI talking to another"                                                        |
| Scope (OAuth-style)                            | "Permission" or "what the agent can touch"                                                      |
| Shadow MCP / MCP sprawl                        | "Unapproved connector" / "no connector inventory"                                               |
| Tool poisoning                                 | "Booby-trapped connector"                                                                       |
| RAG / embeddings / fine-tuning / system prompt | Skip, or "the agent's rulebook"                                                                 |
| HKDF / AES-256-GCM                             | "AES-256 encryption" - drop the primitive                                                       |
| Zero-knowledge encryption                      | "Keys never leave you"                                                                          |
| Exfiltration                                   | "Data leaving the company"                                                                      |
| PII / IP / confidential data                   | Name the data: "customer list", "source code", "salary file"                                    |

Rules:

1. **One clause per caption**, <=8 words. Two ideas - en-dash.
2. **Define an acronym before animating it.** If `MCP` or `RBAC` must
   appear, the first phase caption spells it once, then it's free.
3. **One name per concept.** `Edison Gateway` stays - don't drift to
   "proxy", "broker", "shim" (same rule as the metaphors section).
4. **Outcomes, not implementations.** "Sent to IT" beats "Routed via
   webhook"; "Blocked" beats "Policy denied tool-call".
5. **Answer at least one of:** _who acted?_ / _were they allowed?_ /
   _can I prove it after?_ That's the buyer's mental model.

When in doubt, read the label out loud to a CFO. If they ask "what's
an MCP?", rewrite.

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
