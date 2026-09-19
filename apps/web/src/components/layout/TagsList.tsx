import type { TagNode } from './types'

export interface TagsListProps {
  tags?: readonly TagNode[]
}

/**
 * Renders the vault's flat, non-hierarchical tag list (ADR-003 §3.6). Tag selection
 * and vault filtering are wired in a later task — this component only renders the list.
 */
export default function TagsList({ tags = [] }: TagsListProps) {
  if (tags.length === 0) return null
  return (
    <ul>
      {tags.map((tag) => (
        <li key={tag.id}>{tag.name}</li>
      ))}
    </ul>
  )
}
