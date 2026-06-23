import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import Button from '../Button'

describe('Button', () => {
  it('renders all variants without crashing', () => {
    const variants = ['primary', 'secondary', 'ghost', 'danger'] as const
    for (const variant of variants) {
      const { unmount } = render(<Button variant={variant}>{variant}</Button>)
      expect(screen.getByRole('button', { name: variant })).toBeTruthy()
      unmount()
    }
  })

  it('shows spinner when loading', () => {
    render(<Button loading>Save</Button>)
    const button = screen.getByRole('button', { name: /save/i })
    expect(button).toBeDisabled()
    expect(button.querySelector('svg')).toBeTruthy()
  })

  it('is disabled when disabled prop is set', () => {
    render(<Button disabled>Click</Button>)
    expect(screen.getByRole('button', { name: /click/i })).toBeDisabled()
  })
})
