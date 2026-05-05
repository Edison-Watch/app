import type { Meta, StoryObj } from '@storybook/react-vite'
import CodeModeSecurityAnimation from './CodeModeSecurityAnimation'

const meta: Meta<typeof CodeModeSecurityAnimation> = {
  title: 'Animations/CodeModeSecurityAnimation',
  component: CodeModeSecurityAnimation,
  parameters: {
    layout: 'centered',
  },
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  decorators: [
    (Story) => (
      <div style={{ padding: '24px', width: '780px', background: 'var(--bg-base)' }}>
        <Story />
      </div>
    ),
  ],
}

export const LightTheme: Story = {
  decorators: [
    (Story) => (
      <div data-theme="light" style={{ padding: '24px', width: '780px', background: '#f8fafc' }}>
        <Story />
      </div>
    ),
  ],
}
