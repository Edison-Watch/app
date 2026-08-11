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
 * Supported" - which are not the same situation.
 *
 * ChatGPT is `manageable: false`: its servers are Connectors in the user's
 * account and there is nothing to configure. Claude Desktop is the opposite -
 * manageable and fully set up - and still lands here, because its account-side
 * Connectors stay unproxied and calling it "Connected" would be the
 * overstatement this state exists to avoid. The two carry different copy.
 *
 * Cowork is connector-backed as well, but mid-setup, and shows the other half
 * of the rule: a fixable problem outranks the caveat, so it reports
 * "Incomplete" rather than hiding a broken gateway behind something permanent
 * that the user cannot act on.
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
            // Manageable and fully set up, so the caveat is what's left to say.
            status({ client: 'claude-desktop' }),
            // Manageable but mid-setup: the gateway problem wins over the caveat.
            status({
              client: 'claude-cowork',
              mcpConnected: false,
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
