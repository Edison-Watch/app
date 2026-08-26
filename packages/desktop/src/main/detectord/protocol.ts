// TypeScript mirror of the daemon's wire protocol (detectord/crates/
// mcp_detector_daemon/src/protocol.rs). Newline-delimited JSON over the Unix
// socket: one Reply per Request (FIFO), plus unsolicited Event pushes.

export type Choice = 'send_to_ew' | 'skip'

export type Request =
  | {
      op: 'enroll'
      url: string
      key: string
      mcp_url?: string
      agents?: string[]
      secret?: string
      /** false = detect-only (no sealgate install / hooks). Defaults true. */
      install?: boolean
      /** Arm auto-quarantine. Set true only once onboarding completes. */
      armed?: boolean
    }
  | { op: 'status'; refresh?: boolean }
  | { op: 'list_agents' }
  | { op: 'list_servers' }
  | {
      op: 'disposition'
      name: string
      agent?: string
      choice: Choice
      rename?: string
      /** For SendToEw: submit this (manually redacted) config instead of the
       *  daemon's discovered one, honoring the credential-review overrides. */
      submit_config?: ServerConfig
      /** Register directly (true) or leave pending approval (false). Omit to
       *  let the daemon decide from the user's role. */
      register?: boolean
    }
  /** Install the sealgate entry + session hooks for these agents only. */
  | { op: 'apply_integrations'; agents: string[] }
  /** Remove the sealgate entry for these agents. */
  | { op: 'revert_integrations'; agents: string[] }
  /** An agent's user-scope config file (path + contents), for display. */
  | { op: 'read_config'; agent: string }
  /** Put quarantined servers back: one by name, or all when omitted. */
  | { op: 'restore_quarantined'; name?: string }
  | { op: 'refresh_policy' }
  | { op: 'verify_secret'; key: string }
  | { op: 'reset_secret'; key: string; confirm: boolean }
  | { op: 'unenroll' }

export interface Status {
  user: string
  enrolled: boolean
  org_id?: string | null
  org_name?: string | null
  email?: string | null
  role?: string | null
  quarantine: boolean
  quarantined_count: number
  armed?: boolean
  /**
   * Whether the DAEMON holds macOS Full Disk Access. `null` off macOS,
   * `undefined` from a daemon predating the field.
   *
   * DIAGNOSTIC ONLY - nothing in the app reads it. The daemon does not need the
   * grant: it never watches `$HOME` or the protected folders, so there is
   * nothing for FDA to unlock. Kept on the wire because it is useful in a bug
   * report and only the daemon can answer it for the daemon (TCC grants are
   * per-binary, and the app is a separate binary with its own signature).
   */
  full_disk_access?: boolean | null
}

export interface AgentInfo {
  name: string
  installed: boolean
  /**
   * Hook bindings this agent has and how many are injected, counted by the
   * daemon with the same checks its injector uses. The app reports coverage
   * from these instead of opening the agent's hook file.
   */
  hooks_total?: number
  hooks_installed?: number
  /** URL of the installed sealgate entry, or null when there isn't one. */
  sealgate_url?: string | null
  /** The agent's user-scope config file, for display and `read_config`. */
  config_path?: string | null
  /**
   * Workspace-level hook targets the daemon found for this agent (one
   * `.vscode/tasks.json` per enumerated VSCode workspace) and how many already
   * carry the SealGate task. The daemon counts these because the targets
   * live in the user's project directories - the app deliberately never opens
   * those. Absent from pre-0.6 daemons, hence optional.
   */
  workspace_hooks_total?: number
  workspace_hooks_installed?: number
  /**
   * Whether SealGate can manage this agent at all, or only report that it's
   * there. False for hosts whose MCP servers are Connectors in the vendor's
   * account (ChatGPT) - nothing local to read, write, hook, or proxy.
   *
   * Absent from daemons predating the field, and absence must read as `true`:
   * every agent that existed before it is manageable, and defaulting the other
   * way would silently drop real clients out of setup status.
   */
  manageable?: boolean
}

/** One discovered server instance. `state`: sealgate | known | new | opaque | report. */
// Mirrors the daemon's externally-tagged mcp_detector_lib::ServerConfig.
export type HttpKind = 'Http' | 'Sse' | 'StreamableHttp'
export type OpaqueReason = 'ExtensionProvider' | 'ExtensionServer' | 'CursorPlugin'
export type ServerConfig =
  | { Stdio: { command: string; args: string[]; env: Record<string, string> } }
  | { Http: { url: string; headers: Record<string, string>; kind: HttpKind } }
  | { Opaque: { removable: boolean; reason: OpaqueReason } }

export interface ServerView {
  name: string
  agent: string
  kind: string // stdio | http | opaque
  state: string
  fingerprint?: string | null
  path: string
  config?: ServerConfig | null
}

/** What installing or removing the sealgate entry did for one agent. */
export interface IntegrationChange {
  agent: string
  /** The config file written; null when the agent's own CLI owns the path. */
  path?: string | null
  /** The one-time backup taken before our first edit, if it exists. */
  backup_path?: string | null
  ok: boolean
  error?: string | null
}

export interface SecretOutcome {
  valid?: boolean | null
  expired?: boolean | null
  deleted?: number | null
}

export type Reply =
  | ({ reply: 'status' } & Status)
  | { reply: 'integrations'; changes: IntegrationChange[] }
  | { reply: 'config'; path: string; content: string | null }
  | { reply: 'restored'; restored: number; errors: string[] }
  | { reply: 'agents'; agents: AgentInfo[] }
  | { reply: 'servers'; servers: ServerView[] }
  | ({ reply: 'secret' } & SecretOutcome)
  | { reply: 'ack' }
  | { reply: 'error'; message: string }

export type DetectordEvent =
  | ({ event: 'quarantined' } & ServerView)
  | ({ event: 'discovered' } & ServerView)
  | { event: 'policy_changed'; quarantine: boolean }

/** A line from the daemon is either a Reply or an Event. */
export function isEvent(msg: unknown): msg is DetectordEvent {
  return typeof msg === 'object' && msg !== null && 'event' in msg
}

export function isReply(msg: unknown): msg is Reply {
  return typeof msg === 'object' && msg !== null && 'reply' in msg
}
