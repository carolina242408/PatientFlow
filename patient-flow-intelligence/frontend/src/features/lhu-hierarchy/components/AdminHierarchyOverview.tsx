import { useState, type FormEvent } from "react"
import { useTranslation } from "react-i18next"
import { useQueryClient } from "@tanstack/react-query"
import { BedDouble, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/Button"
import { ConfirmationDialog } from "@/components/ConfirmationDialog"
import { Input } from "@/components/Input"
import { OperationPopup } from "@/components/OperationPopup"
import {
  fetchHierarchyChildren,
  hierarchyChildrenQueryKey,
} from "../api/hierarchy"
import { useDeleteHierarchyNode, useUpdateHierarchyNode } from "../hooks/useLHUHierarchy"
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
  onBack?: () => void
  onAddChild?: (parentPath: SpaceNode[], types: OrgType[]) => void
  onRename?: (name: string) => void
  onDelete?: () => void
}

export function AdminHierarchyOverview({
  node,
  path,
  loadingChildren,
  onOpen,
  onBack,
  onAddChild,
  onRename,
  onDelete,
}: AdminHierarchyOverviewProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const updateNode = useUpdateHierarchyNode()
  const deleteNode = useDeleteHierarchyNode()
  const [isEditing, setIsEditing] = useState(false)
  const [editedName, setEditedName] = useState(node.name)
  const [operationMessage, setOperationMessage] = useState("")
  const [operationFailed, setOperationFailed] = useState(false)
  const [updatePopup, setUpdatePopup] = useState<{
    type: "success" | "error"
    key: number
  } | null>(null)
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false)
  const isLeaf = node.level === "bed" || node.children?.length === 0
  const children = node.children ?? []
  const supportsRename = node.level !== "room" && node.level !== "bed"
  const canDelete =
    node.level === "bed" ||
    (!loadingChildren && node.children !== undefined && children.length === 0)

  const showUpdatePopup = (type: "success" | "error") => {
    setUpdatePopup((current) => ({ type, key: (current?.key ?? 0) + 1 }))
  }

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
  const beginUpdateLocation = () => {
    setEditedName(node.name)
    setOperationMessage("")
    setIsEditing(true)
  }
  const updateLocation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = editedName.trim()
    if (!name || name === node.name) {
      setIsEditing(false)
      return
    }

    try {
      await updateNode.mutateAsync({ type: node.level, id: node.id, name })
      setIsEditing(false)
      setOperationFailed(false)
      showUpdatePopup("success")
      onRename?.(name)
    } catch (error) {
      console.error("Unable to update hierarchy location", error)
      showUpdatePopup("error")
    }
  }
  const deleteLocation = async () => {
    if (!canDelete) return
    try {
      await deleteNode.mutateAsync({ type: node.level, id: node.id })
      setOperationFailed(false)
      setOperationMessage(t("lhuHierarchy.admin.deleteSuccess"))
      onDelete?.()
    } catch (error) {
      console.error("Unable to delete hierarchy location", error)
      setOperationFailed(true)
      setOperationMessage(t("lhuHierarchy.admin.deleteError"))
    }
  }
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
            {isEditing ? (
              <form
                onSubmit={(event) => void updateLocation(event)}
                className="mt-2 flex flex-wrap items-center gap-2"
              >
                <Input
                  aria-label={t("lhuHierarchy.admin.locationName")}
                  value={editedName}
                  onChange={(event) => setEditedName(event.target.value)}
                  maxLength={255}
                  required
                  autoFocus
                  className="h-11 w-full max-w-xl text-xl font-semibold"
                />
                <Button type="submit" disabled={updateNode.isPending || !editedName.trim()}>
                  {t("lhuHierarchy.admin.save")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsEditing(false)}
                  disabled={updateNode.isPending}
                >
                  {t("lhuHierarchy.admin.cancel")}
                </Button>
              </form>
            ) : (
              <div className="mt-2 flex items-center gap-2">
                <h2 className="text-2xl font-semibold text-slate-900">{node.name}</h2>
                {supportsRename && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={beginUpdateLocation}
                    disabled={updateNode.isPending}
                    aria-label={t("lhuHierarchy.admin.updateSpace")}
                    title={t("lhuHierarchy.admin.updateSpace")}
                    className="h-8 w-8 p-1 text-slate-500 hover:text-slate-900"
                  >
                    <Pencil aria-hidden="true" className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
        {operationMessage && (
          <p
            role={operationFailed ? "alert" : "status"}
            className={`mt-4 text-sm ${operationFailed ? "text-red-600" : "text-green-700"}`}
          >
            {operationMessage}
          </p>
        )}
        {updatePopup && (
          <OperationPopup
            key={updatePopup.key}
            type={updatePopup.type}
            title={t(`lhuHierarchy.admin.updatePopup.${updatePopup.type}.title`)}
            description={t(`lhuHierarchy.admin.updatePopup.${updatePopup.type}.description`)}
          />
        )}
        <ConfirmationDialog
          open={deleteConfirmationOpen}
          title={
            canDelete
              ? t("lhuHierarchy.admin.deleteConfirmation.title")
              : t("lhuHierarchy.admin.deleteUnavailableTitle")
          }
          description={
            canDelete
              ? t("lhuHierarchy.admin.deleteConfirmation.description", { name: node.name })
              : t("lhuHierarchy.admin.deleteUnavailable")
          }
          icon={<Trash2 aria-hidden="true" className="h-9 w-9" />}
          cancelLabel={t("lhuHierarchy.admin.cancel")}
          confirmLabel={canDelete ? t("lhuHierarchy.admin.confirmDeleteButton") : undefined}
          onClose={() => setDeleteConfirmationOpen(false)}
          onConfirm={() => void deleteLocation()}
        />
      </header>

      {children.length > 0 && (
        <>
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
          {onAddChild && addTarget.types.length > 0 && (
            <div className="flex justify-center px-6 pb-6">
              <Button
                type="button"
                onClick={addLocation}
                className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-normal hover:bg-blue-700"
              >
                {t("lhuHierarchy.admin.addChildItem")}
              </Button>
            </div>
          )}
        </>
      )}

      {isLeaf && !loadingChildren && (
        <div className="flex flex-col items-center gap-4 px-6 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 text-blue-600">
            <BedDouble aria-hidden="true" className="h-6 w-6" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">
              {t("lhuHierarchy.admin.endOfBranch")}
            </h3>
            <p className="mt-2 max-w-xl text-sm text-gray-500">
              {t("lhuHierarchy.admin.endOfBranchDescription")}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            {path.length > 1 && onBack && (
              <Button
                type="button"
                variant="outline"
                onClick={onBack}
                className="h-10 border-gray-200 px-4 text-sm font-normal text-gray-600"
              >
                {t("lhuHierarchy.admin.backOneLevel")}
              </Button>
            )}
            {node.level !== "bed" && onAddChild && addTarget.types.length > 0 && (
              <Button
                type="button"
                onClick={addLocation}
                className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-normal hover:bg-blue-700"
              >
                {t("lhuHierarchy.admin.addChildItem")}
              </Button>
            )}
            {canDelete && (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setOperationMessage("")
                  setDeleteConfirmationOpen(true)
                }}
                disabled={deleteNode.isPending}
                className="h-10 rounded-lg border-red-200 px-4 text-sm font-normal text-red-600 hover:bg-red-50 hover:text-red-700"
              >
                {t("lhuHierarchy.admin.deleteSpace")}
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
