import { useTranslation } from "react-i18next"
import { Button } from "@/components/Button"
import { cn } from "@/lib/utils"
import type { OrgType } from "../types/tree"
import { HierarchyNodeIcon } from "./HierarchyNodeIcon"

interface TypeCardProps {
  type: OrgType
  selected: boolean
  onSelect: (type: OrgType) => void
}

export function TypeCard({ type, selected, onSelect }: TypeCardProps) {
  const { t } = useTranslation()

  return (
    <Button
      type="button"
      variant="ghost"
      aria-pressed={selected}
      onClick={() => onSelect(type)}
      className={cn(
        "h-auto w-full min-w-0 shrink cursor-pointer flex items-start justify-start gap-4 whitespace-normal rounded-lg border border-gray-200 bg-white p-5 text-left transition-colors hover:bg-[#EFF6FF] hover:border-[#2563EB]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40",
        selected && "hierarchy-type-card-selected border-[#2563EB] ring-1 ring-[#2563EB] bg-[#EFF6FF]",
      )}
    >
      <HierarchyNodeIcon
        type={type}
        className="shrink-0 p-4 text-[#2563EB]"
        iconClassName="h-5 w-5"
      />
      <span className="min-w-0 break-words text-base font-semibold text-gray-900">
        {t(`lhuHierarchy.types.${type}`)}
      </span>
    </Button>
  )
}
