import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'

/**
 * The desktop app must not read or write files it doesn't own.
 *
 * Agent configs, hook files, IDE state databases and anything inside a user's
 * project directory belong to the detector daemon: it holds the OS permissions
 * to reach them (on macOS those paths are TCC-gated) and it is the single
 * writer, so the app asking the daemon is what keeps the two from disagreeing.
 *
 * This test is the boundary's CI guard. It is intentionally a coarse check on
 * *imports* rather than paths - a module that imports `fs` at all is a module
 * that can wander - so every entry below carries the reason it's allowed. If
 * you're adding one, the question to answer is "does the app own this file?".
 * If a daemon-owned file is the answer, add a daemon op instead.
 */

const SRC = join(__dirname, '..', '..')

/** Modules allowed to touch the filesystem, and why. All app-owned paths. */
const FS_ALLOWLIST: Record<string, string> = {
  'main/index.ts': "the app's own single-instance lock + startup log",
  'main/infra/fsAudit.ts': 'the SEALGATE_FS_AUDIT harness: patches fs to police this very boundary',
  'main/infra/setupConfig.ts': "the app's own setup/accounts JSON in userData",
  'main/infra/updateSettings.ts': "the app's own update settings in userData",
  'main/ipc/ipcHandlers.ts': "the app's own safeStorage-encrypted key blob",
  'main/runtime/monitorLog.ts': "the app's own log file",
  'main/runtime/desktopIntegration.ts': "the app's own .desktop entry (Linux)",
  'main/runtime/pythonBinary.ts': "the app's own bundled Python runtime",
  'main/runtime/stdiodBinary.ts': "the app's own bundled stdiod binary (staging + hash)",
  'main/detectord/binary.ts': "the app's own bundled detectord binary (staging + hash)",
  'main/stdiod/controller.ts': "/dev/fd probe + SealGate's own stdiod state",
  'main/stdiod/state.ts': "SealGate's own stdiod state file",
  'main/stdiod/installStamp.ts': "SealGate's own stdiod install stamp in userData",
  'main/stdiod/installRefresh.ts': "SealGate's own stdiod LaunchAgent plist",
  'main/stdiod/stdiodLog.ts': "SealGate's own stdiod log file"
}

/**
 * Subprocesses are a second way to reach a file, so they're bounded too:
 * a child's file access is attributed to this app, not to the child.
 */
const SUBPROCESS_ALLOWLIST: Record<string, string> = {
  'main/infra/setupConfig.ts': "`claude mcp list` - asks Claude Code for its own runtime MCP status; reads nothing itself",
  'main/detectord/controller.ts': 'runs the sealgate-detectord binary (service install/status)',
  'main/stdiod/controller.ts': 'runs the sealgate-stdiod binary + launchctl/schtasks/systemctl'
}

const FS_IMPORT = /(?:from\s+['"](?:node:)?fs(?:\/promises)?['"]|require\(\s*['"](?:node:)?fs(?:\/promises)?['"]\s*\))/
const SUBPROCESS_IMPORT =
  /(?:from\s+['"](?:node:)?child_process['"]|require\(\s*['"](?:node:)?child_process['"]\s*\))/

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue
      out.push(...sourceFiles(full))
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

/** Files under src/main and src/preload, as posix-ish paths relative to src/. */
function scan(pattern: RegExp): string[] {
  const roots = ['main', 'preload'].map((d) => join(SRC, d))
  const hits: string[] = []
  for (const root of roots) {
    for (const file of sourceFiles(root)) {
      if (pattern.test(readFileSync(file, 'utf-8'))) {
        hits.push(relative(SRC, file).split(sep).join('/'))
      }
    }
  }
  return hits.sort()
}

describe('filesystem boundary', () => {
  it('only app-owned modules touch the filesystem', () => {
    const unexpected = scan(FS_IMPORT).filter((f) => !(f in FS_ALLOWLIST))
    expect(
      unexpected,
      'These modules import `fs`. Files belonging to another application (agent ' +
        'configs, hook files, IDE state DBs, anything in a user project) are the ' +
        "daemon's to read - add a daemon op instead. If the file really is the " +
        "app's own, add it to FS_ALLOWLIST with the reason."
    ).toEqual([])
  })

  it('only app-owned modules spawn subprocesses', () => {
    const unexpected = scan(SUBPROCESS_IMPORT).filter((f) => !(f in SUBPROCESS_ALLOWLIST))
    expect(
      unexpected,
      'These modules spawn subprocesses. A child process reading a file does it ' +
        "on this app's behalf (and under its TCC identity), so it's the same " +
        'boundary. Add to SUBPROCESS_ALLOWLIST with the reason if legitimate.'
    ).toEqual([])
  })

  it('keeps the allowlists honest - every entry is still used', () => {
    const fsUsers = new Set(scan(FS_IMPORT))
    const stale = Object.keys(FS_ALLOWLIST).filter((f) => !fsUsers.has(f))
    expect(stale, 'FS_ALLOWLIST entries whose module no longer touches fs - delete them').toEqual(
      []
    )

    const spawners = new Set(scan(SUBPROCESS_IMPORT))
    const staleSpawn = Object.keys(SUBPROCESS_ALLOWLIST).filter((f) => !spawners.has(f))
    expect(staleSpawn, 'SUBPROCESS_ALLOWLIST entries that no longer spawn - delete them').toEqual([])
  })

  it('no module reaches into another app’s config location', () => {
    // Path shapes that only ever appear when reading somebody else's files.
    const FOREIGN_PATHS = [
      /['"`][^'"`]*\.claude\.json/,
      /['"`][^'"`]*\.cursor[/\\]mcp\.json/,
      /['"`][^'"`]*\.codeium/,
      /workspaceStorage/,
      /state\.vscdb/,
      /\.vscode[/\\]tasks\.json/,
      /Application Support[/\\](?:Code|Cursor|Claude)/
    ]
    const offenders: string[] = []
    for (const root of ['main', 'preload'].map((d) => join(SRC, d))) {
      for (const file of sourceFiles(root)) {
        const text = readFileSync(file, 'utf-8')
        // Strip comments: these paths are legitimately *described* in prose.
        const code = text
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .split('\n')
          .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
          .join('\n')
        if (FOREIGN_PATHS.some((re) => re.test(code))) {
          offenders.push(relative(SRC, file).split(sep).join('/'))
        }
      }
    }
    expect(
      offenders.sort(),
      "These modules name another application's config path in code. Discovery, " +
        'hook status and every config write go through the daemon.'
    ).toEqual([])
  })
})
