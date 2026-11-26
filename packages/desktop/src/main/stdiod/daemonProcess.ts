// Is the daemon that wrote state.json still running? state.json keeps its
// last content after the daemon exits, so its keep_awake state is current
// only while that process runs. Windows reuses PIDs, so on Windows the PID
// must also belong to sealgate-stdiod.exe.

import { spawn } from 'child_process'

// tasklist is a separate process, so cache its answer for a short time: the
// settings card and the tray both poll the status every few seconds.
const CACHE_MS = 5000
// A tasklist that runs longer than this is killed and counts as unknown.
const TASKLIST_TIMEOUT_MS = 3000
const cache = new Map<number, { at: number; value: boolean }>()

// Signal 0 tests whether a process exists without touching it; it works on
// Windows too. EPERM means it exists but belongs to another user.
export function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

// `tasklist /FI "PID eq <pid>" /FO CSV /NH` prints one CSV line per match,
// starting with the image name in quotes. Image names are not translated, so
// this works on every Windows language. With no match it prints a translated
// notice, which contains no quoted image name.
export function tasklistShowsStdiod(stdout: string): boolean {
  return stdout
    .split(/\r?\n/)
    .some((line) => line.trim().toLowerCase().startsWith('"sealgate-stdiod.exe"'))
}

// The tasklist output, or null when tasklist could not run, failed, or took
// longer than TASKLIST_TIMEOUT_MS (it is then killed).
function tasklist(pid: number): Promise<string | null> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true
      })
    } catch {
      resolve(null)
      return
    }
    let out = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve(null)
    }, TASKLIST_TIMEOUT_MS)
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve(code === 0 ? out : null)
    })
  })
}

// true or false when known, null when it cannot be told. Only known
// answers are cached, so a failed tasklist is asked again next time.
export async function isDaemonProcess(pid: number): Promise<boolean | null> {
  if (!processExists(pid)) return false
  if (process.platform !== 'win32') return true
  const hit = cache.get(pid)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
  const out = await tasklist(pid)
  if (out === null) return null
  const value = tasklistShowsStdiod(out)
  cache.set(pid, { at: Date.now(), value })
  return value
}
