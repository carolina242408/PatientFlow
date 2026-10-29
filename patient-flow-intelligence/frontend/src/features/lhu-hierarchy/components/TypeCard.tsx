import { useTranslation } from "react-i18next"
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
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(type)}
      className={cn(
        "cursor-pointer flex items-start gap-4 rounded-lg border border-gray-200 bg-white p-5 text-left transition-colors hover:bg-[#EFF6FF] hover:border-[#2563EB]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2563EB]/40",
        selected && "border-[#2563EB] ring-1 ring-[#2563EB] bg-[#EFF6FF]",
      )}
    >
      <HierarchyNodeIcon
        type={type}
        className="shrink-0 p-4 text-[#2563EB]"
        iconClassName="h-5 w-5"
      />
      <span className="flex flex-col gap-1">
        <span className="text-base font-semibold text-gray-900">
          {t(`lhuHierarchy.types.${type}`)}
        </span>
        <span className="text-sm text-gray-500">
          {t(`lhuHierarchy.typeDescriptions.${type}`)}
        </span>
      </span>
    </button>
  )
}
