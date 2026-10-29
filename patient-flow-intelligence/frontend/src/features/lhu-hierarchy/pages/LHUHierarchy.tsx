import { TabsContent } from "@/components/Tabs"
import { AddResourceStep } from "../components/AddResourceStep"
import { ModeTabs } from "../components/ModeTabs"
import { StructureOverview } from "../components/StructureOverview"

export function LHUHierarchyPage() {
  return (
    <ModeTabs>
      <TabsContent value="structure" className="space-y-5">
        <StructureOverview />
      </TabsContent>

      <TabsContent value="add">
        <AddResourceStep />
      </TabsContent>
    </ModeTabs>
  )
}
