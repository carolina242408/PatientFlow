import type { FlatRow, OrgNode } from "../types/tree"

export function flattenTree(
  nodes: OrgNode[],
  depth = 0,
  out: FlatRow[] = [],
): FlatRow[] {
  for (const node of nodes) {
    const hasChildren = !!node.children?.length

    out.push({ node, depth, hasChildren })

    if (hasChildren) flattenTree(node.children!, depth + 1, out)
  }

  return out
}
