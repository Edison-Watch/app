/**
 * A stand-in for `window.api` (the Electron preload bridge) for environments
 * where the preload script doesn't run: Storybook and jsdom tests.
 *
 * One definition, used by both, because the failure mode of having two is
 * silent: a component reads a namespace the stub doesn't define, throws inside
 * an effect, and the story renders as a blank or error frame that nobody
 * inspects until a visual diff turns red. Every namespace the renderer touches
 * should exist here, with shapes that match `preload/index.d.ts`.
 *
 * "Should" was doing too much work there, so the shapes are now checked: the
 * return type is derived from the real API, and a stub that answers with the
 * wrong shape fails typecheck. Destructuring is what made the old arrangement
 * dangerous - `readConfig` returned a bare `''` while callers read
 * `{ content, error }` from it, which yields `undefined` for both and silently
 * exercises a branch production never takes, no error anywhere.
 *
 * Callers override individual members per story/test.
 */

export interface MockClient {
  id: string
  name: string
  configPath: string
  /** False for hosts Edison can only detect, never configure (ChatGPT). */
  manageable: boolean
}

type Api = Window['api']

/**
 * Every member the stub defines must have production's type; members it leaves
 * out are its own business.
 */
type PartialApi = { [K in keyof Api]?: Partial<Api[K]> }

const IDLE_UPDATE_STATE = {
  status: 'idle',
  version: null,
  percent: null,
  error: null,
  autoDownload: true,
  autoInstallOnQuit: true
} as const

/** A permissive stub: every call resolves to a harmless empty result. */
export function createMockApi(): PartialApi {
  const noopUnsubscribe = (): (() => void) => () => {}

  return {
    platform: 'darwin',
    getVersion: () => '0.0.0-test',
    setup: {
      // Production always resolves an object (`getSetupData()`); `null` here
      // sent stories down a branch that cannot happen.
      getData: async () => ({ completed: false }),
      complete: () => {},
      update: async () => ({ ok: true }),
      reachedFinal: () => {},
      reset: async () => ({ ok: true })
    },
    secretKey: { verify: async () => ({ ok: true, valid: true, domainValid: true }) },
    auth: {
      openSaml: () => {},
      onCallback: noopUnsubscribe,
      getLoopbackUrl: async () => '',
      consumePending: async () => null,
      clearPending: async () => {}
    },
    health: { check: async () => true },
    shell: { openExternal: async () => {} },
    mcp: {
      // Shape matters: AppsStep destructures `{ clients, daemonUnavailable }`
      // and would call .map on undefined if this stayed an array.
      detectClients: async () => ({ clients: [] as MockClient[], daemonUnavailable: false }),
      discover: async () => ({ servers: [], unsupported: [], daemonUnavailable: false }),
      findDuplicates: async () => [],
      removeServers: async () => ({ removed: [], errors: [] }),
      resubmitServer: async () => ({ success: true }),
      readConfig: async () => ({ content: null }),
      applyAppIntegrations: async () => ({ success: true, modifiedConfigs: [] }),
      applyForSecretKey: async () => ({ success: true, modifiedConfigs: [] }),
      revertAppIntegrations: async () => ({ reverted: 0, errors: [] }),
      submitWithTemplates: async () => ({
        submitted: 0,
        autoApproved: 0,
        skipped: 0,
        alreadyOnBackend: 0,
        total: 0
      }),
      analyzeSecrets: async () => [],
      submitAllDiscovered: async () => ({
        submitted: 0,
        autoApproved: 0,
        skipped: 0,
        alreadyOnBackend: 0,
        total: 0
      }),
      getHookStatus: async () => ({ statuses: [], daemonUnavailable: false })
    },
    config: {
      getEffectiveBaseUrls: async () => ({
        mcpBaseUrl: '',
        apiBaseUrl: '',
        docsBaseUrl: ''
      }),
      getActiveEnv: async () => 'demo',
      onEnvChanged: noopUnsubscribe
    },
    accounts: { list: async () => [], switch: async () => ({ ok: true }), remove: async () => ({ ok: true }) },
    menu: {
      openFeedback: async () => {},
      resizeWindow: async () => {},
      getVersion: async () => '0.0.0-test',
      getMcpConfig: async () => null,
      getMcpUrl: async () => null,
      popupApp: async () => {}
    },
    updates: {
      getState: async () => IDLE_UPDATE_STATE,
      check: async () => IDLE_UPDATE_STATE,
      download: async () => {},
      install: async () => {},
      getSettings: async () => ({ autoDownload: true, autoInstallOnQuit: true }),
      setSettings: async () => ({ autoDownload: true, autoInstallOnQuit: true }),
      onStatus: noopUnsubscribe
    },
    keychain: { save: async () => ({ ok: true }), load: async () => null, delete: async () => ({ ok: true }) },
    app: { clearDataAndRestart: async () => {} },
    detectord: {
      enroll: async () => ({ ok: true }),
      setSecret: async () => ({ ok: true }),
      uninstall: async () => ({ ok: true, stdout: '', stderr: '' }),
      // The warning banner asks on mount; a missing namespace here throws
      // inside its effect and takes the whole view down with it.
      health: async () => ({ ok: true, since: 0 }),
      onHealth: noopUnsubscribe
    },
    stdiod: {
      // `running` was never a field on StdiodStatus - the tray reads
      // `loggedIn` and `state`, which the old stub left undefined.
      status: async () => ({
        binaryAvailable: false,
        installed: false,
        loggedIn: false,
        state: null,
        stateAgeMs: null
      }),
      install: async () => ({ ok: true }),
      login: async () => ({ ok: true }),
      uninstall: async () => ({ ok: true }),
      reset: async () => ({ ok: true }),
      getLogPath: async () => null,
      onResetting: noopUnsubscribe,
      onChanged: noopUnsubscribe
    }
  }
}

/**
 * Install the stub on `window`, returning it for per-case overrides.
 *
 * Cast at the boundary: the stub is deliberately partial in shape (every call
 * resolves to an empty result), and typing it as the full `EdisonAPI` would
 * force fixtures nobody reads.
 */
export function installMockApi(): Record<string, unknown> {
  const api = createMockApi()
  ;(window as unknown as { api: unknown }).api = api
  return api
}
