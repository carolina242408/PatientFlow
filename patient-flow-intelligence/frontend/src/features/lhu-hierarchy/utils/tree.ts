import type { FlatRow, HierarchyStats, OrgNode, OrgType } from "../types/tree"
import { PREMISE_TYPES, RESOURCE_TYPES } from "./org-types"

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

export function getHierarchyStats(nodes: OrgNode[]): HierarchyStats {
  const rows = flattenTree(nodes)

  return {
    levels: rows.length ? Math.max(...rows.map((r) => r.depth)) + 1 : 0,
    spaces: rows.filter((r) => PREMISE_TYPES.includes(r.node.type)).length,
    resourceGroups: rows.filter((r) => RESOURCE_TYPES.includes(r.node.type))
      .length,
    operationalItems: rows.length,
  }
}

/** Nodes grouped by type, in tree order. */
export function groupNodesByType(nodes: OrgNode[]): Partial<Record<OrgType, OrgNode[]>> {
  const groups: Partial<Record<OrgType, OrgNode[]>> = {}
  for (const { node } of flattenTree(nodes)) (groups[node.type] ??= []).push(node)
  return groups
}
