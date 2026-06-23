import type { Meta, StoryObj } from '@storybook/react-vite'
import SSEIndicator from './SSEIndicator'

const meta: Meta<typeof SSEIndicator> = {
  title: 'UI/SSEIndicator',
  component: SSEIndicator,
  argTypes: {
    status: {
      control: 'select',
      options: ['connected', 'reconnecting', 'disconnected']
    }
  }
}

export default meta
type Story = StoryObj<typeof SSEIndicator>

export const Connected: Story = { args: { status: 'connected' } }
export const Reconnecting: Story = { args: { status: 'reconnecting' } }
export const Disconnected: Story = { args: { status: 'disconnected' } }

export const AllStates: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 24 }}>
      <SSEIndicator status="connected" />
      <SSEIndicator status="reconnecting" />
      <SSEIndicator status="disconnected" />
    </div>
  )
}
