import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import TagsList from './TagsList'
import type { TagNode } from './types'

const sample: TagNode[] = [
  { id: 't1', name: 'Production' },
  { id: 't2', name: 'Staging' },
  { id: 't3', name: 'Development' },
]

describe('TagsList', () => {
  it('renders nothing when there are no tags', () => {
    const { container } = render(<TagsList tags={[]} />)
    expect(container.querySelector('ul')).toBeNull()
  })

  it('renders every tag as a button', () => {
    render(<TagsList tags={sample} />)
    expect(screen.getByRole('button', { name: 'Production' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Staging' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Development' })).toBeTruthy()
  })

  it('renders the list with role="list"', () => {
    render(<TagsList tags={sample} />)
    expect(screen.getByRole('list', { name: 'Tags' })).toBeTruthy()
  })

  it('toggles active state on click (controlled)', () => {
    const onFilter = vi.fn()
    render(<TagsList tags={sample} onFilter={onFilter} />)

    const stagingBtn = screen.getByRole('button', { name: 'Staging' })
    expect(stagingBtn.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(stagingBtn)
    expect(onFilter).toHaveBeenCalledWith('t2')
    expect(stagingBtn.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(stagingBtn)
    expect(onFilter).toHaveBeenLastCalledWith(null)
    expect(stagingBtn.getAttribute('aria-pressed')).toBe('false')
  })

  it('activates a tag and deactivates previous active on click (controlled)', () => {
    const onFilter = vi.fn()
    render(<TagsList tags={sample} onFilter={onFilter} />)

    const prodBtn = screen.getByRole('button', { name: 'Production' })
    const stagingBtn = screen.getByRole('button', { name: 'Staging' })

    fireEvent.click(prodBtn)
    expect(onFilter).toHaveBeenCalledWith('t1')
    expect(prodBtn.getAttribute('aria-pressed')).toBe('true')
    expect(stagingBtn.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(stagingBtn)
    expect(onFilter).toHaveBeenLastCalledWith('t2')
    expect(prodBtn.getAttribute('aria-pressed')).toBe('false')
    expect(stagingBtn.getAttribute('aria-pressed')).toBe('true')
  })

  it('deactivates when clicking the active tag (controlled)', () => {
    const onFilter = vi.fn()
    render(<TagsList tags={sample} onFilter={onFilter} />)

    const devBtn = screen.getByRole('button', { name: 'Development' })
    fireEvent.click(devBtn)
    expect(onFilter).toHaveBeenCalledWith('t3')

    fireEvent.click(devBtn)
    expect(onFilter).toHaveBeenLastCalledWith(null)
  })

  it('renders active class on the active tag', () => {
    render(<TagsList tags={sample} onFilter={vi.fn()} activeTagId="t1" />)
    expect(screen.getByRole('button', { name: 'Production' })).toHaveClass('tags-list__tag--active')
    expect(screen.getByRole('button', { name: 'Staging' })).not.toHaveClass(
      'tags-list__tag--active',
    )
  })

  it('clears active tag when clicking active tag in uncontrolled mode', async () => {
    const user = userEvent.setup()
    render(<TagsList tags={sample} />)
    const stagingBtn = screen.getByRole('button', { name: 'Staging' })

    await user.click(stagingBtn)
    expect(stagingBtn.getAttribute('aria-pressed')).toBe('true')
    expect(stagingBtn).toHaveClass('tags-list__tag--active')

    await user.click(stagingBtn)
    expect(stagingBtn.getAttribute('aria-pressed')).toBe('false')
    expect(stagingBtn).not.toHaveClass('tags-list__tag--active')
  })

  it('switches active tag in uncontrolled mode', async () => {
    const user = userEvent.setup()
    render(<TagsList tags={sample} />)

    await user.click(screen.getByRole('button', { name: 'Production' }))
    expect(screen.getByRole('button', { name: 'Production' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(screen.getByRole('button', { name: 'Staging' }).getAttribute('aria-pressed')).toBe(
      'false',
    )

    await user.click(screen.getByRole('button', { name: 'Staging' }))
    expect(screen.getByRole('button', { name: 'Production' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
    expect(screen.getByRole('button', { name: 'Staging' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })

  it('works in uncontrolled mode (no onFilter prop)', () => {
    render(<TagsList tags={sample} />)
    fireEvent.click(screen.getByRole('button', { name: 'Production' }))
    expect(screen.getByRole('button', { name: 'Production' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
  })

  it('renders a single tag only', () => {
    const single: TagNode[] = [{ id: 'x', name: 'Solo' }]
    render(<TagsList tags={single} />)
    expect(screen.getByRole('button', { name: 'Solo' })).toBeTruthy()
    expect(screen.getAllByRole('button')).toHaveLength(1)
  })
})
