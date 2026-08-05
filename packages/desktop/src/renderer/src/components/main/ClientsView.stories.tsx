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
 * The permanent client surface, including a host Edison can only see.
 *
 * ChatGPT keeps its MCP servers as Connectors in the user's account, so it is
 * reported as `manageable: false` and lands in its own "Partially Supported"
 * state, matching how onboarding groups it with Claude Desktop and Cowork -
 * neither scored against setup conditions it can never meet, nor dropped from
 * the list, which would leave an unprotected app invisible after onboarding.
 */
export const WithAnUnmanageableClient: Story = {
  decorators: [
    (Story) => {
      // Storybook keeps every story in a file on one page, so a stub assigned
      // here outlives the story that set it - the next story added to this file
      // would silently inherit these four clients.
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
