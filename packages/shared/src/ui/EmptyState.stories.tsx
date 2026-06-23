import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import EmptyState from './EmptyState'

const meta: Meta<typeof EmptyState> = {
  title: 'UI/EmptyState',
  component: EmptyState,
  parameters: { layout: 'padded' }
}

export default meta
type Story = StoryObj<typeof EmptyState>

export const Default: Story = {
  args: {
    title: 'No sessions found',
    description: 'There are no sessions matching your filters.'
  }
}

export const WithIcon: Story = {
  args: {
    icon: '🔍',
    title: 'No results',
    description: 'Try adjusting your search or filter criteria.'
  }
}

export const WithAction: Story = {
  args: {
    icon: '📋',
    title: 'No policies yet',
    description: 'Create your first policy to get started.',
    action: { label: 'Create Policy', onClick: fn() }
  }
}

export const MinimalNoDescription: Story = {
  args: {
    title: 'Nothing here'
  }
}
