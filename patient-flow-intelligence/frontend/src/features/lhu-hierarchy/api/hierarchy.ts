import type { OrgNode } from "../types/tree"
import { mockLHUNodes } from "./mock-data"

export async function fetchLHUHierarchy(): Promise<OrgNode[]> {
  await new Promise((resolve) => setTimeout(resolve, 800))
  return mockLHUNodes
}
