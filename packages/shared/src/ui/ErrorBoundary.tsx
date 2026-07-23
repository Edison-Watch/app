import { Component, type ErrorInfo, type ReactNode } from 'react'

import Button from './Button'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends Component<Props, State> {
  override state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  override render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback
      return (
        <div
          className="flex flex-col items-center justify-center gap-4 py-12 text-center"
          role="alert"
        >
          <div className="text-4xl">⚠️</div>
          <h2 className="text-lg font-semibold text-[var(--text-primary)]">Something went wrong</h2>
          <p className="text-sm text-[var(--text-secondary)] max-w-md">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <Button variant="secondary" onClick={this.handleReset}>
            Try again
          </Button>
        </div>
      )
    }
    return this.props.children
  }
}
