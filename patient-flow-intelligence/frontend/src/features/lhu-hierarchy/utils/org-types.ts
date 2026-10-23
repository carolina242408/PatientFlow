import type { OrgType } from "../types/tree"

export const PREMISE_TYPES: OrgType[] = ["lhu", "unit", "building", "floor", "ward", "nursery", "room"]
export const RESOURCE_TYPES: OrgType[] = ["bed", "operating-room", "treatment-chair"]

export const PARENT_TYPE: Record<OrgType, OrgType | null> = {
  lhu: null,
  unit: "lhu",
  building: "unit",
  floor: "building",
  ward: "floor",
  nursery: "ward",
  room: "nursery",
  bed: "room",
  "operating-room": "floor",
  "treatment-chair": "ward",
}

export const isResourceType = (type: OrgType) => RESOURCE_TYPES.includes(type)

/** Ancestors of a type, root first, up to and including its parent. lhu → []. */
export function getAncestors(type: OrgType): OrgType[] {
  const chain: OrgType[] = []
  for (let parent = PARENT_TYPE[type]; parent; parent = PARENT_TYPE[parent]) chain.unshift(parent)
  return chain
}
