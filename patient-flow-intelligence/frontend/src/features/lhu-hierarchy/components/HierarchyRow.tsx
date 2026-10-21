import { useTranslation } from "react-i18next"
import { Badge } from "@/components/Badge"
import { TableCell, TableRow } from "@/components/Table"
import type { FlatRow } from "../types/tree"
import { HierarchyNodeIcon } from "./HierarchyNodeIcon"

export function HierarchyRow({ row: { node, depth } }: { row: FlatRow }) {
  const { t } = useTranslation()

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
          {t(`lhuHierarchy.types.${node.type}`)}
        </Badge>
      </TableCell>

      <TableCell>
        <span className="text-xs text-gray-500">
          {node.parentId ?? t("lhuHierarchy.root")}
        </span>
      </TableCell>

      <TableCell>
        <span className="text-xs text-green-800">{node.status}</span>
      </TableCell>
    </TableRow>
  )
}
