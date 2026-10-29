import { useTranslation } from "react-i18next"
import { useFormContext } from "react-hook-form"
import { FormControl, FormField, FormItem, FormLabel } from "@/components/Form"
import { Textarea } from "@/components/Textarea"
import type { AddNodeValues } from "../../utils/add-node-schema"
import { FieldMessage } from "./FieldMessage"

export function NotesField() {
  const { t } = useTranslation()
  const { control } = useFormContext<AddNodeValues>()

  return (
    <FormField
      control={control}
      name="notes"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t("lhuHierarchy.form.fields.notes")}</FormLabel>
          <FormControl>
            <Textarea placeholder={t("lhuHierarchy.form.placeholders.notes")} {...field} />
          </FormControl>
          <FieldMessage />
        </FormItem>
      )}
    />
  )
}
