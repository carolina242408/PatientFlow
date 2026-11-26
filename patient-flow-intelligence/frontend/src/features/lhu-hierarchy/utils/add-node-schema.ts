import { z } from "zod"
import type { OrgType } from "../types/tree"
import { getAncestors } from "./org-types"

// Error messages are keys under lhuHierarchy.form.validation, translated by FieldMessage.
export function buildAddNodeSchema(type: OrgType) {
  const parents = z.object(
    Object.fromEntries(
      getAncestors(type).map((a) => [a, z.string().min(1, "required")]),
    ),
  )

  return z.object({
    parents,
    name: z.string().trim().min(1, "required"),
    internalCode: z.string().trim(),
    notes: z.string(),
  })
}

export type AddNodeValues = {
  parents: Partial<Record<OrgType, string>>
  name: string
  internalCode: string
  notes: string
}

export function getDefaultValues(
  type: OrgType,
  parentIds: Partial<Record<OrgType, string>> = {},
): AddNodeValues {
  return {
    parents: Object.fromEntries(getAncestors(type).map((a) => [a, parentIds[a] ?? ""])),
    name: "",
    internalCode: "",
    notes: "",
  }
}
