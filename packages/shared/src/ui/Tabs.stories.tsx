import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import { MemoryRouter } from 'react-router'
import Tabs from './Tabs'

const meta: Meta<typeof Tabs> = {
  title: 'UI/Tabs',
  component: Tabs,
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    )
  ]
}

export default meta
type Story = StoryObj<typeof Tabs>

export const Default: Story = {
  args: {
    tabs: [
      { key: 'sessions', label: 'Sessions' },
      { key: 'policies', label: 'Policies' },
      { key: 'servers', label: 'Servers' }
    ],
    onChange: fn()
  }
}

export const WithBadges: Story = {
  args: {
    tabs: [
      { key: 'all', label: 'All', badge: 142 },
      { key: 'active', label: 'Active', badge: 12 },
      { key: 'pending', label: 'Pending', badge: 3 },
      { key: 'completed', label: 'Completed', badge: 127 }
    ],
    onChange: fn()
  }
}

export const TwoTabs: Story = {
  args: {
    tabs: [
      { key: 'overview', label: 'Overview' },
      { key: 'details', label: 'Details' }
    ],
    onChange: fn()
  }
}

export const ManyTabs: Story = {
  args: {
    tabs: [
      { key: 'sessions', label: 'Sessions' },
      { key: 'users', label: 'Users' },
      { key: 'policies', label: 'Policies' },
      { key: 'servers', label: 'Servers' },
      { key: 'audit', label: 'Audit Log' },
      { key: 'settings', label: 'Settings' }
    ],
    onChange: fn()
  }
}
