// Local keep-awake choice for the stdiod daemon (Windows only). The daemon
// holds the OS sleep block; the app only writes the local choice through the
// CLI (`sealgate-stdiod keep-awake <auto|on|off> --json`), which the running
// daemon reads again within about 5 s. See PROTOCOL.md section 10.

import { describeSpawnError, dryRun, ensureBinary, runStdiod } from './controller'
import { stdiodLog } from './stdiodLog'
import type { KeepAwakeLocal, KeepAwakeReport, StdiodResult } from './types'

const CHOICES: readonly KeepAwakeLocal[] = ['auto', 'on', 'off']

// How long the tray shows a just-made choice before trusting state.json
// again. The daemon applies a choice within about 5 s while it runs.
const PENDING_MS = 15000

let pending: { choice: KeepAwakeLocal; until: number } | null = null

export function isKeepAwakeLocal(value: unknown): value is KeepAwakeLocal {
  return typeof value === 'string' && (CHOICES as readonly string[]).includes(value)
}

// The choice the person just made, while the daemon has not applied it yet.
// The tray shows it instead of the older value in state.json.
export function pendingKeepAwake(applied: KeepAwakeLocal | undefined): KeepAwakeLocal | null {
  if (!pending) return null
  if (pending.choice === applied || Date.now() > pending.until) {
    pending = null
    return null
  }
  return pending.choice
}

export async function setKeepAwake(choice: KeepAwakeLocal): Promise<StdiodResult<KeepAwakeReport>> {
  if (!isKeepAwakeLocal(choice)) {
    return { ok: false, errorCode: 'unknown', errorMessage: `invalid keep-awake choice: ${choice}` }
  }
  if (dryRun()) return { ok: true }
  const missing = await ensureBinary()
  if (missing) return { ...missing, value: undefined }
  stdiodLog(`keep-awake: set ${choice}`)
  try {
    const result = await runStdiod(['keep-awake', choice, '--json'])
    if (result.code !== 0) {
      stdiodLog(`keep-awake: exit=${result.code} stderr=${result.stderr.trim()}`)
      return {
        ok: false,
        errorCode: 'unknown',
        errorMessage: result.stderr.trim() || `exit ${result.code}`
      }
    }
    pending = { choice, until: Date.now() + PENDING_MS }
    return { ok: true, value: JSON.parse(result.stdout.trim()) as KeepAwakeReport }
  } catch (err) {
    return { ...describeSpawnError('keep-awake', err), value: undefined }
  }
}
