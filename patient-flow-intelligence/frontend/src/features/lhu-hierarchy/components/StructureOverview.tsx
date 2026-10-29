import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useLHUHierarchy } from "../hooks/useLHUHierarchy"
import { getHierarchyStats } from "../utils/tree"
import { HierarchyTable } from "./HierarchyTable"
import { StatsCards, StatsCardsSkeleton } from "./StatsCards"

export function StructureOverview() {
  const { t } = useTranslation()
  const { data, isPending, isError } = useLHUHierarchy()
  const stats = useMemo(() => (data ? getHierarchyStats(data) : null), [data])

  if (isError) {
    return <p className="text-sm text-danger">{t("lhuHierarchy.error")}</p>
  }

  if (isPending || !stats) {
    return (
      <>
        <StatsCardsSkeleton />
        <HierarchyTable tree={[]} loading />
      </>
    )
  }

  return (
    <>
      <StatsCards stats={stats} />
      <HierarchyTable tree={data} />
    </>
  )
}
