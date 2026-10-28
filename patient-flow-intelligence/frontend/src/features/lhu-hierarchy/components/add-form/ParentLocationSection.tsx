import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useFormContext, useWatch } from "react-hook-form"
import { FormControl, FormField, FormItem, FormLabel } from "@/components/Form"
import { Select, SelectOption } from "@/components/Select"
import { useLHUHierarchy } from "../../hooks/useLHUHierarchy"
import type { OrgNode, OrgType } from "../../types/tree"
import type { AddNodeValues } from "../../utils/add-node-schema"
import { getAncestors } from "../../utils/org-types"
import { groupNodesByType } from "../../utils/tree"
import { FieldMessage } from "./FieldMessage"
import { FormSection } from "./FormSection"

export function ParentLocationSection({ type }: { type: OrgType }) {
  const { t } = useTranslation()
  const { control, setValue } = useFormContext<AddNodeValues>()
  const parents = useWatch({ control, name: "parents" })
  const { data, isPending } = useLHUHierarchy()
  const nodesByType = useMemo(() => groupNodesByType(data ?? []), [data])
  const ancestors = getAncestors(type)

  if (ancestors.length === 0) return null

  // Each select only offers the children of the node chosen one level up.
  const optionsFor = (index: number): OrgNode[] => {
    const nodes = nodesByType[ancestors[index]] ?? []
    if (index === 0) return nodes
    const parentId = parents[ancestors[index - 1]]
    return nodes.filter((node) => node.parentId === parentId)
  }

  const clearBelow = (index: number) => {
    for (const ancestor of ancestors.slice(index + 1))
      setValue(`parents.${ancestor}`, "")
  }

  return (
    <FormSection title={t("lhuHierarchy.form.sections.parentLocation")}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ancestors.map((ancestor, index) => (
          <FormField
            key={ancestor}
            control={control}
            name={`parents.${ancestor}`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t(`lhuHierarchy.types.${ancestor}`)}</FormLabel>

                <FormControl>
                  <Select
                    {...field}
                    value={field.value ?? ""}
                    disabled={isPending}
                    onChange={(event) => {
                      field.onChange(event)
                      clearBelow(index)
                    }}
                  >
                    <SelectOption value="">
                      {t("lhuHierarchy.form.placeholders.parent", {
                        type: t(`lhuHierarchy.types.${ancestor}`),
                      })}
                    </SelectOption>

                    {optionsFor(index).map((node) => (
                      <SelectOption key={node.id} value={node.id}>
                        {node.name}
                      </SelectOption>
                    ))}
                  </Select>
                </FormControl>

                <FieldMessage />
              </FormItem>
            )}
          />
        ))}
      </div>
    </FormSection>
  )
}
