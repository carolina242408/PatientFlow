import { useTranslation } from "react-i18next"
import { Skeleton } from "@/components/Skeleton"
import type { HierarchyStats } from "../types/tree"
import { StatCard } from "./StatCard"

const STAT_KEYS: (keyof HierarchyStats)[] = ["levels", "spaces", "resourceGroups", "operationalItems"]
const gridClass = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"

export function StatsCards({ stats }: { stats: HierarchyStats }) {
  const { t } = useTranslation()

  return (
    <div className={gridClass}>
      {STAT_KEYS.map((key) => (
        <StatCard key={key} title={t(`lhuHierarchy.stats.${key}`)} value={stats[key]} />
      ))}
    </div>
  )
}

export function StatsCardsSkeleton() {
  return (
    <div className={gridClass}>
      {STAT_KEYS.map((key) => (
        <div key={key} className="p-4 rounded-lg border border-gray-200 bg-white">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-3 h-7 w-12" />
        </div>
      ))}
    </div>
  )
}
