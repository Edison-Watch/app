import type { Meta, StoryObj } from '@storybook/react-vite'
import StdioVsHttpAnimation from './StdioVsHttpAnimation'

const meta: Meta<typeof StdioVsHttpAnimation> = {
  title: 'Animations/StdioVsHttpAnimation',
  component: StdioVsHttpAnimation,
  parameters: {
    layout: 'centered',
  },
}

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  decorators: [
    (Story: React.ComponentType) => (
      <div style={{ padding: '24px', width: 900, background: 'var(--bg-base)' }}>
        <style>{'[data-story] svg { max-width: none !important; }'}</style>
        <div data-story><Story /></div>
      </div>
    ),
  ],
}

export const LightTheme: Story = {
  decorators: [
    (Story: React.ComponentType) => (
      <div data-theme="light" style={{ padding: '24px', width: 900, background: '#f8fafc' }}>
        <style>{'[data-story] svg { max-width: none !important; }'}</style>
        <div data-story><Story /></div>
      </div>
    ),
  ],
}
