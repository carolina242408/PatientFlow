import { useMemo } from "react"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/Table"
import type { OrgNode } from "../types/tree"
import { flattenTree } from "../utils/tree"
import { HierarchyRow } from "./HierarchyRow"

export function HierarchyTable({ tree }: { tree: OrgNode[] }) {
  const rows = useMemo(() => flattenTree(tree), [tree])

  return (
    <div className="bg-white rounded-lg border border-gray-200 space-y-4 overflow-hidden">
      <div className="px-4 pt-4">
        <h3 className="text-lg font-bold">Organization hierarchy</h3>
        <p className="text-gray-500 text-xs">
          Spaces and resources ordered by their organizational parent
        </p>
      </div>

      <Table>
        <TableHeader className="bg-[#F9FAFB]">
          <TableRow>
            <TableHead className="pl-4">Space or resource</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Parent</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <HierarchyRow key={row.node.id} row={row} />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
