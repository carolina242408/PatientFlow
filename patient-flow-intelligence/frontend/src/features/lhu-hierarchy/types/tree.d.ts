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
  type: OrgType
  parentId: string | null
  status: string
  children?: OrgNode[]
}
