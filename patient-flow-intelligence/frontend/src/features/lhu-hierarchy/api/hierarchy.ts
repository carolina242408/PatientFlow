import api from "../../../api/axios"
import type { OrgNode, OrgType } from "../types/tree"

interface HierarchyResponse {
  content: Array<{
    id: string
    type: string
    parentId: string | null
    name: string
    code: string | null
    serviceId: string | null
  }>
}

const BACKEND_TYPES = [
  "uls",
  "unit",
  "building",
  "floor",
  "wing",
  "service",
  "ward",
  "room",
  "bed",
] as const

const frontendType = (type: string): OrgType => (type === "WING" ? "nursery" : type.toLowerCase() as OrgType)

export async function fetchLHUHierarchy(): Promise<OrgNode[]> {
  const responses = await Promise.all(
    BACKEND_TYPES.map((type) =>
      api.get<HierarchyResponse>(`/hierarchy/${type}`, {
        params: { page: 0, size: 100 },
      }),
    ),
  )
  const nodes = responses.flatMap((response) =>
    response.data.content.map((node) => ({
      id: node.id,
      name: node.name,
      type: frontendType(node.type),
      parentId: node.parentId,
      status: "operational",
    })),
  )
  const childrenByParent = new Map<string | null, OrgNode[]>()
  for (const node of nodes) {
    const children = childrenByParent.get(node.parentId) ?? []
    children.push(node)
    childrenByParent.set(node.parentId, children)
  }
  const attachChildren = (node: OrgNode): OrgNode => {
    const children = childrenByParent.get(node.id)?.map(attachChildren)
    return children?.length ? { ...node, children } : node
  }
  return (childrenByParent.get(null) ?? []).map(attachChildren)
}

const backendType = (type: OrgType) => {
  if (type === "lhu") return "uls"
  if (type === "nursery") return "wing"
  if (type === "operating-room" || type === "treatment-chair") {
    throw new Error(`O backend ainda não suporta o tipo de recurso ${type}`)
  }
  return type
}

export async function createHierarchyNode(
  type: OrgType,
  input: { name?: string; code?: string; parentId?: string; serviceId?: string },
) {
  const response = await api.post(`/hierarchy/${backendType(type)}`, input)
  return response.data
}
