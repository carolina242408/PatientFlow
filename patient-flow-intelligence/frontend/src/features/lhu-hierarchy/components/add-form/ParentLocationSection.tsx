import { useTranslation } from "react-i18next"
import { useFormContext } from "react-hook-form"
import { FormControl, FormField, FormItem, FormLabel } from "@/components/Form"
import { Select, SelectOption } from "@/components/Select"
import type { OrgType } from "../../types/tree"
import type { AddNodeValues } from "../../utils/add-node-schema"
import { getAncestors } from "../../utils/org-types"
import { FieldMessage } from "./FieldMessage"
import { FormSection } from "./FormSection"

export function ParentLocationSection({ type }: { type: OrgType }) {
  const { t } = useTranslation()
  const { control } = useFormContext<AddNodeValues>()
  const ancestors = getAncestors(type)

  if (ancestors.length === 0) return null

  return (
    <FormSection title={t("lhuHierarchy.form.sections.parentLocation")}>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {ancestors.map((ancestor) => (
          <FormField
            key={ancestor}
            control={control}
            name={`parents.${ancestor}`}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t(`lhuHierarchy.types.${ancestor}`)}</FormLabel>
                <FormControl>
                  {/* ponytail: only the placeholder for now, options will come from the loaded tree */}
                  <Select {...field} value={field.value ?? ""}>
                    <SelectOption value="">
                      {t("lhuHierarchy.form.placeholders.parent", { type: t(`lhuHierarchy.types.${ancestor}`) })}
                    </SelectOption>
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
