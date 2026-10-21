import { Badge } from "@/components/Badge"
import { TableCell, TableRow } from "@/components/Table"
import type { FlatRow, OrgNode } from "../types/tree"
import { HierarchyNodeIcon } from "./HierarchyNodeIcon"

const NODE_LABELS: Record<OrgNode["type"], string> = {
  lhu: "LHU",
  unit: "Unit",
  building: "Building",
  floor: "Floor",
  ward: "Ward",
  nursery: "Nursery",
  room: "Room",
  bed: "Bed",
  "operating-room": "Operating room",
  "treatment-chair": "Treatment chair",
}

export function HierarchyRow({ row: { node, depth } }: { row: FlatRow }) {
  return (
    <TableRow className="bg-white">
      <TableCell
        style={{ paddingLeft: 16 + depth * 18 }}
        className="flex items-center justify-centerpx-3 py-3 space-x-0.5"
      >
        <HierarchyNodeIcon type={node.type} />
        <span className="text-xs font-medium">{node.name}</span>
      </TableCell>

      <TableCell>
        <Badge variant="secondary" className="text-xs">
          {NODE_LABELS[node.type]}
        </Badge>
      </TableCell>

      <TableCell>
        <span className="text-xs text-gray-500">
          {node.parentId ?? "Organization root"}
        </span>
      </TableCell>

      <TableCell>
        <span className="text-xs text-green-800">{node.status}</span>
      </TableCell>
    </TableRow>
  )
}
