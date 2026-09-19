/**
 * Layout data shapes.
 *
 * These mirror the entities in ADR-003 (Folder §3.4, Tag §3.6) and are deliberately
 * kept local to the web app until `packages/shared` ships the canonical entity types
 * (owned by the backend tasks). The sidebar renders these passively; it does not own
 * how folders/tags are fetched or filtered — that wiring lands in a later task.
 */
export interface FolderNode {
  id: string
  name: string
  /** parentId forms the tree; `null` means the folder sits at the vault root. */
  parentId: string | null
}

export interface TagNode {
  id: string
  name: string
}
