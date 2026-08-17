import type { Meta, StoryObj } from '@storybook/react-vite';
import AppsStep from './AppsStep';

const meta: Meta<typeof AppsStep> = {
  title: 'Client2/AppsStep',
  component: AppsStep,
  parameters: {
    layout: 'centered',
  },
  args: {
    onNext: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const MOCK_CLIENTS = [
  {
    id: 'cursor',
    name: 'Cursor',
    configPath: '/Users/alice/.cursor/mcp.json',
    manageable: true,
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    configPath: '/Users/alice/.claude/mcp.json',
    manageable: true,
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    configPath: '/Users/alice/.windsurf/mcp.json',
    manageable: true,
  },
  // The two states the "partially supported" section can hold, which are NOT
  // the same thing. Claude Desktop is manageable: SealGate writes its config, it
  // just also supports Connectors it can't see. ChatGPT is only detectable, so
  // it renders with no checkbox and a "Not protected" tag.
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    configPath: '/Users/alice/Library/Application Support/Claude/claude_desktop_config.json',
    manageable: true,
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    configPath: 'Connectors · managed server-side in your ChatGPT account',
    manageable: false,
  },
];

/** Two detected MCP clients ready to configure. */
export const WithDetectedClients: Story = {
  decorators: [
    (Story) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).api.mcp.detectClients = async () => ({ clients: MOCK_CLIENTS, daemonUnavailable: false });
      return (
        <div style={{ width: '400px' }}>
          <Story />
        </div>
      );
    },
  ],
};

/** No clients found on the machine. */
export const NoClientsDetected: Story = {
  decorators: [
    (Story) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).api.mcp.detectClients = async () => ({ clients: [], daemonUnavailable: false });
      return (
        <div style={{ width: '400px' }}>
          <Story />
        </div>
      );
    },
  ],
};

/** Loading state while detecting clients. */
export const Loading: Story = {
  decorators: [
    (Story) => {
      // Never resolves → stays in loading state for screenshot
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).api.mcp.detectClients = () => new Promise(() => {});
      return (
        <div style={{ width: '400px' }}>
          <Story />
        </div>
      );
    },
  ],
};
