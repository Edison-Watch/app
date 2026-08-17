// The daemon log directory is hand-mirrored from paths::log_dir() in the Rust
// daemon, so it can silently drift from it. It did: two of the three call sites
// branched on `win32` instead of `darwin`, which sent Linux to a macOS-only path
// that never exists - "View logs" returned null on every Linux install.

import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import os from 'node:os'
import path from 'node:path'

import { getClientLogPath, getStdiodLogDir } from '../stdiod/stdiodLog'

const realPlatform = process.platform
const realXdg = process.env.XDG_STATE_HOME

function setPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', { value: platform })
}

describe('getStdiodLogDir', () => {
  beforeEach(() => {
    delete process.env.XDG_STATE_HOME
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: realPlatform })
    if (realXdg === undefined) delete process.env.XDG_STATE_HOME
    else process.env.XDG_STATE_HOME = realXdg
  })

  it('uses ~/Library/Logs on macOS', () => {
    setPlatform('darwin')
    expect(getStdiodLogDir()).toBe(path.join(os.homedir(), 'Library', 'Logs', 'sealgate-stdiod'))
  })

  it('uses the XDG state dir on Linux, not the macOS path', () => {
    setPlatform('linux')
    expect(getStdiodLogDir()).toBe(
      path.join(os.homedir(), '.local', 'state', 'sealgate-stdiod')
    )
    expect(getStdiodLogDir()).not.toContain('Library/Logs')
  })

  it('honours XDG_STATE_HOME when set (matches dirs::state_dir())', () => {
    setPlatform('linux')
    process.env.XDG_STATE_HOME = '/tmp/xdg-state'
    expect(getStdiodLogDir()).toBe(path.join('/tmp/xdg-state', 'sealgate-stdiod'))
  })

  it('falls back to ~/.local/state on Windows (no XDG state dir there)', () => {
    setPlatform('win32')
    expect(getStdiodLogDir()).toBe(path.join(os.homedir(), '.local', 'state', 'sealgate-stdiod'))
  })

  it('puts client.log in the same directory as the daemon log', () => {
    setPlatform('linux')
    expect(path.dirname(getClientLogPath())).toBe(getStdiodLogDir())
  })
})
