import { useTranslation } from "react-i18next"
import { StatCard } from "./StatCard"

// FIXME: This mock data is provisional and should be replaced with real data from the backend once the API is available.
const MOCK_STATS = [
  { key: "levels", value: 8 },
  { key: "spaces", value: 8 },
  { key: "resourceGroups", value: 3 },
  { key: "operationalItems", value: 11 },
] as const

export function StatsCards() {
  const { t } = useTranslation()

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {MOCK_STATS.map((stat) => (
        <StatCard key={stat.key} title={t(`lhuHierarchy.stats.${stat.key}`)} value={stat.value} />
      ))}
    </div>
  )
}
