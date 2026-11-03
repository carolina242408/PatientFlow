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

const frontendType = (type: string): OrgType => {
  const typeMap: Record<string, OrgType> = {
    ULS: "lhu",
    UNIT: "unit",
    BUILDING: "building",
    FLOOR: "floor",
    WING: "wing",
    SERVICE: "service",
    WARD: "ward",
    ROOM: "room",
    BED: "bed",
  }

  const mappedType = typeMap[type.toUpperCase()]
  if (!mappedType) {
    throw new Error(`Tipo de hierarquia desconhecido: ${type}`)
  }
  return mappedType
}

const backendType = (type: OrgType) => {
  if (type === "lhu") return "uls"
  if (type === "operating-room" || type === "treatment-chair") {
    throw new Error(`O backend ainda não suporta o tipo de recurso ${type}`)
  }
  return type
}

const mapNodes = (content: HierarchyResponse["content"]): OrgNode[] =>
  content.map((node) => ({
    id: node.id,
    name: node.name,
    type: frontendType(node.type),
    parentId: node.parentId,
    status: "operational",
  }))

export async function fetchHierarchyLevel(type: OrgType, parentId?: string): Promise<OrgNode[]> {
  const response = await api.get<HierarchyResponse>(`/hierarchy/${backendType(type)}`, {
    params: { page: 0, size: 100, ...(parentId ? { parentId } : {}) },
  })
  return mapNodes(response.data.content)
}

export async function fetchLHUHierarchy(startType: OrgType = "lhu"): Promise<OrgNode[]> {
  return fetchHierarchyLevel(startType)
}

export async function fetchCompleteLHUHierarchy(): Promise<OrgNode[]> {
  const responses = await Promise.all(
    BACKEND_TYPES.map((type) =>
      api.get<HierarchyResponse>(`/hierarchy/${type}`, {
        params: { page: 0, size: 100 },
      }),
    ),
  )
  const nodes = responses.flatMap((response) => mapNodes(response.data.content))
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
  const knownIds = new Set(nodes.map((node) => node.id))
  return nodes
    .filter((node) => node.parentId === null || !knownIds.has(node.parentId))
    .map(attachChildren)
}

export async function fetchHierarchyChildren(node: OrgNode): Promise<OrgNode[]> {
  const childType: Partial<Record<OrgType, OrgType>> = {
    lhu: "unit",
    unit: "building",
    building: "floor",
    floor: "service",
    service: "wing",
    wing: "ward",
    ward: "room",
    room: "bed",
  }
  const nextType = childType[node.type]
  return nextType ? fetchHierarchyLevel(nextType, node.id) : []
}

export async function createHierarchyNode(
  type: OrgType,
  input: { name?: string; code?: string; parentId?: string; serviceId?: string },
) {
  const bType = backendType(type)
  const payload = { ...input }

  // Se for um tipo que exige código (ex: service, ward) e o code não veio preenchido:
  if ((type === "service" || type === "ward") && (!payload.code || payload.code.trim() === "")) {
    payload.code = payload.name ? payload.name.trim().toUpperCase().replace(/\s+/g, "_") : "CODE"
  }

  const response = await api.post(`/hierarchy/${bType}`, payload)
  return response.data
}
