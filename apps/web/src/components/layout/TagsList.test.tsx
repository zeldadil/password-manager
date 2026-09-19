import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import TagsList from './TagsList'
import type { TagNode } from './types'

const sample: TagNode[] = [
  { id: 't1', name: 'Production' },
  { id: 't2', name: 'Staging' },
]

describe('TagsList', () => {
  it('renders every tag', () => {
    render(<TagsList tags={sample} />)
    expect(screen.getByText('Production')).toBeTruthy()
    expect(screen.getByText('Staging')).toBeTruthy()
  })

  it('renders nothing when there are no tags', () => {
    const { container } = render(<TagsList tags={[]} />)
    expect(container.querySelector('ul')).toBeNull()
  })
})
