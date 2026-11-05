import type { OrgNode, OrgType } from "../types/tree"

function flattenTree(nodes: OrgNode[], out: OrgNode[] = []): OrgNode[] {
  for (const node of nodes) {
    out.push(node)
    if (node.children?.length) flattenTree(node.children, out)
  }
  return out
}

/** Nodes grouped by type, in tree order. */
export function groupNodesByType(nodes: OrgNode[]): Partial<Record<OrgType, OrgNode[]>> {
  const groups: Partial<Record<OrgType, OrgNode[]>> = {}
  for (const node of flattenTree(nodes)) (groups[node.type] ??= []).push(node)
  return groups
}
