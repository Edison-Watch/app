import { useLayoutEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import ClientsView from './ClientsView';

const meta: Meta<typeof ClientsView> = {
  title: 'Client2/ClientsView',
  component: ClientsView,
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** A status row as the daemon reports it, with the manageable defaults. */
const status = (over: Record<string, unknown>) => ({
  installed: true,
  hasHook: true,
  hookCount: 4,
  totalHooks: 4,
  mcpConnected: true,
  mcpConfigured: true,
  mcpApplicable: true,
  hooksApplicable: true,
  manageable: true,
  ...over,
});

/**
 * The permanent client surface, covering both routes into "Partially
 * Supported" - which are not the same situation, and carry different copy.
 *
 * ChatGPT has nothing local at all: its servers are Connectors in the user's
 * account, so no manual step would help and the row does not offer one. The
 * Claude hosts do run local servers - `claude_desktop_config.json` simply takes
 * stdio entries only, leaving Edison nowhere to write a gateway URL. That one
 * is actionable, so its row names the route that works.
 *
 * Claude Code, Cursor and VS Code sit alongside as the ordinary case: config
 * files that accept a URL, so Edison configures them itself.
 */
export const WithAnUnmanageableClient: Story = {
  decorators: [
    (Story) => {
      // Restored on unmount because `addon-docs` is enabled: a docs page
      // renders every story in this file into one iframe, so a stub left
      // behind is inherited by whatever story is added alongside it. The
      // canvas view isolates each story per iframe and would not care - which
      // is why the leak would go unnoticed until someone opened Docs.
      //
      // Swap and restore both happen in the effect, so they stay symmetric:
      // mutating a global during render is not safe to repeat, and React does
      // repeat renders (StrictMode double-invokes, concurrent renders can be
      // thrown away). A second pass would capture this stub as the "previous"
      // value and restore it on unmount. `useLayoutEffect` rather than
      // `useEffect` because ClientsView fetches in a passive effect, and every
      // layout effect runs before any passive one - so the stub is in place
      // before the component asks.
      useLayoutEffect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mcp = (window as any).api.mcp;
        const previous = mcp.getHookStatus;
        mcp.getHookStatus = async () => ({
          statuses: [
            status({ client: 'claude-code' }),
            status({ client: 'cursor' }),
            // Stdio-only config file, so nothing to install and nothing to
            // score against setup - but a manual route that does work.
            status({
              client: 'claude-desktop',
              manageable: false,
              mcpApplicable: false,
              hooksApplicable: false,
              hasHook: false,
              hookCount: 0,
              totalHooks: 0,
              mcpConnected: false,
              mcpConfigured: false,
            }),
            status({
              client: 'claude-cowork',
              manageable: false,
              mcpApplicable: false,
              hooksApplicable: false,
              hasHook: false,
              hookCount: 0,
              totalHooks: 0,
              mcpConnected: false,
              mcpConfigured: false,
            }),
            status({
              client: 'vscode',
              hasHook: false,
              hookCount: 2,
              mcpConnected: false,
            }),
            status({
              client: 'chatgpt',
              manageable: false,
              mcpApplicable: false,
              hooksApplicable: false,
              hasHook: false,
              hookCount: 0,
              totalHooks: 0,
              mcpConnected: false,
              mcpConfigured: false,
            }),
          ],
          daemonUnavailable: false,
        });
        return () => {
          mcp.getHookStatus = previous;
        };
      }, []);
      return (
        <div style={{ width: '520px' }}>
          <Story />
        </div>
      );
    },
  ],
};
