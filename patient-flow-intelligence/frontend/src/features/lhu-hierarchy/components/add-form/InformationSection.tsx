import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { useFormContext } from "react-hook-form"
import { FormControl, FormField, FormItem, FormLabel } from "@/components/Form"
import { Input } from "@/components/Input"
import type { OrgType } from "../../types/tree"
import type { AddNodeValues } from "../../utils/add-node-schema"
import { OPERATIONAL_STATUSES, ROOM_TYPES } from "../../utils/form-options"
import { FieldMessage } from "./FieldMessage"
import { FormSection } from "./FormSection"
import { OptionsSelectField } from "./OptionsSelectField"

export function InformationSection({ type, children }: { type: OrgType; children?: ReactNode }) {
  const { t } = useTranslation()
  const { control } = useFormContext<AddNodeValues>()
  const typeLabel = t(`lhuHierarchy.types.${type}`)

  return (
    <FormSection title={t("lhuHierarchy.form.sections.information", { type: typeLabel })}>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          control={control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("lhuHierarchy.form.fields.name")}</FormLabel>
              <FormControl>
                <Input placeholder={t("lhuHierarchy.form.placeholders.name", { type: typeLabel })} {...field} />
              </FormControl>
              <FieldMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name="internalCode"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("lhuHierarchy.form.fields.internalCode")}</FormLabel>
              <FormControl>
                <Input placeholder={t("lhuHierarchy.form.placeholders.internalCode")} {...field} />
              </FormControl>
              <FieldMessage />
            </FormItem>
          )}
        />
        <OptionsSelectField name="status" options={OPERATIONAL_STATUSES} />
        {type === "room" && <OptionsSelectField name="roomType" options={ROOM_TYPES} />}
        {children && <div className="md:col-span-2">{children}</div>}
      </div>
    </FormSection>
  )
}
