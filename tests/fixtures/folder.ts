/**
 * tests/fixtures/folder.ts — synthetic folder trees.
 *
 * AR-4: folder names are fixed synthetic constants. Permission masks use the
 * three ADR-001 levels (Read/Update/Owner = 1/7/15), no real data.
 */

import { syntheticUuid, syntheticTimestamp } from "./identifiers.ts";

/** Permission levels (ADR-001 §5: Read=1, Update=7, Owner=15). */
export const PERMISSION = {
  READ: 1,
  UPDATE: 7,
  OWNER: 15,
} as const;

export type PermissionLevel = (typeof PERMISSION)[keyof typeof PERMISSION];

/** Synthetic folder name. Deterministic by index (TEST_STRATEGY §7). */
export function syntheticFolderName(index = 1): string {
  return `test-folder-${index}`;
}

export interface SyntheticFolder {
  id: string;
  parentId: string | null;
  name: string;
  permission: PermissionLevel;
  createdAt: string;
  updatedAt: string;
  deletedAt: null;
}

/** A synthetic folder (never a real folder, never a real permission set). */
export function syntheticFolder(
  index = 1,
  overrides: Partial<SyntheticFolder> = {},
): SyntheticFolder {
  const now = syntheticTimestamp();
  return {
    id: syntheticUuid(),
    parentId: null,
    name: syntheticFolderName(index),
    permission: PERMISSION.OWNER,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

/** A synthetic two-level folder tree (root + children), for permission-mask and
 *  tree-walk tests. Returns `{ root, children }` with children linked by parentId. */
export function syntheticFolderTree(childCount = 3): {
  root: SyntheticFolder;
  children: SyntheticFolder[];
} {
  const root = syntheticFolder(1);
  const children = Array.from({ length: childCount }, (_, i) =>
    syntheticFolder(i + 2, { parentId: root.id }),
  );
  return { root, children };
}
