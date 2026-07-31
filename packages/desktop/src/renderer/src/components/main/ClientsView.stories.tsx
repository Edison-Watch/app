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
 * reported as `manageable: false` and lands in its own "Not Protected" state -
 * neither scored against setup conditions it can never meet, nor dropped from
 * the list, which would leave an unprotected app invisible after onboarding.
 */
export const WithAnUnmanageableClient: Story = {
  decorators: [
    (Story) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).api.mcp.getHookStatus = async () => ({
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
      return (
        <div style={{ width: '520px' }}>
          <Story />
        </div>
      );
    },
  ],
};
