import { TabsContent } from "@/components/Tabs"
import { mockLHUNodes } from "../api/mock-data"
import { AddResourceStep } from "../components/AddResourceStep"
import { HierarchyTable } from "../components/HierarchyTable"
import { ModeTabs } from "../components/ModeTabs"
import { StatsCards } from "../components/StatsCards"

export function LHUHierarchyPage() {
  return (
    <ModeTabs>
      <TabsContent value="structure" className="space-y-5">
        <StatsCards />
        <HierarchyTable tree={mockLHUNodes} />
      </TabsContent>

      <TabsContent value="add">
        <AddResourceStep />
      </TabsContent>
    </ModeTabs>
  )
}
