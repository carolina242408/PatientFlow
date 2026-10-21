type OrgType =
  | "lhu"
  | "unit"
  | "building"
  | "floor"
  | "ward"
  | "nursery"
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
