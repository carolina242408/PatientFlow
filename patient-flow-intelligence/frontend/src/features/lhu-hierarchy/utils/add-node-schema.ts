import { z } from "zod"
import type { OrgType } from "../types/tree"
import {
  CONNECTIVITY,
  OPERATIONAL_STATUSES,
  RESOURCE_SUBTYPES,
  RESPONSIBLE_SERVICES,
} from "./form-options"
import { getAncestors, isResourceType } from "./org-types"

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
    service: z.enum(RESPONSIBLE_SERVICES),
    notes: z.string(),
  })

  if (!isResourceType(type)) return base

  return base.extend({
    subtype: z.enum(RESOURCE_SUBTYPES),
    connectivity: z.enum(CONNECTIVITY),
    capacity: z.coerce.number().int().min(1, "min"),
  })
}

export type AddNodeValues = {
  parents: Partial<Record<OrgType, string>>
  name: string
  internalCode: string
  status: (typeof OPERATIONAL_STATUSES)[number]
  service: (typeof RESPONSIBLE_SERVICES)[number]
  notes: string
  subtype?: (typeof RESOURCE_SUBTYPES)[number]
  connectivity?: (typeof CONNECTIVITY)[number]
  capacity?: number
}

export function getDefaultValues(type: OrgType): AddNodeValues {
  const values: AddNodeValues = {
    parents: Object.fromEntries(getAncestors(type).map((a) => [a, ""])),
    name: "",
    internalCode: "",
    status: "operational",
    service: "cardiology",
    notes: "",
  }

  if (isResourceType(type))
    Object.assign(values, {
      subtype: "standard",
      connectivity: "connected",
      capacity: 1,
    })

  return values
}
