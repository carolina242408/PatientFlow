import { useTranslation } from "react-i18next"
import { useFormContext } from "react-hook-form"
import { FormControl, FormField, FormItem, FormLabel } from "@/components/Form"
import { Input } from "@/components/Input"
import type { AddNodeValues } from "../../utils/add-node-schema"
import { CONNECTIVITY, RESOURCE_SUBTYPES } from "../../utils/form-options"
import { FieldMessage } from "./FieldMessage"
import { FormSection } from "./FormSection"
import { OptionsSelectField } from "./OptionsSelectField"

export function ResourceCharacteristicsSection() {
  const { t } = useTranslation()
  const { control } = useFormContext<AddNodeValues>()

  return (
    <FormSection title={t("lhuHierarchy.form.sections.resourceCharacteristics")}>
      <div className="grid gap-4 md:grid-cols-3">
        <OptionsSelectField name="subtype" options={RESOURCE_SUBTYPES} />
        <OptionsSelectField name="connectivity" options={CONNECTIVITY} />
        <FormField
          control={control}
          name="capacity"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("lhuHierarchy.form.fields.capacity")}</FormLabel>
              <FormControl>
                <Input type="number" min={1} {...field} />
              </FormControl>
              <FieldMessage />
            </FormItem>
          )}
        />
      </div>
    </FormSection>
  )
}
