import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { Tabs, TabsList, TabsTrigger } from "@/components/Tabs"

export type HierarchyMode = "structure" | "add"

interface ModeTabsProps {
  value: HierarchyMode
  onValueChange: (value: HierarchyMode) => void
  children: ReactNode
}

const triggerClass =
  "-mb-px flex-none rounded-none border-0 border-b-2 border-transparent px-1 pb-3 pt-1 text-sm font-medium text-gray-500 shadow-none hover:text-gray-700 focus-visible:ring-0 data-[state=active]:border-[#2563EB] data-[state=active]:bg-transparent data-[state=active]:text-[#2563EB] data-[state=active]:shadow-none"

export function ModeTabs({
  value,
  onValueChange,
  children,
}: ModeTabsProps) {
  const { t } = useTranslation()

  return (
    <Tabs
      value={value}
      onValueChange={(nextValue) => {
        if (nextValue === "structure" || nextValue === "add") onValueChange(nextValue)
      }}
      className="gap-4"
    >
      <TabsList className="h-auto w-full justify-start gap-8 rounded-none border-b border-gray-200 bg-transparent p-0">
        <TabsTrigger value="structure" className={triggerClass}>
          {t("lhuHierarchy.modes.structure")}
        </TabsTrigger>

        <TabsTrigger value="add" className={triggerClass}>
          {t("lhuHierarchy.modes.add")}
        </TabsTrigger>
      </TabsList>

      {children}
    </Tabs>
  )
}
