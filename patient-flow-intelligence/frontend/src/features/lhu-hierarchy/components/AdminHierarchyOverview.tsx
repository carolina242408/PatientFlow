import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { Button } from "@/components/Button"
import {
  fetchHierarchyChildren,
  hierarchyChildrenQueryKey,
} from "../api/hierarchy"
import type { OrgNode, OrgType } from "../types/tree"
import { PARENT_TYPE } from "../utils/org-types"
import type { Open, SpaceNode } from "@/pages/space/types"

const CREATABLE_TYPES: OrgType[] = [
  "unit",
  "building",
  "floor",
  "service",
  "wing",
  "ward",
  "room",
  "bed",
]

interface AdminHierarchyOverviewProps {
  node: SpaceNode
  path: SpaceNode[]
  loadingChildren: boolean
  onOpen: Open
  onAddChild?: (parentPath: SpaceNode[], types: OrgType[]) => void
}

export function AdminHierarchyOverview({
  node,
  path,
  loadingChildren,
  onOpen,
  onAddChild,
}: AdminHierarchyOverviewProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const isLeaf = node.level === "bed" || node.children?.length === 0
  const children = node.children ?? []

  const addableTypes = (parent: SpaceNode) =>
    CREATABLE_TYPES.filter((type) => PARENT_TYPE[type] === parent.level)

  const getAddTarget = () => {
    let parentPath = path
    let types = addableTypes(node)

    if (types.length === 0 && path.length > 1) {
      parentPath = path.slice(0, -1)
      const parent = parentPath[parentPath.length - 1]
      types = addableTypes(parent)
    }

    return { parentPath, types }
  }

  const addTarget = getAddTarget()
  const addLocation = () => onAddChild?.(addTarget.parentPath, addTarget.types)
  const prefetchChildren = (child: SpaceNode) => {
    if (child.level === "bed") return
    const orgNode: OrgNode = {
      id: child.id,
      name: child.name,
      type: child.level,
      parentId: node.id,
      status: "operational",
    }
    void queryClient.prefetchQuery({
      queryKey: hierarchyChildrenQueryKey(orgNode),
      queryFn: () => fetchHierarchyChildren(orgNode),
      staleTime: 30_000,
    })
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
      <header className="border-b border-gray-200 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-blue-600">
              {t(`lhuHierarchy.types.${node.level}`)}
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-slate-900">{node.name}</h2>
          </div>
          {node.level !== "bed" && onAddChild && addTarget.types.length > 0 && (
            <Button type="button" onClick={addLocation} className="shrink-0">
              {t("lhuHierarchy.admin.addHere")}
            </Button>
          )}
        </div>
      </header>

      {children.length > 0 && (
        <ul className="grid gap-4 p-6 sm:grid-cols-2 xl:grid-cols-3">
          {children.map((child) => {
            const content = (
              <span>
                <span className="block text-xs font-medium text-blue-600">
                  {t(`lhuHierarchy.types.${child.level}`)}
                </span>
                <span className="mt-1 block text-base font-semibold text-slate-900">
                  {child.name}
                </span>
              </span>
            )

            return (
              <li key={child.id}>
                {child.level === "bed" ? (
                  <div className="flex w-full rounded-xl border border-gray-200 bg-white p-4 text-left">
                    {content}
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => onOpen(child)}
                    onPointerEnter={() => prefetchChildren(child)}
                    onFocus={() => prefetchChildren(child)}
                    className="h-auto w-full justify-between rounded-xl p-4 text-left"
                  >
                    {content}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {isLeaf && !loadingChildren && (
        <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              {t("lhuHierarchy.admin.endOfBranch")}
            </h3>
            <p className="mt-2 max-w-xl text-sm text-gray-500">
              {t("lhuHierarchy.admin.endOfBranchDescription")}
            </p>
          </div>
        </div>
      )}
    </section>
  )
}
