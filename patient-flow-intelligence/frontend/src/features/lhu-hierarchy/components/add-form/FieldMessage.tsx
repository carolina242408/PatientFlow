import { useTranslation } from "react-i18next"
import { FormMessage, useFormField } from "@/components/Form"

/** FormMessage that translates the zod message key under lhuHierarchy.form.validation. */
export function FieldMessage() {
  const { t } = useTranslation()
  const { error } = useFormField()
  if (!error?.message) return null
  return <FormMessage>{t(`lhuHierarchy.form.validation.${error.message}`)}</FormMessage>
}
