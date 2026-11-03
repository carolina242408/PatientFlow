import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createHierarchyNode, fetchLHUHierarchy } from "../api/hierarchy"
import type { OrgType } from "../types/tree"

export const LHU_HIERARCHY_KEY = ["lhu-hierarchy"] as const

export function useLHUHierarchy() {
  return useQuery({ queryKey: LHU_HIERARCHY_KEY, queryFn: fetchLHUHierarchy })
}

export function useCreateHierarchyNode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      type,
      input,
    }: {
      type: OrgType
      input: { name?: string; code?: string; parentId?: string; serviceId?: string }
    }) => createHierarchyNode(type, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: LHU_HIERARCHY_KEY }),
  })
}
