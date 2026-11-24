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

export type OrgNode = {
  id: string
  name: string
  code?: string | null
  type: OrgType
  parentId: string | null
  status: string
  children?: OrgNode[]
}
