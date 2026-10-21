import { mockLHUNodes } from "../api/mock-data"
import { HierarchyTable } from "../components/HierarchyTable"
import { StatsCards } from "../components/StatsCards"

export function LHUHierarchyPage() {
  return (
    <div className="space-y-5">
      <StatsCards />

      <HierarchyTable tree={mockLHUNodes} />
    </div>
  )
}
