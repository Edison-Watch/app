/**
 * Display metadata (name + brand color) for every supported client.
 *
 * `name` and `brandColor` mirror `@edison-watch/shared/agent-registry`; `configLabel`
 * is app-local copy with no counterpart there. Duplicated here so
 * main-process code can build ClientIntegration objects without dragging the
 * shared package into test module graphs (vitest can't resolve subpath
 * exports of an unbuilt package). Keep in sync with the shared registry.
 */
import type { McpClientId } from '../discovery/types'

export interface ClientDisplay {
  name: string
  brandColor: string
  /**
   * What to show where a config path would go, for clients that have none.
   * The daemon reports a null path for them (there is no file), and a blank
   * line under the app name reads as "we couldn't find it" rather than "there
   * is nothing to find".
   *
   * Display copy only - whether Edison can manage a client is the daemon's
   * `manageable`, never the presence of this string.
   */
  configLabel?: string
}

export const CLIENT_DISPLAY: Record<McpClientId, ClientDisplay> = {
  'claude-code': { name: 'Claude Code', brandColor: '#1A1A1A' },
  // These two have a config file - it is read on every scan - but it takes
  // stdio entries only, so Edison never writes to it and reports no install
  // path. Naming the file here would point at somewhere nothing happens; the
  // route that works is the one worth showing.
  'claude-desktop': {
    name: 'Claude Desktop',
    brandColor: '#D97757',
    configLabel: 'Connectors · add Edison Watch under Settings > Connectors',
  },
  'claude-cowork': {
    name: 'Claude Cowork',
    brandColor: '#C4745B',
    configLabel: 'Connectors · add Edison Watch under Settings > Connectors',
  },
  codex: { name: 'Codex', brandColor: '#000000' },
  cursor: { name: 'Cursor', brandColor: '#000000' },
  vscode: { name: 'VS Code', brandColor: '#007ACC' },
  windsurf: { name: 'Windsurf', brandColor: '#0EA5E9' },
  zed: { name: 'Zed', brandColor: '#084CCF' },
  intellij: { name: 'IntelliJ IDEA', brandColor: '#000000' },
  pycharm: { name: 'PyCharm', brandColor: '#21D789' },
  webstorm: { name: 'WebStorm', brandColor: '#07C3F2' },
  chatgpt: {
    name: 'ChatGPT',
    brandColor: '#000000',
    configLabel: 'Connectors · managed server-side in your ChatGPT account',
  },
}
