// Debug test: trace context menu behavior
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FolderTree from './FolderTree'
import type { FolderNode } from './types'

const sampleTree: FolderNode[] = [
  { id: 'root1', name: 'Work', parentId: null },
  { id: 'child1', name: 'Engineering', parentId: 'root1' },
  { id: 'grandchild1', name: 'Frontend', parentId: 'child1' },
  { id: 'child2', name: 'Finance', parentId: 'root1' },
  { id: 'root2', name: 'Personal', parentId: null },
  { id: 'child3', name: 'Health', parentId: 'root2' },
]

describe('context-menu debug', () => {
  it('traces context menu handler calls', () => {
    const onCreate = vi.fn()
    const onRename = vi.fn()
    const onDelete = vi.fn()
    const onMove = vi.fn()

    const { container } = render(
      <FolderTree
        folders={sampleTree}
        onCreate={onCreate}
        onRename={onRename}
        onDelete={onDelete}
        onMove={onMove}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /expand work/i }))

    const financeRow = screen.getByText('Finance').closest('.folder-tree__row') as HTMLElement
    console.log('BEFORE contextMenu:')
    console.log('  financeRow.className:', financeRow.className)
    console.log('  financeRow.dataset.folderId:', financeRow.dataset.folderId)

    fireEvent.contextMenu(financeRow, { clientX: 300, clientY: 200 })

    console.log('AFTER contextMenu:')
    console.log('  financeRow.className:', financeRow.className)
    console.log('  financeRow.dataset.folderId:', financeRow.dataset.folderId)

    const updatedRow = screen.getByText('Finance').closest('.folder-tree__row')
    console.log('updatedRow.className:', updatedRow?.className)
    console.log('updatedRow.dataset.folderId:', updatedRow?.dataset.folderId)
    console.log('container innerHTML (first 4000):', container.innerHTML.substring(0, 4000))
  })
})
