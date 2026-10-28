import { useTranslation } from "react-i18next"
import { useFormContext } from "react-hook-form"
import { FormControl, FormField, FormItem, FormLabel } from "@/components/Form"
import { Select, SelectOption } from "@/components/Select"
import type { AddNodeValues } from "../../utils/add-node-schema"
import { FieldMessage } from "./FieldMessage"

interface OptionsSelectFieldProps {
  name: "status" | "service" | "subtype" | "connectivity"
  options: readonly string[]
}

export function OptionsSelectField({ name, options }: OptionsSelectFieldProps) {
  const { t } = useTranslation()
  const { control } = useFormContext<AddNodeValues>()

  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{t(`lhuHierarchy.form.fields.${name}`)}</FormLabel>
          <FormControl>
            <Select {...field}>
              {options.map((option) => (
                <SelectOption key={option} value={option}>
                  {t(`lhuHierarchy.options.${name}.${option}`)}
                </SelectOption>
              ))}
            </Select>
          </FormControl>
          <FieldMessage />
        </FormItem>
      )}
    />
  )
}
