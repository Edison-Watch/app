// Messaging: chat apps bridged on this computer and offered to AI agents as
// one MCP server.
//
// The work happens in the sealgate-messaging binary (messaging/ in this repo),
// which embeds mautrix bridges and keeps every chat in a local database. The
// stdiod daemon runs it as an ordinary local MCP server, so it starts at logon
// and its tools reach SealGate through the daemon's tunnel like any other.
//
// This module does the two things only the desktop app can do:
//   - register the server with SealGate through `sealgate-stdiod server add`,
//   - drive account logins through the binary's loopback control API, so the
//     credentials a person types never leave this computer.

import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { app } from 'electron'

import { runStdiod } from '../stdiod/controller'

/**
 * The server's name in SealGate. Names are unique per organization and each
 * computer runs its own bridges with its own accounts, so every computer gets
 * its own server: messaging-<computer>. Tools then appear to agents as
 * messaging-<computer>_list_chats and so on.
 */
export function serverName(): string {
  const host = os
    .hostname()
    .toLowerCase()
    .replace(/\.local$/, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return host ? `messaging-${host}` : 'messaging'
}
const BINARY = 'sealgate-messaging'

function exeName(): string {
  return process.platform === 'win32' ? `${BINARY}.exe` : BINARY
}

function bundledBinaryPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'bin', exeName())
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  return path.join(__dirname, '..', '..', 'bin', 'messaging', arch, exeName())
}

// Same reason as stdiodBinary.ts: the AppImage mount path changes on every
// launch, and the daemon must be able to start this binary when the app is not
// running, so packaged Linux registers a stable copy.
function stableLinuxBinaryPath(): string {
  return path.join(os.homedir(), '.local', 'share', 'sealgate', 'bin', BINARY)
}

function usesStableCopy(): boolean {
  return process.platform === 'linux' && app.isPackaged
}

export function getMessagingBinaryPath(): string {
  return usesStableCopy() ? stableLinuxBinaryPath() : bundledBinaryPath()
}

function sameContents(a: string, b: string): boolean {
  if (statSync(a).size !== statSync(b).size) return false
  const hash = (p: string): string => createHash('sha256').update(readFileSync(p)).digest('hex')
  return hash(a) === hash(b)
}

/**
 * Copy the bundled binary to its stable Linux path when missing or changed.
 *
 * The copy goes to a temp file that is renamed over the old one: writing in
 * place fails with ETXTBSY while the daemon runs the old binary. After an
 * update the running process is stopped so the daemon restarts it on the new
 * binary.
 */
export function stageMessagingBinary(): void {
  if (!usesStableCopy()) return
  const src = bundledBinaryPath()
  const dst = stableLinuxBinaryPath()
  try {
    if (existsSync(dst) && sameContents(src, dst)) return
    mkdirSync(path.dirname(dst), { recursive: true })
    const tmp = `${dst}.new`
    copyFileSync(src, tmp)
    chmodSync(tmp, 0o755)
    const replaced = existsSync(dst)
    renameSync(tmp, dst)
    const info = replaced ? readControlInfo() : null
    if (info?.pid) {
      try {
        process.kill(info.pid, 'SIGTERM')
      } catch {
        // not running
      }
    }
  } catch {
    // Leave any existing copy; status reports a missing binary.
  }
}

/** The binary's data directory. Must match defaultDataDir() in the Go code. */
export function getMessagingDataDir(): string {
  const env = process.env.SEALGATE_MESSAGING_DIR
  if (env) return env
  const home = os.homedir()
  switch (process.platform) {
    case 'win32':
      return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'SealGate', 'messaging')
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', 'SealGate', 'messaging')
    default:
      return path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'sealgate', 'messaging')
  }
}

interface ControlInfo {
  url: string
  token: string
  pid: number
  version: string
}

function readControlInfo(): ControlInfo | null {
  try {
    const info = JSON.parse(readFileSync(path.join(getMessagingDataDir(), 'control.json'), 'utf-8')) as ControlInfo
    return info.url && info.token ? info : null
  } catch {
    return null
  }
}

export class MessagingError extends Error {}

async function control<T>(method: string, apiPath: string, body?: unknown): Promise<T> {
  const info = readControlInfo()
  if (!info) throw new MessagingError('Messaging is not running yet.')
  let res: Response
  try {
    res = await fetch(info.url + apiPath, {
      method,
      headers: { Authorization: `Bearer ${info.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000)
    })
  } catch {
    throw new MessagingError('Messaging is not running yet.')
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new MessagingError(data.error || `Messaging returned HTTP ${res.status}`)
  return data
}

export interface LoginFlow {
  id: string
  name: string
  description: string
}

export interface MessagingNetwork {
  id: string
  name: string
  flows: LoginFlow[]
}

export interface MessagingAccount {
  id: string
  network: string
  network_name: string
  remote_name: string
  state: string
  error?: string
}

export interface MessagingStatus {
  binaryPresent: boolean
  /** 'none' | 'pending' | 'approved' as SealGate sees the server for this device. */
  registration: 'none' | 'pending' | 'approved' | 'unknown'
  running: boolean
  version?: string
  networks: MessagingNetwork[]
  accounts: MessagingAccount[]
  error?: string
}

// Remembers a request submitted in this app session, so status can say
// "waiting for approval" rather than "not enabled" until an admin acts.
let pendingRequest = false

async function approvedHere(): Promise<boolean | null> {
  const res = await runStdiod(['server', 'list', '--json']).catch(() => null)
  if (!res || res.code !== 0) return null
  try {
    const parsed = JSON.parse(res.stdout) as unknown
    const items = Array.isArray(parsed)
      ? parsed
      : ((parsed as { servers?: unknown[] }).servers ?? [])
    return (items as { name?: string }[]).some((s) => s.name === serverName())
  } catch {
    return res.stdout.includes(serverName())
  }
}

export async function getMessagingStatus(): Promise<MessagingStatus> {
  const status: MessagingStatus = {
    binaryPresent: existsSync(getMessagingBinaryPath()),
    registration: 'unknown',
    running: false,
    networks: [],
    accounts: []
  }
  const approved = await approvedHere()
  if (approved === true) {
    status.registration = 'approved'
    pendingRequest = false
  } else if (approved === false) {
    status.registration = pendingRequest ? 'pending' : 'none'
  }
  try {
    const s = await control<{ version: string; networks: MessagingNetwork[]; accounts: MessagingAccount[] }>(
      'GET',
      '/v1/status'
    )
    status.running = true
    status.version = s.version
    status.networks = s.networks ?? []
    status.accounts = s.accounts ?? []
  } catch {
    // not running
  }
  return status
}

/**
 * Turn messaging on: register the local server with SealGate. On a backend
 * that lets this user add servers directly it is approved at once and the
 * daemon starts it within seconds; otherwise an admin approves it first.
 */
export async function enableMessaging(): Promise<{ ok: boolean; autoApproved?: boolean; message: string }> {
  stageMessagingBinary()
  const bin = getMessagingBinaryPath()
  if (!existsSync(bin)) {
    return { ok: false, message: `The messaging component is missing from this install (${bin}).` }
  }
  if ((await approvedHere()) === true) {
    return { ok: true, autoApproved: true, message: 'Messaging is already enabled on this computer.' }
  }
  const res = await runStdiod([
    'server',
    'add',
    serverName(),
    '--command',
    bin,
    '--arg',
    'mcp',
    '--display-name',
    `Messaging (${os.hostname()})`
  ])
  const out = (res.stdout + res.stderr).trim()
  if (res.code !== 0) {
    return { ok: false, message: out || `sealgate-stdiod exited with code ${res.code}` }
  }
  const autoApproved = out.includes('auto-approved')
  pendingRequest = !autoApproved
  return { ok: true, autoApproved, message: out }
}

export interface LoginState {
  id: string
  network: string
  step?: {
    type: string
    step_id: string
    instructions: string
    user_input?: {
      fields: {
        type: string
        id: string
        name: string
        description: string
        default_value?: string
        options?: string[]
        pattern?: string
      }[]
    }
    display_and_wait?: { type: string; data?: string; image_url?: string }
  }
  error?: string
  done: boolean
  account?: string
}

export function startLogin(network: string, flow?: string): Promise<LoginState> {
  return control('POST', '/v1/logins', { network, flow })
}

export function submitLogin(network: string, id: string, values: Record<string, string>): Promise<LoginState> {
  return control('POST', `/v1/logins/${encodeURIComponent(network)}/${encodeURIComponent(id)}`, values)
}

export function getLogin(network: string, id: string): Promise<LoginState> {
  return control('GET', `/v1/logins/${encodeURIComponent(network)}/${encodeURIComponent(id)}`)
}

export async function cancelLogin(network: string, id: string): Promise<void> {
  await control('DELETE', `/v1/logins/${encodeURIComponent(network)}/${encodeURIComponent(id)}`)
}

export async function removeAccount(accountId: string): Promise<void> {
  await control('DELETE', `/v1/accounts/${encodeURIComponent(accountId)}`)
}

export interface IrcNetwork {
  displayname: string
  address: string
  tls: boolean
}

export async function listIrcNetworks(): Promise<Record<string, IrcNetwork>> {
  const res = await control<{ networks: Record<string, IrcNetwork> }>('GET', '/v1/irc/networks')
  return res.networks ?? {}
}

export async function setIrcNetwork(name: string, net: IrcNetwork): Promise<void> {
  await control('PUT', `/v1/irc/networks/${encodeURIComponent(name)}`, net)
}
