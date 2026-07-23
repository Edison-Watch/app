import type { Meta, StoryObj } from '@storybook/react-vite'
import AgentBypassAnimation from './AgentBypassAnimation'

const meta: Meta<typeof AgentBypassAnimation> = {
  title: 'Animations/AgentBypassAnimation',
  component: AgentBypassAnimation,
  parameters: {
    layout: 'centered'
  }
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  decorators: [
    (Story) => (
      <div style={{ padding: '24px', background: 'var(--bg-base)', width: 800 }}>
        <Story />
      </div>
    )
  ]
}

export const LightTheme: Story = {
  decorators: [
    (Story) => (
      <div data-theme="light" style={{ padding: '24px', background: '#f8fafc', width: 800 }}>
        <Story />
      </div>
    )
  ]
}
