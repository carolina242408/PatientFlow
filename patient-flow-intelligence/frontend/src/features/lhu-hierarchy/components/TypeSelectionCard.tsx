import { useTranslation } from "react-i18next"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/Card"
import type { OrgType } from "../types/tree"
import { PREMISE_TYPES, RESOURCE_TYPES } from "../utils/org-types"
import { TypeGroup } from "./TypeGroup"

interface TypeSelectionCardProps {
  selected: OrgType | null
  onSelect: (type: OrgType) => void
}

export function TypeSelectionCard({ selected, onSelect }: TypeSelectionCardProps) {
  const { t } = useTranslation()

  return (
    <Card className="gap-8">
      <CardHeader className="gap-3">
        <p className="text-sm font-medium tracking-wide text-[#2563EB] uppercase">{t("lhuHierarchy.add.step")}</p>
        <CardTitle className="text-2xl font-bold">{t("lhuHierarchy.add.title")}</CardTitle>
        <CardDescription className="max-w-3xl text-base">{t("lhuHierarchy.add.description")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-8">
        <TypeGroup label={t("lhuHierarchy.add.premise")} types={PREMISE_TYPES} selected={selected} onSelect={onSelect} />
        <TypeGroup label={t("lhuHierarchy.add.resource")} types={RESOURCE_TYPES} selected={selected} onSelect={onSelect} />
      </CardContent>
    </Card>
  )
}
