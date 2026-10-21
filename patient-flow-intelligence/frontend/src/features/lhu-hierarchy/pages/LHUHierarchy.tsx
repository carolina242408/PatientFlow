import { mockLHUNodes } from "../api/mock-data"
import { HierarchyTable } from "../components/HierarchyTable"

export function LHUHierarchyPage() {
  return (
    <div>
      <HierarchyTable tree={mockLHUNodes} />
    </div>
  )
}
