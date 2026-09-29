import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FolderNameDialog from './FolderNameDialog'

function renderDialog(overrides: Partial<Parameters<typeof FolderNameDialog>[0]> = {}) {
  const onConfirm = vi.fn()
  const onClose = vi.fn()
  return {
    ...render(
      <FolderNameDialog
        title="Create folder"
        initialName="New folder"
        onConfirm={onConfirm}
        onClose={onClose}
        {...overrides}
      />,
    ),
    spies: { onConfirm, onClose },
  }
}

describe('FolderNameDialog — rendering', () => {
  it('renders as a modal dialog with the given title', () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: /create folder/i })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Create folder' })).toBeTruthy()
  })

  it('renders a text input pre-filled with initialName', () => {
    renderDialog({ initialName: 'Engineering' })
    const input = screen.getByRole('textbox', { name: /name/i })
    expect(input).toHaveValue('Engineering')
    expect(input).toHaveAttribute('autocomplete', 'off')
    expect(input).toHaveAttribute('spellcheck', 'false')
    expect(input).toHaveAttribute('maxlength', '255')
  })

  it('shows a character counter', () => {
    renderDialog({ initialName: 'x' })
    expect(screen.getByText(/1\/255 characters/)).toBeTruthy()
  })

  it('shows Cancel and Create buttons', () => {
    renderDialog()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy()
  })

  it('disables the confirm button when the name is empty', () => {
    renderDialog({ initialName: '' })
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })

  it('disables the confirm button when name is whitespace only', () => {
    renderDialog({ initialName: '   ' })
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })

  it('enables the confirm button when name has content', () => {
    renderDialog()
    const input = screen.getByRole('textbox', { name: /name/i })
    fireEvent.change(input, { target: { value: '  ' } })
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()

    fireEvent.change(input, { target: { value: ' foo ' } })
    expect(screen.getByRole('button', { name: 'Create' })).not.toBeDisabled()
  })
})

describe('FolderNameDialog — submit flow', () => {
  it('calls onConfirm with trimmed name when Create is clicked', () => {
    const { spies } = renderDialog({ initialName: '  Engineering  ' })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(spies.onConfirm).toHaveBeenCalledWith('Engineering')
    expect(spies.onClose).not.toHaveBeenCalled()
  })

  it('calls onConfirm with trimmed name when Enter is pressed in the input', () => {
    const { spies } = renderDialog({ initialName: '  Work  ' })
    const input = screen.getByRole('textbox', { name: /name/i })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(spies.onConfirm).toHaveBeenCalledWith('Work')
  })

  it('does not call onConfirm when Enter is pressed with empty name', () => {
    const { spies } = renderDialog({ initialName: '' })
    const input = screen.getByRole('textbox', { name: /name/i })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(spies.onConfirm).not.toHaveBeenCalled()
  })

  it('updates the input value as the user types', () => {
    renderDialog({ initialName: 'a' })
    const input = screen.getByRole('textbox', { name: /name/i })
    fireEvent.change(input, { target: { value: 'abcdef' } })
    expect(input).toHaveValue('abcdef')
    expect(screen.getByText(/6\/255 characters/)).toBeTruthy()
  })

  it('respects the maxLength of 255 on the input', () => {
    renderDialog({ initialName: 'a' })
    const input = screen.getByRole('textbox', { name: /name/i })
    expect(input).toHaveAttribute('maxlength', '255')
  })
})

describe('FolderNameDialog — cancel flow', () => {
  it('calls onClose when Cancel is clicked', () => {
    const { spies } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(spies.onClose).toHaveBeenCalledTimes(1)
    expect(spies.onConfirm).not.toHaveBeenCalled()
  })

  it('calls onClose when Escape is pressed', () => {
    const { spies } = renderDialog()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(spies.onClose).toHaveBeenCalledTimes(1)
    expect(spies.onConfirm).not.toHaveBeenCalled()
  })

  it('calls onClose when clicking on the overlay backdrop', () => {
    const { spies } = renderDialog()
    const overlay = screen.getByRole('dialog').closest('.folder-name-dialog-overlay') as HTMLElement
    expect(overlay).toBeTruthy()
    fireEvent.click(overlay, { target: overlay })
    expect(spies.onClose).toHaveBeenCalledTimes(1)
  })

  it('does not call onClose when clicking inside the dialog box', () => {
    const { spies } = renderDialog()
    // Click the dialog content box (the inner div), not the overlay backdrop.
    const contentBox = screen.getByRole('dialog').querySelector('.folder-name-dialog') as HTMLElement
    fireEvent.click(contentBox)
    expect(spies.onClose).not.toHaveBeenCalled()
  })
})

describe('FolderNameDialog — rename variant', () => {
  it('renders "Rename folder" title and "Rename" button when title starts with Rename', () => {
    const { spies } = renderDialog({
      title: 'Rename folder',
      initialName: 'Old name',
    })
    expect(screen.getByRole('heading', { name: 'Rename folder' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }))
    expect(spies.onConfirm).toHaveBeenCalledWith('Old name')
  })
})

describe('FolderNameDialog — focus management', () => {
  it('focuses the input on first render', () => {
    renderDialog({ initialName: 'test' })
    const input = screen.getByRole('textbox', { name: /name/i })
    expect(document.activeElement).toBe(input)
  })
})

describe('FolderNameDialog — a11y attributes', () => {
  it('marks the input with an aria-describedby pointing to the hint', () => {
    renderDialog()
    const input = screen.getByRole('textbox', { name: /name/i })
    const hint = screen.getByText(/0\/255 characters/)
    expect(input).toHaveAttribute('aria-describedby', hint.id)
  })

  it('has aria-modal="true" on the dialog', () => {
    renderDialog()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
  })
})
