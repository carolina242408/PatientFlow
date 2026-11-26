import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  createHierarchyNode,
  deleteHierarchyNode,
  fetchCompleteLHUHierarchy,
  importHierarchy,
  updateHierarchyNode,
  type HierarchyImportRow,
} from "../api/hierarchy"
import type { OrgType } from "../types/tree"

export const LHU_HIERARCHY_KEY = ["lhu-hierarchy"] as const

async function invalidateHierarchyQueries(queryClient: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: LHU_HIERARCHY_KEY }),
    queryClient.invalidateQueries({ queryKey: ["space-hierarchy"] }),
    queryClient.invalidateQueries({ queryKey: ["space-hierarchy-children"] }),
  ])
}

export function useLHUHierarchy() {
  return useQuery({
    queryKey: LHU_HIERARCHY_KEY,
    queryFn: fetchCompleteLHUHierarchy,
  })
}

export function useCreateHierarchyNode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      type,
      input,
    }: {
      type: OrgType
      input: {
        name?: string
        code?: string
        parentId?: string
        serviceId?: string
      }
    }) => createHierarchyNode(type, input),
    onSuccess: () => invalidateHierarchyQueries(queryClient),
  })
}

export function useUpdateHierarchyNode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ type, id, name }: { type: OrgType; id: string; name: string }) =>
      updateHierarchyNode(type, id, { name }),
    onSuccess: () => invalidateHierarchyQueries(queryClient),
  })
}

export function useDeleteHierarchyNode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ type, id }: { type: OrgType; id: string }) =>
      deleteHierarchyNode(type, id),
    onSuccess: () => invalidateHierarchyQueries(queryClient),
  })
}

export function useImportHierarchy() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (rows: HierarchyImportRow[]) => importHierarchy(rows),
    onSuccess: () => invalidateHierarchyQueries(queryClient),
  })
}
