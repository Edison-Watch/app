/**
 * Runtime filesystem audit: proves, on a running app, that nothing reads a file
 * the app doesn't own.
 *
 * The static import guard (`__tests__/fsBoundary.test.ts`) covers our own
 * source, but it can't see through dependencies or dynamic requires. This
 * patches `fs` itself and reports every path outside the app's own territory,
 * so you can exercise the real UI and read the verdict.
 *
 * Off unless `EDISON_FS_AUDIT=1`, and it only ever logs - it never blocks a
 * call, because a false positive that bricks the app would be worse than the
 * noise. Enable it in dev or on a packaged build:
 *
 *     EDISON_FS_AUDIT=1 npm run dev -w packages/desktop
 *     EDISON_FS_AUDIT=1 "/Applications/Edison Watch.app/Contents/MacOS/Edison Watch"
 *
 * Violations are appended to `/tmp/ew-fs-audit.log` (and echoed to the
 * console) as `FOREIGN <op> <path>` with the stack that got there - a file
 * rather than stdout because a redirected Electron stdout is block-buffered
 * and would strand the last lines. Electron's own reads (the asar, locales,
 * GPU caches) sit inside the allowed roots, so an empty log is a clean run:
 *
 *     rm -f /tmp/ew-fs-audit.log
 *     EDISON_FS_AUDIT=1 "/Applications/Edison Watch.app/Contents/MacOS/Edison Watch"
 *     # …exercise onboarding, the clients view, the tray…
 *     grep FOREIGN /tmp/ew-fs-audit.log   # nothing = the boundary held
 */

import { appendFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { app } from 'electron'

const AUDIT_LOG = '/tmp/ew-fs-audit.log'
const INVENTORY_LOG = '/tmp/ew-fs-audit-roots.log'

// The audit writes its own log through the very functions it patched, so
// without this guard the first report recurses forever.
let recording = false

function record(line: string): void {
  if (recording) return
  recording = true
  try {
    console.warn(`[fs-audit] ${line}`)
    appendFileSync(AUDIT_LOG, `[${new Date().toISOString()}] ${line}\n`)
  } catch {
    // The audit must never take the app down.
  } finally {
    recording = false
  }
}

/** Read-ish fs calls worth auditing. Writes are included: same boundary. */
const WATCHED = [
  'readFile',
  'readFileSync',
  'readdir',
  'readdirSync',
  'open',
  'openSync',
  'stat',
  'statSync',
  'lstat',
  'lstatSync',
  'access',
  'accessSync',
  'createReadStream',
  'writeFile',
  'writeFileSync',
  'appendFile',
  'appendFileSync',
  'copyFile',
  'copyFileSync',
  'rename',
  'renameSync',
  'unlink',
  'unlinkSync'
] as const

let allowedRoots: string[] = []
let inventory = false

function buildAllowedRoots(): string[] {
  const roots = [
    // The app bundle and everything Electron loads from it.
    process.resourcesPath,
    resolve(process.execPath, '..', '..'),
    // The app's own state.
    safe(() => app.getPath('userData')),
    safe(() => app.getPath('sessionData')),
    safe(() => app.getPath('logs')),
    safe(() => app.getPath('crashDumps')),
    safe(() => app.getPath('temp')),
    tmpdir(),
    // Shared temp: this log lives here, as does the app's own monitor log.
    // macOS `tmpdir()` is the per-user /var/folders dir, so /tmp needs saying.
    '/tmp',
    // Edison's own daemon territory. `~/.config/edison-stdiod` holds stdiod's
    // config + state file: stdiod writes it, the app polls it for tray/status
    // (see stdiod/state.ts), and that file IS the interface between them -
    // stdiod is a tunnel daemon with no control socket of its own.
    resolve(homedir(), '.edison-watch'),
    resolve(homedir(), '.config', 'edison-stdiod'),
    resolve(homedir(), '.local', 'share', 'edison-watch'),
    resolve(homedir(), 'Library', 'Application Support', 'edison-watch-detectord'),
    resolve(homedir(), 'Library', 'LaunchAgents'),
    resolve(homedir(), 'Library', 'Logs', 'Edison Watch'),
    resolve(homedir(), 'Library', 'Logs', 'edison-stdiod'),
    resolve(homedir(), '.local', 'state', 'edison-stdiod'),
    // /dev/fd: stdiod/controller.ts counts open descriptors there.
    '/dev',
    // The dev tree only exists when running unpackaged (electron-vite serves
    // main from out/ and resolves deps from node_modules). cwd itself is listed
    // too, since relative reads resolve against it and in a dev run that tree is
    // ours. NEVER when packaged: cwd is often `/` there, which would allowlist
    // the entire filesystem.
    ...(app.isPackaged
      ? []
      : [process.cwd(), resolve(process.cwd(), 'node_modules'), resolve(process.cwd(), 'out')])
  ].filter((p): p is string => !!p)
  // Deliberately NOT allowlisted: /System, /usr/lib, /usr/share, /proc. Electron
  // and Chromium read those from native code, which never passes through the
  // Node fs module this patches - a measured run confirms zero hits - so
  // listing them would only widen the blind spot.
  // Resolve symlinks once so /var vs /private/var doesn't cause false alarms.
  return [...new Set(roots.map((p) => safe(() => realpathSync(p)) ?? p))]
}

function safe<T>(fn: () => T): T | null {
  try {
    return fn()
  } catch {
    return null
  }
}

/** The allowed root covering `abs`, or null when nothing covers it. */
function matchRoot(abs: string): string | null {
  return allowedRoots.find((root) => abs === root || abs.startsWith(root + sep)) ?? null
}

/**
 * Per-root hit counts, kept in `all` mode. The allowlist is a suppression
 * list, not an inventory - this is how you find out which roots are actually
 * load-bearing and which are dead weight that only widen the blind spot.
 */
const rootHits = new Map<string, number>()

// Rewritten every N accesses rather than on a timer: a backgrounded Electron
// window gets its timers throttled by App Nap, and a killed process never runs
// exit handlers - either way a timer-based dump can simply never land.
let sinceDump = 0

function dumpInventory(): void {
  if (++sinceDump < 50) return
  sinceDump = 0
  const lines = [...rootHits.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([root, n]) => `${String(n).padStart(7)}  ${root}`)
  const unused = allowedRoots.filter((r) => !rootHits.has(r)).map((r) => `      -  ${r} (unused)`)
  try {
    writeFileSync(INVENTORY_LOG, [...lines, ...unused].join('\n') + '\n')
  } catch {
    // best-effort
  }
}

/**
 * The path an fs argument refers to, or null when it isn't one we can judge.
 *
 * Skipped: file descriptors (numbers) and non-file URLs. NOT skipped: relative
 * strings - they resolve against cwd, so treating them as unjudgeable would let
 * anything read outside an allowed root just by omitting the leading slash, and
 * the audit would still call the run clean.
 */
function toPath(target: unknown): string | null {
  if (typeof target === 'number') return null
  if (Buffer.isBuffer(target)) return target.toString('utf8')
  if (target instanceof URL) return target.protocol === 'file:' ? safe(() => fileURLToPath(target)) : null
  if (typeof target !== 'string' || target.length === 0) return null
  return target
}

function classify(target: unknown): { path: string; root: string | null } | null {
  const raw = toPath(target)
  if (raw === null) return null
  // `~` is shell syntax, not something fs expands; resolve it the way a user
  // reading the log would expect rather than against cwd.
  const expanded = raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : raw
  // resolve() makes relative paths absolute against cwd - the whole point of
  // classifying them.
  const full = resolve(expanded)
  // A file that doesn't exist yet can't be realpath'd, but its directory can -
  // without this, the first write to a new file under a symlinked parent
  // (/tmp -> /private/tmp on macOS) is misreported as foreign.
  const direct = safe(() => realpathSync(full))
  const abs =
    direct ??
    (() => {
      const parent = safe(() => realpathSync(dirname(full)))
      return parent ? join(parent, basename(full)) : full
    })()
  return { path: abs, root: matchRoot(abs) }
}

/**
 * Patch `fs` to report foreign paths. Call once, early in main, before any
 * module that might read something.
 */
export function installFsAudit(): void {
  const mode = process.env.EDISON_FS_AUDIT
  if (mode !== '1' && mode !== 'all') return
  // `all` also tallies the *allowed* reads per root, so the allowlist can be
  // checked against reality instead of taken on faith.
  inventory = mode === 'all'
  allowedRoots = buildAllowedRoots()

  // Patch the CommonJS module object, NOT an `import * as fs` namespace: an
  // ESM namespace is frozen, so assigning to it throws (silently, once Sentry
  // has installed its handlers) and the audit never arms.
  const req = createRequire(__filename)
  const realFs = req('fs') as Record<string, unknown>
  const realFsPromises = (realFs.promises ?? {}) as Record<string, unknown>

  let patchedCount = 0
  const patch = (host: Record<string, unknown>, name: string, label: string): void => {
    const original = host[name]
    if (typeof original !== 'function') return
    const fn = original as (...args: unknown[]) => unknown
    try {
      host[name] = function patched(this: unknown, ...args: unknown[]): unknown {
        const verdict = classify(args[0])
        if (verdict && verdict.root === null) {
          const stack = new Error().stack?.split('\n').slice(2, 7).join('\n') ?? ''
          record(`FOREIGN ${label} ${String(args[0])}\n${stack}`)
        } else if (verdict && inventory) {
          rootHits.set(verdict.root!, (rootHits.get(verdict.root!) ?? 0) + 1)
          dumpInventory()
        }
        return fn.apply(this, args)
      }
      patchedCount++
    } catch (err) {
      record(`could not patch ${label}: ${String(err)}`)
    }
  }

  for (const name of WATCHED) {
    patch(realFs, name, name)
    patch(realFsPromises, name, `promises.${name}`)
  }

  // The audit intercepts at property lookup on the shared `fs` module object,
  // which is what the bundle's call sites use (`node_fs.existsSync(...)`, from
  // named imports). That holds only while every fs specifier resolves to that
  // one object: an `import * as fs` anywhere would give Rollup a reason to emit
  // a frozen namespace COPY, whose properties keep the originals and silently
  // escape the audit. Check rather than assume - a quiet log that covers less
  // than it claims is worse than no log.
  for (const specifier of ['fs', 'node:fs', 'fs/promises', 'node:fs/promises']) {
    const mod = safe(() => req(specifier) as Record<string, unknown>)
    if (!mod) continue
    const sample = specifier.includes('promises') ? realFsPromises.readFile : realFs.readFile
    if (mod.readFile !== sample) {
      record(
        `WARNING: '${specifier}' resolves to a different object than the one patched - ` +
          'call sites importing from it are NOT audited'
      )
    }
  }

  record(
    `active - ${patchedCount} fs calls patched, ${allowedRoots.length} allowed roots:\n` +
      allowedRoots.map((r) => `  ${r}`).join('\n')
  )
}
