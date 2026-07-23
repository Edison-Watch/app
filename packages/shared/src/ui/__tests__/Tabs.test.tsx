import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import Tabs, { type TabItem } from '../Tabs'

const tabs: TabItem[] = [
  { key: 'alpha', label: 'Alpha' },
  { key: 'beta', label: 'Beta', badge: 3 },
  { key: 'gamma', label: 'Gamma' }
]

function renderTabs(initialEntry = '/', onChange?: (key: string) => void) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Tabs tabs={tabs} onChange={onChange} />
    </MemoryRouter>
  )
}

describe('Tabs', () => {
  it('renders all tab labels and badge', () => {
    renderTabs()
    expect(screen.getByRole('tab', { name: /Alpha/i })).toBeDefined()
    expect(screen.getByRole('tab', { name: /Beta/i })).toBeDefined()
    expect(screen.getByText('3')).toBeDefined()
    expect(screen.getByRole('tab', { name: /Gamma/i })).toBeDefined()
  })

  it('clicking a tab calls onChange and marks it active', () => {
    const onChange = vi.fn()
    renderTabs('/', onChange)

    const betaTab = screen.getByRole('tab', { name: /Beta/i })
    fireEvent.click(betaTab)
    expect(onChange).toHaveBeenCalledWith('beta')
    expect(betaTab.getAttribute('aria-selected')).toBe('true')
  })

  it('sets active tab from URL param on mount', () => {
    renderTabs('/?tab=gamma')
    const gammaTab = screen.getByRole('tab', { name: /Gamma/i })
    expect(gammaTab.getAttribute('aria-selected')).toBe('true')
  })

  it('navigates tabs with arrow keys', () => {
    renderTabs('/?tab=alpha')
    const tablist = screen.getByRole('tablist')

    // ArrowRight moves to beta
    fireEvent.keyDown(tablist, { key: 'ArrowRight' })
    const betaTab = screen.getByRole('tab', { name: /Beta/i })
    expect(betaTab.getAttribute('aria-selected')).toBe('true')

    // ArrowLeft wraps back to alpha
    fireEvent.keyDown(tablist, { key: 'ArrowLeft' })
    const alphaTab = screen.getByRole('tab', { name: /Alpha/i })
    expect(alphaTab.getAttribute('aria-selected')).toBe('true')
  })
})
