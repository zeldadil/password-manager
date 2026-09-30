/** @fileoverview Create / Rename folder dialog — small modal for folder name input.
 *
 * FE-003g. Used for both creating a subfolder (pre-filled "New folder") and
 * renaming an existing folder (pre-filled with current name). A single dialog
 * keeps the UX consistent and the code small.
 *
 * The caller passes `initialName` and `onConfirm` — the dialog calls
 * `onConfirm(name)` when the user submits a non-empty trimmed name, or
 * `onClose` if they cancel/click outside/close.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

export interface FolderNameDialogProps {
  /** Dialog title — e.g. "Create folder" or "Rename folder". */
  title: string
  /** Initial (pre-filled) name. */
  initialName: string
  /** Called on submit with the trimmed name (guaranteed non-empty by the dialog). */
  onConfirm: (name: string) => void
  /** Called on cancel / outside click / Escape. */
  onClose: () => void
  /** Called when the user types in the input — receives the current raw value. */
  onChange?: (value: string) => void
}

export default function FolderNameDialog({
  title,
  initialName,
  onConfirm,
  onClose,
  onChange,
}: FolderNameDialogProps) {
  const [name, setName] = useState(initialName.trim())
  const inputRef = useRef<HTMLInputElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Focus input on mount.
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // Close on Escape anywhere in the document while the dialog is open.
  useEffect(() => {
    const handleDocKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('keydown', handleDocKeyDown)
    return () => document.removeEventListener('keydown', handleDocKeyDown)
  }, [onClose])

  const handleSubmit = useCallback(() => {
    const trimmed = name.trim()
    if (trimmed) {
      onConfirm(trimmed)
    }
  }, [name, onConfirm])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  // Close on click on the overlay backdrop (clicking the dialog content itself does not close).
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (overlayRef.current) {
        // Don't close if the click landed inside the dialog content box.
        const contentBox = overlayRef.current.querySelector('.folder-name-dialog')
        if (!contentBox || !contentBox.contains(e.target as Node)) {
          onClose()
        }
      }
    },
    [onClose],
  )

  const handleInputChange = useCallback(
    (value: string) => {
      setName(value)
      onChange?.(value)
    },
    [onChange],
  )

  return (
    <div
      className="folder-name-dialog-overlay"
      ref={overlayRef}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="folder-name-dialog-title"
      tabIndex={-1}
    >
      <div className="folder-name-dialog" role="document">
        <h2 id="folder-name-dialog-title" className="folder-name-dialog__title">
          {title}
        </h2>
        <label className="folder-name-dialog__label" htmlFor="folder-name-input">
          Name
        </label>
        <input
          ref={inputRef}
          id="folder-name-input"
          className="folder-name-dialog__input"
          type="text"
          value={name}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={255}
          autoComplete="off"
          spellCheck="false"
          aria-describedby="folder-name-dialog-hint"
        />
        <p id="folder-name-dialog-hint" className="folder-name-dialog__hint">
          {name.length}/255 characters
        </p>
        <div className="folder-name-dialog__actions">
          <button
            type="button"
            className="folder-name-dialog__cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="folder-name-dialog__confirm"
            onClick={handleSubmit}
            disabled={name.trim().length === 0}
          >
            {title.startsWith('Rename') ? 'Rename' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
