export type OrgType =
  | "lhu"
  | "unit"
  | "building"
  | "floor"
  | "service"
  | "wing"
  | "ward"
  | "room"
  | "bed"
  | "operating-room"
  | "treatment-chair"

export type OrgNode = {
  id: string
  name: string
  type: OrgType
  parentId: string | null
  status: string
  children?: OrgNode[]
}

export type FlatRow = { node: OrgNode; depth: number; hasChildren: boolean }

export type HierarchyStats = Record<"levels" | "spaces" | "resourceGroups" | "operationalItems", number>
