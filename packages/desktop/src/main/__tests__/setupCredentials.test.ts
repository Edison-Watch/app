import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * `getCredentialsForEnv()` is what every later reader uses - including the
 * daemon enrollment that stamps the secret header into every agent config. So
 * whatever `markSetupComplete` fails to record here is a wrong key written
 * across the machine, silently.
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
  getSetupData,
  markSetupComplete
} from '../infra/setupConfig'

const SETUP = () => join(userDataDir, 'setup.json')

// Derived, not assumed: getActiveEnv() resolves from the build/override, so an
// unpackaged (test) build reports 'dev' rather than the 'demo' fallback.
const ENV = getActiveEnv()

describe('markSetupComplete credential persistence', () => {
  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'sg-setup-'))
  })
  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('updates the per-env secret when the apiKey lives only in envCredentials', () => {
    // A returning login: the apiKey was recorded per-env and never top-level.
    writeFileSync(
      SETUP(),
      JSON.stringify({
        completed: true,
        envCredentials: { [ENV]: { apiKey: 'sg_key', sealgateSecretKey: 'user:OLD' } }
      }),
      'utf-8'
    )

    markSetupComplete({ sealgateSecretKey: 'user:NEW' })

    // The env entry is what getCredentialsForEnv prefers, so it must carry the
    // new key - otherwise enrollment re-stamps every agent with 'user:OLD'.
    expect(getCredentialsForEnv(ENV)?.sealgateSecretKey).toBe('user:NEW')
    expect(getCredentialsForEnv(ENV)?.apiKey).toBe('sg_key')
  })

  it('still records the key top-level', () => {
    writeFileSync(
      SETUP(),
      JSON.stringify({
        completed: true,
        envCredentials: { [ENV]: { apiKey: 'sg_key', sealgateSecretKey: 'user:OLD' } }
      }),
      'utf-8'
    )
    markSetupComplete({ sealgateSecretKey: 'user:NEW' })
    expect(getSetupData().sealgateSecretKey).toBe('user:NEW')
  })

  it('keeps working when the apiKey is top-level (the fresh-signup shape)', () => {
    writeFileSync(SETUP(), JSON.stringify({ completed: true, apiKey: 'sg_key' }), 'utf-8')
    markSetupComplete({ sealgateSecretKey: 'user:NEW' })
    expect(getCredentialsForEnv(ENV)).toEqual({ apiKey: 'sg_key', sealgateSecretKey: 'user:NEW' })
  })

  it('does not invent a credential entry when there is no apiKey anywhere', () => {
    writeFileSync(SETUP(), JSON.stringify({ completed: true }), 'utf-8')
    markSetupComplete({ sealgateSecretKey: 'user:NEW' })
    // No key to pair it with: a half-populated entry would make
    // getCredentialsForEnv return something unusable instead of null.
    expect(getCredentialsForEnv(ENV)).toBeNull()
  })

  it('leaves other environments alone', () => {
    writeFileSync(
      SETUP(),
      JSON.stringify({
        completed: true,
        envCredentials: {
          [ENV]: { apiKey: 'sg_demo', sealgateSecretKey: 'user:OLD' },
          prod: { apiKey: 'sg_prod', sealgateSecretKey: 'user:PROD' }
        }
      }),
      'utf-8'
    )
    markSetupComplete({ sealgateSecretKey: 'user:NEW' })
    expect(getCredentialsForEnv('prod')?.sealgateSecretKey).toBe('user:PROD')
  })
})
