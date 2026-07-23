import type { Meta, StoryObj } from '@storybook/react-vite'
import { ToastProvider, useToast } from './Toast'
import Button from './Button'

const meta: Meta = {
  title: 'UI/Toast',
  decorators: [
    (Story) => (
      <ToastProvider>
        <Story />
      </ToastProvider>
    )
  ]
}

export default meta
type Story = StoryObj

function ToastDemo({
  variant,
  message
}: {
  variant?: 'success' | 'error' | 'info'
  message: string
}) {
  const { addToast } = useToast()
  return <Button onClick={() => addToast(message, variant)}>Show Toast</Button>
}

export const Success: Story = {
  render: () => <ToastDemo variant="success" message="Policy saved successfully!" />
}

export const Error: Story = {
  render: () => <ToastDemo variant="error" message="Failed to connect to server." />
}

export const Info: Story = {
  render: () => <ToastDemo variant="info" message="Session is being recorded." />
}

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8 }}>
      <ToastDemo variant="success" message="Success toast" />
      <ToastDemo variant="error" message="Error toast" />
      <ToastDemo variant="info" message="Info toast" />
    </div>
  )
}

export const AutoDismiss: Story = {
  render: () => (
    <div style={{ color: 'var(--text-secondary)' }}>
      <p style={{ marginBottom: 12 }}>Toasts auto-dismiss after 5 seconds.</p>
      <ToastDemo variant="info" message="This will disappear in 5 seconds." />
    </div>
  )
}
