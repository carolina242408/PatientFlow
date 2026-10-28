import { useTranslation } from "react-i18next"

export function SelectionHint() {
  const { t } = useTranslation()

  return (
    <div className="rounded-lg border border-dashed border-[#2563EB]/40 bg-blue-50/40 py-6 text-center text-base font-medium text-[#2563EB]">
      {t("lhuHierarchy.add.hint")}
    </div>
  )
}
