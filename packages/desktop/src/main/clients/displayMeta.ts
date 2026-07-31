/**
 * Display metadata (name + brand color) for every supported client.
 *
 * Mirrors the entries in `@edison-watch/shared/agent-registry`. Duplicated here so
 * main-process code can build ClientIntegration objects without dragging the
 * shared package into test module graphs (vitest can't resolve subpath
 * exports of an unbuilt package). Keep in sync with the shared registry.
 */
import type { McpClientId } from '../discovery/types'

export interface ClientDisplay {
  name: string
  brandColor: string
  /**
   * The client keeps its MCP servers as hosted Connectors in the user's account
   * rather than in a local config file. Edison can see the app is installed but
   * has nothing to read, write, hook, or proxy - so these clients are detected
   * and flagged, never managed.
   */
  connectorOnly?: boolean
  /**
   * What to show where a config path would go, for `connectorOnly` clients.
   * The daemon reports no path for them (there isn't one), and a blank line
   * under the app name reads as "we couldn't find it" rather than "there is
   * nothing to find".
   */
  configLabel?: string
}

export const CLIENT_DISPLAY: Record<McpClientId, ClientDisplay> = {
  'claude-code': { name: 'Claude Code', brandColor: '#1A1A1A' },
  'claude-desktop': { name: 'Claude Desktop', brandColor: '#D97757' },
  'claude-cowork': { name: 'Claude Cowork', brandColor: '#C4745B' },
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
    connectorOnly: true,
    configLabel: 'Connectors · managed server-side in your ChatGPT account',
  },
}
