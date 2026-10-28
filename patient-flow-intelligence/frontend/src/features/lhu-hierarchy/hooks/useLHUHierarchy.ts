import { useQuery } from "@tanstack/react-query"
import { fetchLHUHierarchy } from "../api/hierarchy"

export const LHU_HIERARCHY_KEY = ["lhu-hierarchy"] as const

export function useLHUHierarchy() {
  return useQuery({ queryKey: LHU_HIERARCHY_KEY, queryFn: fetchLHUHierarchy })
}
