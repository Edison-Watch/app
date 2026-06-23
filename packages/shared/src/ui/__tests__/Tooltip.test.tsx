import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import Tooltip from '../Tooltip'

describe('Tooltip', () => {
  it('shows tooltip on hover and hides on leave', () => {
    render(
      <Tooltip content="Help text">
        <button>Hover me</button>
      </Tooltip>
    )

    const trigger = screen.getByText('Hover me').parentElement!

    // Not visible initially
    expect(screen.queryByRole('tooltip')).toBeNull()

    // Shows on hover
    fireEvent.mouseEnter(trigger)
    expect(screen.getByRole('tooltip')).toBeDefined()
    expect(screen.getByText('Help text')).toBeDefined()

    // Hides on leave
    fireEvent.mouseLeave(trigger)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('shows tooltip on focus and hides on blur', () => {
    render(
      <Tooltip content="Keyboard tip">
        <button>Focus me</button>
      </Tooltip>
    )

    const trigger = screen.getByText('Focus me').parentElement!

    fireEvent.focus(trigger)
    expect(screen.getByRole('tooltip')).toBeDefined()
    expect(screen.getByText('Keyboard tip')).toBeDefined()

    fireEvent.blur(trigger)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('links trigger to tooltip via aria-describedby on the child element', () => {
    render(
      <Tooltip content="Accessible tip">
        <button>Trigger</button>
      </Tooltip>
    )

    const wrapper = screen.getByText('Trigger').parentElement!
    fireEvent.mouseEnter(wrapper)

    const tooltip = screen.getByRole('tooltip')
    const id = tooltip.getAttribute('id')
    const button = screen.getByText('Trigger')
    expect(button.getAttribute('aria-describedby')).toBe(id)
  })
})
