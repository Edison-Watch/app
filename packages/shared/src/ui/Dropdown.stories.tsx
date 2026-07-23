import type { Meta, StoryObj } from '@storybook/react-vite'
import { fn } from 'storybook/test'
import Dropdown from './Dropdown'
import Button from './Button'

const meta: Meta<typeof Dropdown> = {
  title: 'UI/Dropdown',
  component: Dropdown
}

export default meta
type Story = StoryObj<typeof Dropdown>

export const Default: Story = {
  args: {
    trigger: <Button variant="secondary">Actions</Button>,
    items: [
      { key: 'edit', label: 'Edit' },
      { key: 'duplicate', label: 'Duplicate' },
      { key: 'archive', label: 'Archive' },
      { key: 'delete', label: 'Delete', danger: true }
    ],
    onSelect: fn()
  }
}

export const WithDisabledItems: Story = {
  args: {
    trigger: <Button variant="secondary">Options</Button>,
    items: [
      { key: 'view', label: 'View Details' },
      { key: 'edit', label: 'Edit', disabled: true },
      { key: 'export', label: 'Export' },
      { key: 'delete', label: 'Delete', danger: true, disabled: true }
    ],
    onSelect: fn()
  }
}

export const AlignRight: Story = {
  args: {
    trigger: <Button variant="ghost">Menu</Button>,
    items: [
      { key: 'profile', label: 'Profile' },
      { key: 'settings', label: 'Settings' },
      { key: 'logout', label: 'Sign Out', danger: true }
    ],
    align: 'right',
    onSelect: fn()
  }
}
