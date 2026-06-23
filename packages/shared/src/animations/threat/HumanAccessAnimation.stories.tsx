import type { Meta, StoryObj } from '@storybook/react-vite'
import HumanAccessAnimation from './HumanAccessAnimation'

const meta: Meta<typeof HumanAccessAnimation> = {
  title: 'Animations/HumanAccessAnimation',
  component: HumanAccessAnimation,
  parameters: {
    layout: 'centered'
  }
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  decorators: [
    (Story) => (
      <div style={{ padding: '24px', background: 'var(--bg-base)', width: 420 }}>
        <Story />
      </div>
    )
  ]
}

export const LightTheme: Story = {
  decorators: [
    (Story) => (
      <div data-theme="light" style={{ padding: '24px', background: '#f8fafc', width: 420 }}>
        <Story />
      </div>
    )
  ]
}
