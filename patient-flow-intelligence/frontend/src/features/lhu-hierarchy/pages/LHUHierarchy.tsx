import { useState } from "react"
import SpaceExplorer from "@/pages/space/SpaceExplorer"
import type { SpaceNode } from "@/pages/space/types"
import { TabsContent } from "@/components/Tabs"
import { AddResourceStep } from "../components/AddResourceStep"
import { ModeTabs, type HierarchyMode } from "../components/ModeTabs"
import type { OrgType } from "../types/tree"

interface AddContext {
  types: OrgType[]
  parentIds: Partial<Record<OrgType, string>>
}

export function LHUHierarchyPage() {
  const [mode, setMode] = useState<HierarchyMode>("structure")
  const [addContext, setAddContext] = useState<AddContext | null>(null)

  const openAddForm = (parentPath: SpaceNode[], types: OrgType[]) => {
    const parentIds = parentPath.reduce<Partial<Record<OrgType, string>>>(
      (ids, node) => {
        ids[node.level] = node.id
        return ids
      },
      {},
    )
    setAddContext({ types, parentIds })
    setMode("add")
  }

  return (
    <ModeTabs
      value={mode}
      onValueChange={(nextMode) => {
        if (nextMode === "add") setAddContext(null)
        setMode(nextMode)
      }}
    >
      <TabsContent value="structure" className="space-y-5">
        <SpaceExplorer
          startLevel="lhu"
          initialLevel="lhu"
          adminMode
          onAddChild={openAddForm}
        />
      </TabsContent>

      <TabsContent value="add">
        <AddResourceStep
          key={addContext ? addContext.types.join("-") + Object.values(addContext.parentIds).join("-") : "manual"}
          initialType={addContext?.types.length === 1 ? addContext.types[0] : null}
          initialParents={addContext?.parentIds}
        />
      </TabsContent>
    </ModeTabs>
  )
}
