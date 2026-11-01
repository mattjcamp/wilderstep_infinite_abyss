/**
 * Folder tree for the sprite catalog. Built purely from sprite paths —
 * a sprite's place in the tree is exactly the folder it lives in under
 * `sprites/` (category folder, then any subfolders), nothing else.
 *
 *   town/house/chapel/door.png → town › house › chapel › door.png
 */

export interface SpriteTreeNode {
  /** Folder name ("chapel"); "" for the root. */
  name: string;
  /** Folder path under sprites/ ("town/house/chapel"); "" for the root. */
  path: string;
  /** Sprites directly in this folder, as full paths under sprites/. */
  files: string[];
  /** Subfolders, sorted by name. */
  children: SpriteTreeNode[];
}

/** Build the tree from the catalog's `categories` map. Category folders
 *  keep the index's order; subfolders and files sort by name. Pass
 *  `include` to keep only some sprites — folders left empty are dropped. */
export function buildSpriteTree(
  categories: Record<string, string[]>,
  include: (path: string) => boolean = () => true,
): SpriteTreeNode {
  const root: SpriteTreeNode = { name: "", path: "", files: [], children: [] };
  const byPath = new Map<string, SpriteTreeNode>([["", root]]);

  const folder = (path: string): SpriteTreeNode => {
    const hit = byPath.get(path);
    if (hit) return hit;
    const slash = path.lastIndexOf("/");
    const parent = folder(slash >= 0 ? path.slice(0, slash) : "");
    const node: SpriteTreeNode = {
      name: slash >= 0 ? path.slice(slash + 1) : path,
      path,
      files: [],
      children: [],
    };
    parent.children.push(node);
    byPath.set(path, node);
    return node;
  };

  for (const [cat, files] of Object.entries(categories)) {
    for (const f of files) {
      const full = `${cat}/${f}`;
      if (!include(full)) continue;
      folder(full.slice(0, full.lastIndexOf("/"))).files.push(full);
    }
  }

  const sortDeep = (n: SpriteTreeNode, keepOrder: boolean) => {
    n.files.sort();
    if (!keepOrder) n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.children.forEach((c) => sortDeep(c, false));
  };
  sortDeep(root, true);
  return root;
}

/** Total sprites in a folder and everything under it. */
export function countSprites(node: SpriteTreeNode): number {
  return node.children.reduce((n, c) => n + countSprites(c), node.files.length);
}

/** Every folder path in the tree (root excluded), depth-first. */
export function allFolderPaths(node: SpriteTreeNode): string[] {
  return node.children.flatMap((c) => [c.path, ...allFolderPaths(c)]);
}

/** Folders on the way to a sprite ("town/house/chapel/door.png" →
 *  ["town", "town/house", "town/house/chapel"]). */
export function ancestorFolders(spritePath: string): string[] {
  const parts = spritePath.split("/").slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}
