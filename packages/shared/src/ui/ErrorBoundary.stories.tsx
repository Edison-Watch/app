import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import ErrorBoundary from './ErrorBoundary'

const meta: Meta<typeof ErrorBoundary> = {
  title: 'UI/ErrorBoundary',
  component: ErrorBoundary,
  parameters: { layout: 'padded' }
}

export default meta
type Story = StoryObj<typeof ErrorBoundary>

function ThrowingComponent(): ReactNode {
  throw new Error('Something went wrong in the component!')
}

export const WithError: Story = {
  render: () => (
    <ErrorBoundary>
      <ThrowingComponent />
    </ErrorBoundary>
  )
}

export const WithCustomFallback: Story = {
  render: () => (
    <ErrorBoundary
      fallback={
        <div style={{ padding: 24, color: 'var(--danger)', textAlign: 'center' }}>
          Custom error fallback UI
        </div>
      }
    >
      <ThrowingComponent />
    </ErrorBoundary>
  )
}

export const NoError: Story = {
  render: () => (
    <ErrorBoundary>
      <p style={{ color: 'var(--text-primary)' }}>This content renders normally.</p>
    </ErrorBoundary>
  )
}
