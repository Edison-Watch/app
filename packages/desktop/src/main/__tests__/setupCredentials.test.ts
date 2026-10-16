import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * `getCredentialsForEnv()` is what every later reader uses - including the
 * daemon enrollment that points every agent config at the gateway. So whatever
 * `markSetupComplete` fails to record here is a wrong key written across the
 * machine, silently.
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
  getActiveEnv,
  getCredentialsForEnv,
  getSavedAccounts,
  getSetupData,
  markSetupComplete,
  removeRetiredKeyMaterial
} from '../infra/setupConfig'

const SETUP = () => join(userDataDir, 'setup.json')
const ACCOUNTS = () => join(userDataDir, 'accounts.json')
const KEY_BLOB = () => join(userDataDir, '.personal-key.enc')

// Derived, not assumed: getActiveEnv() resolves from the build/override, so an
// unpackaged (test) build reports 'dev' rather than the 'demo' fallback.
const ENV = getActiveEnv()

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'sg-setup-'))
})
afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('markSetupComplete credential persistence', () => {
  it('keeps the apiKey that lives only in envCredentials', () => {
    // A returning login: the apiKey was recorded per-env and never top-level.
    writeFileSync(
      SETUP(),
      JSON.stringify({ completed: true, envCredentials: { [ENV]: { apiKey: 'sg_key' } } }),
      'utf-8'
    )
    markSetupComplete({ configuredApps: ['cursor'] })
    expect(getCredentialsForEnv(ENV)).toEqual({ apiKey: 'sg_key' })
  })

  it('records a top-level apiKey per environment (the fresh-signup shape)', () => {
    writeFileSync(SETUP(), JSON.stringify({ completed: true, apiKey: 'sg_key' }), 'utf-8')
    markSetupComplete({})
    expect(getSetupData().envCredentials).toEqual({ [ENV]: { apiKey: 'sg_key' } })
  })

  it('does not invent a credential entry when there is no apiKey anywhere', () => {
    writeFileSync(SETUP(), JSON.stringify({ completed: true }), 'utf-8')
    markSetupComplete({})
    // A half-populated entry would make getCredentialsForEnv return something
    // unusable instead of null.
    expect(getCredentialsForEnv(ENV)).toBeNull()
  })

  it('leaves other environments alone', () => {
    writeFileSync(
      SETUP(),
      JSON.stringify({
        completed: true,
        envCredentials: { [ENV]: { apiKey: 'sg_demo' }, prod: { apiKey: 'sg_prod' } }
      }),
      'utf-8'
    )
    markSetupComplete({ apiKey: 'sg_new' })
    expect(getCredentialsForEnv(ENV)).toEqual({ apiKey: 'sg_new' })
    expect(getCredentialsForEnv('prod')).toEqual({ apiKey: 'sg_prod' })
  })
})

describe('files written by a version that stored a per-user key', () => {
  const OLD_SETUP = {
    completed: true,
    userId: 'u1',
    apiKey: 'sg_key',
    sealgateSecretKey: 'user:AAA.admin:BBB',
    configuredApps: ['cursor'],
    envCredentials: {
      [ENV]: { apiKey: 'sg_key', sealgateSecretKey: 'user:AAA.admin:BBB' },
      prod: { apiKey: 'sg_prod', sealgateSecretKey: 'user:CCC' }
    }
  }
  const OLD_ACCOUNTS = {
    accounts: [{ ...OLD_SETUP, completed: undefined, userEmail: 'a@b.c', savedAt: 'then' }]
  }

  beforeEach(() => {
    writeFileSync(SETUP(), JSON.stringify(OLD_SETUP), 'utf-8')
    writeFileSync(ACCOUNTS(), JSON.stringify(OLD_ACCOUNTS), 'utf-8')
    writeFileSync(KEY_BLOB(), 'blob')
  })

  it('still load', () => {
    expect(getCredentialsForEnv(ENV)?.apiKey).toBe('sg_key')
    expect(getSetupData().configuredApps).toEqual(['cursor'])
    expect(getSavedAccounts()[0]?.userId).toBe('u1')
  })

  it('lose the key material at startup and keep everything else', () => {
    removeRetiredKeyMaterial()

    expect(existsSync(KEY_BLOB())).toBe(false)
    for (const file of [SETUP(), ACCOUNTS()]) {
      const text = readFileSync(file, 'utf-8')
      expect(text).not.toContain('user:')
      expect(text).not.toContain('sealgateSecretKey')
    }
    expect(getSetupData()).toEqual({
      completed: true,
      userId: 'u1',
      apiKey: 'sg_key',
      configuredApps: ['cursor'],
      envCredentials: { [ENV]: { apiKey: 'sg_key' }, prod: { apiKey: 'sg_prod' } }
    })
    expect(getSavedAccounts()[0]).toMatchObject({ userId: 'u1', userEmail: 'a@b.c', apiKey: 'sg_key' })
  })

  it('are not rewritten once clean, and a missing file is not created', () => {
    removeRetiredKeyMaterial()
    const before = readFileSync(SETUP(), 'utf-8')
    rmSync(ACCOUNTS())
    removeRetiredKeyMaterial()
    expect(readFileSync(SETUP(), 'utf-8')).toBe(before)
    expect(existsSync(ACCOUNTS())).toBe(false)
  })
})
