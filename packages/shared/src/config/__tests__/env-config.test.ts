import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearStoredCustomBackend,
  getActiveEnvName,
  getEnv,
  getEnvByName,
  getStoredCustomBackend,
  storeCustomBackend,
  CUSTOM_BACKEND_STORAGE_KEY,
  STORAGE_KEY
} from '../env-config'

/**
 * The "custom" environment resolves from a localStorage mirror written by the
 * Electron main process. A missing or malformed mirror must never produce a
 * half-configured env - the app falls back to the release backend instead.
 */

describe('custom backend env resolution', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('is inactive until URLs are stored', () => {
    localStorage.setItem(STORAGE_KEY, 'custom')
    // Override says custom but there are no URLs - fall back to build default.
    expect(getActiveEnvName()).not.toBe('custom')
    expect(getEnvByName('custom')).toBeUndefined()
  })

  it('resolves API and MCP URLs from the stored mirror', () => {
    storeCustomBackend({ apiBaseUrl: 'https://sealgate.example.com/' })
    localStorage.setItem(STORAGE_KEY, 'custom')

    expect(getActiveEnvName()).toBe('custom')
    const env = getEnv()
    expect(env.DEPLOY_ENV).toBe('custom')
    expect(env.API_BASE_URL).toBe('https://sealgate.example.com')
    // MCP defaults to the same origin (the backend serves /mcp/<key>/ there).
    expect(env.MCP_BASE_URL).toBe('https://sealgate.example.com')
    // No telemetry or update feed for someone else's deployment.
    expect(env.SENTRY_DSN).toBe('')
    expect(env.POSTHOG_API_KEY).toBe('')
    expect(env.RELEASES_BASE_URL).toBe('')
  })

  it('honors a distinct MCP URL when one is stored', () => {
    storeCustomBackend({
      apiBaseUrl: 'http://localhost:3001',
      mcpBaseUrl: 'http://localhost:3000'
    })
    localStorage.setItem(STORAGE_KEY, 'custom')
    expect(getEnv().MCP_BASE_URL).toBe('http://localhost:3000')
  })

  it('rejects a malformed mirror', () => {
    localStorage.setItem(CUSTOM_BACKEND_STORAGE_KEY, '{"nope": true}')
    expect(getStoredCustomBackend()).toBeNull()
    localStorage.setItem(CUSTOM_BACKEND_STORAGE_KEY, 'not json')
    expect(getStoredCustomBackend()).toBeNull()
  })

  it('drops a malformed mcpBaseUrl instead of crashing resolution', () => {
    localStorage.setItem(
      CUSTOM_BACKEND_STORAGE_KEY,
      '{"apiBaseUrl": "https://sealgate.example.com", "mcpBaseUrl": 123}'
    )
    localStorage.setItem(STORAGE_KEY, 'custom')
    expect(getStoredCustomBackend()).toEqual({ apiBaseUrl: 'https://sealgate.example.com' })
    // MCP falls back to the API origin.
    expect(getEnv().MCP_BASE_URL).toBe('https://sealgate.example.com')
  })

  it('clears the mirror', () => {
    storeCustomBackend({ apiBaseUrl: 'https://sealgate.example.com' })
    clearStoredCustomBackend()
    expect(getStoredCustomBackend()).toBeNull()
  })

  it('falls back to the release config for unknown env names', () => {
    expect(getEnvByName('demo')?.DEPLOY_ENV).toBe('demo')
    localStorage.setItem(STORAGE_KEY, 'custom') // no URLs stored
    expect(getEnv().DEPLOY_ENV === 'custom').toBe(false)
  })
})
