import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/Card"
import type { OrgType } from "../types/tree"
import { PREMISE_TYPES, RESOURCE_TYPES } from "../utils/org-types"
import { TypeGroup } from "./TypeGroup"

export function AddResourceStep() {
  const { t } = useTranslation()
  // ponytail: selection is visual only until step 2 exists
  const [selected, setSelected] = useState<OrgType | null>(null)

  return (
    <div className="space-y-5">
      <Card className="gap-8">
        <CardHeader className="gap-3">
          <p className="text-sm font-medium tracking-wide text-[#2563EB] uppercase">{t("lhuHierarchy.add.step")}</p>
          <CardTitle className="text-2xl font-bold">{t("lhuHierarchy.add.title")}</CardTitle>
          <CardDescription className="max-w-3xl text-base">{t("lhuHierarchy.add.description")}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-8">
          <TypeGroup label={t("lhuHierarchy.add.premise")} types={PREMISE_TYPES} selected={selected} onSelect={setSelected} />
          <TypeGroup label={t("lhuHierarchy.add.resource")} types={RESOURCE_TYPES} selected={selected} onSelect={setSelected} />
        </CardContent>
      </Card>

      <div className="rounded-lg border border-dashed border-[#2563EB]/40 bg-blue-50/40 py-6 text-center text-base font-medium text-[#2563EB]">
        {t("lhuHierarchy.add.hint")}
      </div>
    </div>
  )
}
