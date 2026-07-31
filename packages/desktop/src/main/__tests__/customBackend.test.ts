import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * The custom (self-hosted) backend option: URLs live in the debug-env
 * override file next to the env name. getApiBaseUrl/getMcpBaseUrl must
 * resolve them ahead of everything else, and toggling to another env and
 * back must not lose the stored URL.
 */

let userDataDir: string

vi.mock('electron', () => ({
  app: {
    getPath: () => userDataDir,
    isPackaged: false,
    setLoginItemSettings: () => {}
  }
}))

import {
  getApiBaseUrl,
  getCustomBackend,
  getDebugEnvOverride,
  getDebugEnvOverridePath,
  getMcpBaseUrl,
  parseCustomBackendUrl,
  setCustomBackend,
  setDebugEnvOverride
} from '../infra/setupConfig'

describe('custom backend persistence', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'ew-custom-'))
  })
  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('stores the URL, activates the custom env, and resolves both base URLs from it', () => {
    setCustomBackend('https://self-host-ew-demo.up.railway.app/')

    expect(getDebugEnvOverride()).toBe('custom')
    // Trailing slash is stripped; MCP defaults to the same origin because the
    // backend serves /mcp/<key>/ same-origin.
    expect(getCustomBackend()).toEqual({
      apiBaseUrl: 'https://self-host-ew-demo.up.railway.app',
      mcpBaseUrl: 'https://self-host-ew-demo.up.railway.app'
    })
    expect(getApiBaseUrl()).toBe('https://self-host-ew-demo.up.railway.app')
    expect(getMcpBaseUrl()).toBe('https://self-host-ew-demo.up.railway.app')
  })

  it('keeps the stored URL when switching envs away and back', () => {
    setCustomBackend('http://localhost:3001')
    setDebugEnvOverride('demo')

    expect(getDebugEnvOverride()).toBe('demo')
    expect(getCustomBackend()).toEqual({
      apiBaseUrl: 'http://localhost:3001',
      mcpBaseUrl: 'http://localhost:3001'
    })

    setDebugEnvOverride('custom')
    expect(getApiBaseUrl()).toBe('http://localhost:3001')
  })

  it('treats a "custom" override without stored URLs as no override', () => {
    writeFileSync(getDebugEnvOverridePath(), JSON.stringify({ env: 'custom' }), 'utf-8')
    expect(getDebugEnvOverride()).toBeNull()
  })

  it('ignores a stale temp-local-stack override from an older build', () => {
    writeFileSync(getDebugEnvOverridePath(), JSON.stringify({ env: 'temp-local-stack' }), 'utf-8')
    expect(getDebugEnvOverride()).toBeNull()
  })

  it('rejects URLs that are not http(s)', () => {
    expect(parseCustomBackendUrl('ftp://example.com')).toBeNull()
    expect(parseCustomBackendUrl('not a url')).toBeNull()
    expect(() => setCustomBackend('file:///etc/passwd')).toThrow()
    expect(getCustomBackend()).toBeNull()
  })

  it('normalizes trailing slashes and whitespace', () => {
    expect(parseCustomBackendUrl('  https://edison.example.com//  ')).toBe(
      'https://edison.example.com'
    )
  })

  it('setCustomBackend rewrites the override file without clobbering unknown keys', () => {
    writeFileSync(
      getDebugEnvOverridePath(),
      JSON.stringify({ env: 'demo', futureField: true }),
      'utf-8'
    )
    setCustomBackend('https://edison.example.com')
    const raw = JSON.parse(readFileSync(getDebugEnvOverridePath(), 'utf-8'))
    expect(raw.futureField).toBe(true)
    expect(raw.env).toBe('custom')
  })
})
