import { z } from "zod"
import type { OrgType } from "../types/tree"
import { OPERATIONAL_STATUSES, ROOM_TYPES } from "./form-options"
import { getAncestors } from "./org-types"

// Error messages are keys under lhuHierarchy.form.validation, translated by FieldMessage.
export function buildAddNodeSchema(type: OrgType) {
  const parents = z.object(
    Object.fromEntries(
      getAncestors(type).map((a) => [a, z.string().min(1, "required")]),
    ),
  )

  const base = z.object({
    parents,
    name: z.string().trim().min(1, "required"),
    internalCode: z.string().trim(),
    status: z.enum(OPERATIONAL_STATUSES),
    notes: z.string(),
  })

  return type === "room" ? base.extend({ roomType: z.enum(ROOM_TYPES) }) : base
}

export type AddNodeValues = {
  parents: Partial<Record<OrgType, string>>
  name: string
  internalCode: string
  status: (typeof OPERATIONAL_STATUSES)[number]
  notes: string
  roomType?: (typeof ROOM_TYPES)[number]
}

export function getDefaultValues(
  type: OrgType,
  parentIds: Partial<Record<OrgType, string>> = {},
): AddNodeValues {
  const values: AddNodeValues = {
    parents: Object.fromEntries(getAncestors(type).map((a) => [a, parentIds[a] ?? ""])),
    name: "",
    internalCode: "",
    status: "operational",
    notes: "",
  }

  if (type === "room") values.roomType = "NURSERY_ROOM"

  return values
}
