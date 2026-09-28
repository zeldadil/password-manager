import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FolderTree from './FolderTree'
import type { FolderNode } from './types'

const folders: FolderNode[] = [
  { id: 'root-a', name: 'Work', parentId: null },
  { id: 'root-b', name: 'Personal', parentId: null },
  { id: 'child-a1', name: 'Engineering', parentId: 'root-a' },
  { id: 'child-a2', name: 'Finance', parentId: 'root-a' },
]

const vaultId = 'vault-1'

// ── Fake ApiClient ─────────────────────────────────────────────────────────────

type FakeClient = {
  post: ReturnType<typeof vi.fn>
  patch: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
}

function fakeClient(responses: Record<string, unknown> = {}): FakeClient {
  const postFn = vi.fn(async (path: string) => {
    const r = responses[path]
    if (r instanceof Error) throw r
    return r
  })
  const patchFn = vi.fn(async (path: string) => {
    const r = responses[path]
    if (r instanceof Error) throw r
    return r
  })
  const deleteFn = vi.fn(async (path: string) => {
    const r = responses[path]
    if (r instanceof Error) throw r
    return r
  })
  return { post: postFn, patch: patchFn, delete: deleteFn, get: vi.fn() }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('FolderTree — context menu & folder management', () => {
  it('renders the folder tree with root-level folders visible', () => {
    const client = fakeClient()
    render(<FolderTree folders={folders} client={client as any} vaultId={vaultId} />)
    // Root-level folders are always visible
    expect(screen.getByText('Work')).toBeTruthy()
    expect(screen.getByText('Personal')).toBeTruthy()
    // Children are nested inside parent, only visible when expanded
    expect(screen.queryByText('Engineering')).toBeNull()
  })

  it('shows a context menu on right-click with all four actions', async () => {
    const client = fakeClient()
    const { unmount } = render(<FolderTree folders={folders} client={client as any} vaultId={vaultId} />)
    const workItem = screen.getByText('Work').closest('li') as HTMLElement
    fireEvent.contextMenu(workItem, { clientX: 100, clientY: 100 })

    await waitFor(() => screen.getByRole('menu'))
    expect(screen.getByRole('menuitem', { name: /New subfolder/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Rename/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Move to/ })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: /Delete/ })).toBeTruthy()
    unmount()
  })

  it('opens a create dialog when "New subfolder" is chosen', async () => {
    const client = fakeClient()
    const { unmount } = render(<FolderTree folders={folders} client={client as any} vaultId={vaultId} />)
    const workItem = screen.getByText('Work').closest('li') as HTMLElement
    fireEvent.contextMenu(workItem, { clientX: 50, clientY: 50 })
    await waitFor(() => screen.getByRole('menu'))
    fireEvent.click(screen.getByRole('menuitem', { name: /New subfolder/ }))

    await waitFor(() => screen.getByRole('dialog'))
    expect(screen.getByLabelText('Folder name')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    unmount()
  })

  it('creates a subfolder when the dialog is submitted with a valid name', async () => {
    const created = { id: 'new-1', name: 'Design', parentId: 'root-a' }
    const client = fakeClient({ '/folders': created })

    const { unmount } = render(<FolderTree folders={folders} client={client as any} vaultId={vaultId} />)
    const workItem = screen.getByText('Work').closest('li') as HTMLElement
    fireEvent.contextMenu(workItem, { clientX: 50, clientY: 50 })
    await waitFor(() => screen.getByRole('menu'))
    fireEvent.click(screen.getByRole('menuitem', { name: /New subfolder/ }))

    await waitFor(() => screen.getByLabelText('Folder name'))

    const input = screen.getByLabelText('Folder name')
    fireEvent.change(input, { target: { value: 'Design' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(client.post).toHaveBeenCalledWith('/folders', {
        vaultId,
        name: 'Design',
        parentId: 'root-a',
      })
    })
    unmount()
  })

  it('shows a validation error when creating with an empty name', async () => {
    const client = fakeClient()
    const { unmount } = render(<FolderTree folders={folders} client={client as any} vaultId={vaultId} />)
    const workItem = screen.getByText('Work').closest('li') as HTMLElement
    fireEvent.contextMenu(workItem, { clientX: 50, clientY: 50 })
    await waitFor(() => screen.getByRole('menu'))
    fireEvent.click(screen.getByRole('menuitem', { name: /New subfolder/ }))

    await waitFor(() => screen.getByRole('dialog'))

    // Click Create with empty input — the component validates on submit
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Name is required')
    })
    unmount()
  })

  it('renames a folder when the rename dialog is submitted', async () => {
    const renamed = { id: 'root-a', name: 'Work Projects', parentId: null }
    const client = fakeClient({ '/folders/root-a': renamed })

    const { unmount } = render(<FolderTree folders={folders} client={client as any} vaultId={vaultId} />)
    const workItem = screen.getByText('Work').closest('li') as HTMLElement
    fireEvent.contextMenu(workItem, { clientX: 50, clientY: 50 })
    await waitFor(() => screen.getByRole('menu'))
    fireEvent.click(screen.getByRole('menuitem', { name: /Rename/ }))

    await waitFor(() => screen.getByLabelText('New name'))

    const input = screen.getByLabelText('New name')
    expect(input).toHaveValue('Work')
    fireEvent.change(input, { target: { value: 'Work Projects' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))

    await waitFor(() => {
      expect(client.patch).toHaveBeenCalledWith('/folders/root-a', { name: 'Work Projects' })
    })
    // Verify the dialog closed after successful rename
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    unmount()
  })

  it('moves a folder to a new parent when the move dialog is submitted', async () => {
    const moved = { id: 'child-a1', name: 'Engineering', parentId: 'root-b' }
    const client = fakeClient({ '/folders/child-a1': moved })

    const { unmount } = render(<FolderTree folders={folders} client={client as any} vaultId={vaultId} />)
    // Expand Work to access Engineering (child)
    const workItem = screen.getByText('Work').closest('li') as HTMLElement
    fireEvent.click(workItem.querySelector('.folder-tree__toggle') as HTMLElement)
    await waitFor(() => screen.getByText('Engineering'))

    const engItem = screen.getByText('Engineering').closest('li') as HTMLElement
    fireEvent.contextMenu(engItem, { clientX: 100, clientY: 100 })
    await waitFor(() => screen.getByRole('menu'))

    fireEvent.click(screen.getByRole('menuitem', { name: /Move to/ }))
    await waitFor(() => screen.getByRole('dialog'))

    // Select target parent from dropdown
    const targetSelect = screen.getByLabelText('Target parent') as HTMLSelectElement
    fireEvent.change(targetSelect, { target: { value: 'root-b' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move' }))

    await waitFor(() => {
      expect(client.patch).toHaveBeenCalledWith('/folders/child-a1', { parentId: 'root-b' })
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    unmount()
  })

  it('deletes a folder when the delete dialog is confirmed', async () => {
    const deleted = { status: 'deleted', id: 'child-a2' }
    const client = fakeClient({ '/folders/child-a2': deleted })

    const { unmount } = render(<FolderTree folders={folders} client={client as any} vaultId={vaultId} />)
    // Expand Work to access Finance (child)
    const workItem = screen.getByText('Work').closest('li') as HTMLElement
    fireEvent.click(workItem.querySelector('.folder-tree__toggle') as HTMLElement)
    await waitFor(() => screen.getByText('Finance'))

    const financeItem = screen.getByText('Finance').closest('li') as HTMLElement
    fireEvent.contextMenu(financeItem, { clientX: 100, clientY: 100 })
    await waitFor(() => screen.getByRole('menu'))
    fireEvent.click(screen.getByRole('menuitem', { name: /Delete/ }))

    await waitFor(() => screen.getByRole('dialog'))
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: /Delete folder/ })).toBeTruthy()
    )
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(client.delete).toHaveBeenCalledWith('/folders/child-a2')
    })
    unmount()
  })

  it('closes the context menu on Escape', async () => {
    const client = fakeClient()
    const { unmount } = render(<FolderTree folders={folders} client={client as any} vaultId={vaultId} />)
    const workItem = screen.getByText('Work').closest('li') as HTMLElement
    fireEvent.contextMenu(workItem, { clientX: 50, clientY: 50 })
    await waitFor(() => screen.getByRole('menu'))

    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape', bubbles: true })
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull()
    })
    unmount()
  })

  it('closes the context menu when clicking outside it', async () => {
    const client = fakeClient()
    const { unmount } = render(<FolderTree folders={folders} client={client as any} vaultId={vaultId} />)
    const workItem = screen.getByText('Work').closest('li') as HTMLElement
    fireEvent.contextMenu(workItem, { clientX: 50, clientY: 50 })
    await waitFor(() => screen.getByRole('menu'))

    fireEvent.mouseDown(document.body)
    await waitFor(() => {
      expect(screen.queryByRole('menu')).toBeNull()
    })
    unmount()
  })

  it('allows creating a root-level folder via the "+ New folder" button', async () => {
    const created = { id: 'root-c', name: 'Social', parentId: null }
    const client = fakeClient({ '/folders': created })

    const { unmount } = render(<FolderTree folders={folders} client={client as any} vaultId={vaultId} />)
    expect(screen.getByRole('button', { name: 'Create root-level folder' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Create root-level folder' }))
    await waitFor(() => screen.getByRole('dialog'))

    const input = screen.getByLabelText('Folder name')
    fireEvent.change(input, { target: { value: 'Social' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(client.post).toHaveBeenCalledWith('/folders', {
        vaultId,
        name: 'Social',
        parentId: null,
      })
    })
    unmount()
  })

  it('calls onFoldersChanged after a successful mutation', async () => {
    const client = fakeClient({ '/folders/root-a': { id: 'root-a', name: 'Work Projects', parentId: null } })
    const onChanged = vi.fn()
    const { unmount } = render(<FolderTree folders={folders} client={client as any} vaultId={vaultId} onFoldersChanged={onChanged} />)

    const workItem = screen.getByText('Work').closest('li') as HTMLElement
    fireEvent.contextMenu(workItem, { clientX: 50, clientY: 50 })
    await waitFor(() => screen.getByRole('menu'))
    fireEvent.click(screen.getByRole('menuitem', { name: /Rename/ }))

    await waitFor(() => screen.getByLabelText('New name'))

    const input = screen.getByLabelText('New name')
    fireEvent.change(input, { target: { value: 'Work Projects' } })
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1)
    })
    unmount()
  })
})
