import { useCallback, useState } from 'react'
import type { TagNode } from './types'

export interface TagsListProps {
  tags?: readonly TagNode[]
  /** Called when a tag is clicked — `tag.id` when activating, `null` when deactivating. */
  onFilter?: (tagId: string | null) => void
  /** Currently active tag id (for controlled highlight). */
  activeTagId?: string | null
}

export default function TagsList({ tags = [], onFilter, activeTagId }: TagsListProps) {
  const [localActive, setLocalActive] = useState<string | null>(activeTagId ?? null)

  const effectiveActive = activeTagId !== undefined ? activeTagId : localActive

  const handleClick = useCallback(
    (tag: TagNode) => {
      const newActive = effectiveActive === tag.id ? null : tag.id
      setLocalActive(newActive)
      if (onFilter) {
        onFilter(newActive)
      }
    },
    [effectiveActive, onFilter],
  )

  if (tags.length === 0) return null

  return (
    <ul className="tags-list" role="list" aria-label="Tags">
      {tags.map((tag) => {
        const isActive = effectiveActive === tag.id
        return (
          <li key={tag.id}>
            <button
              type="button"
              className={`tags-list__tag ${isActive ? 'tags-list__tag--active' : ''}`}
              onClick={() => handleClick(tag)}
              aria-pressed={isActive}
            >
              {tag.name}
            </button>
          </li>
        )
      })}
    </ul>
  )
}