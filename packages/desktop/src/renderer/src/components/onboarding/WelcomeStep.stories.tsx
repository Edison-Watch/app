import type { Meta, StoryObj } from '@storybook/react-vite';
import WelcomeStep from './WelcomeStep';

const meta: Meta<typeof WelcomeStep> = {
  title: 'Client2/WelcomeStep',
  component: WelcomeStep,
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const baseAuth: Parameters<typeof WelcomeStep>[0]['auth'] = {
  loading: false,
  error: '',
  warning: '',
  awaitingBrowserCallback: false,
  pendingUserCode: '',
  pendingVerificationUri: '',
  signedIn: false,
  email: '',
  userId: '',
  apiKey: '',
  mcpBaseUrl: '',
  apiBaseUrl: '',
  autoQuarantineOtherMcpServers: false,
  serverStatus: 'checking',
  signInWithBrowser: async () => {},
  reopenVerificationPage: () => {},
  cancelPendingAuth: () => {},
  signOut: async () => {},
};

export const SignInForm: Story = {
  args: {
    auth: baseAuth,
    onNext: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: '360px' }}>
        <Story />
      </div>
    ),
  ],
};

export const AwaitingApproval: Story = {
  args: {
    auth: {
      ...baseAuth,
      loading: true,
      awaitingBrowserCallback: true,
      pendingUserCode: 'ABCD-EFGH',
      pendingVerificationUri: 'https://dashboard.sealgate.ai/device?user_code=ABCD-EFGH',
    },
    onNext: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: '360px' }}>
        <Story />
      </div>
    ),
  ],
};

export const Loading: Story = {
  args: {
    auth: { ...baseAuth, loading: true },
    onNext: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: '360px' }}>
        <Story />
      </div>
    ),
  ],
};

export const WithError: Story = {
  args: {
    auth: { ...baseAuth, error: 'The sign-in request was denied.' },
    onNext: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: '360px' }}>
        <Story />
      </div>
    ),
  ],
};

export const SignedIn: Story = {
  args: {
    auth: { ...baseAuth, signedIn: true, email: 'alice@example.com', serverStatus: 'online' },
    onNext: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: '360px' }}>
        <Story />
      </div>
    ),
  ],
};

export const SignedInOffline: Story = {
  args: {
    auth: { ...baseAuth, signedIn: true, email: 'alice@example.com', serverStatus: 'offline' },
    onNext: () => {},
  },
  decorators: [
    (Story) => (
      <div style={{ width: '360px' }}>
        <Story />
      </div>
    ),
  ],
};
