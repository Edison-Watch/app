// Local keep-awake choice for the stdiod daemon. The daemon holds the OS
// sleep block; the app only writes the local choice through the CLI
// (`sealgate-stdiod keep-awake <auto|on|off> --json`), which the running
// daemon reads again within a few seconds. See PROTOCOL.md section 10.

import { runStdiod } from './controller'
import { stdiodLog } from './stdiodLog'
import type { KeepAwakeLocal, KeepAwakeReport, StdiodResult } from './types'

const CHOICES: readonly KeepAwakeLocal[] = ['auto', 'on', 'off']

export function isKeepAwakeLocal(value: unknown): value is KeepAwakeLocal {
  return typeof value === 'string' && (CHOICES as readonly string[]).includes(value)
}

export async function setKeepAwake(choice: KeepAwakeLocal): Promise<StdiodResult<KeepAwakeReport>> {
  if (!isKeepAwakeLocal(choice)) {
    return { ok: false, errorCode: 'unknown', errorMessage: `invalid keep-awake choice: ${choice}` }
  }
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
    return { ok: true, value: JSON.parse(result.stdout.trim()) as KeepAwakeReport }
  } catch (err) {
    stdiodLog(`keep-awake: failed ${String(err)}`)
    return { ok: false, errorCode: 'spawn_failed', errorMessage: String(err) }
  }
}
