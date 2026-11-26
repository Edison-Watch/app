// Is the daemon that wrote state.json still running? state.json keeps its
// last content after the daemon exits, so its keep_awake state is current
// only while that process runs. Windows reuses PIDs, so on Windows the PID
// must also belong to sealgate-stdiod.exe.

import { spawn } from 'child_process'

// tasklist is a separate process, so cache its answer for a short time: the
// settings card and the tray both poll the status every few seconds.
const CACHE_MS = 5000
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

function tasklist(pid: number): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      windowsHide: true
    })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    child.on('error', () => resolve(''))
    child.on('close', () => resolve(out))
  })
}

export async function isDaemonProcess(pid: number): Promise<boolean> {
  if (!processExists(pid)) return false
  if (process.platform !== 'win32') return true
  const hit = cache.get(pid)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value
  const value = tasklistShowsStdiod(await tasklist(pid))
  cache.set(pid, { at: Date.now(), value })
  return value
}
