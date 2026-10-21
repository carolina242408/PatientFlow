import { useMemo } from "react"
import { useTranslation } from "react-i18next"
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
  const { t } = useTranslation()
  const rows = useMemo(() => flattenTree(tree), [tree])

  return (
    <div className="bg-white rounded-lg border border-gray-200 space-y-4 overflow-hidden">
      <div className="px-4 pt-4">
        <h3 className="text-lg font-bold">{t("lhuHierarchy.title")}</h3>
        <p className="text-gray-500 text-xs">{t("lhuHierarchy.description")}</p>
      </div>

      <Table>
        <TableHeader className="bg-[#F9FAFB]">
          <TableRow>
            <TableHead className="pl-4">{t("lhuHierarchy.columns.name")}</TableHead>
            <TableHead>{t("lhuHierarchy.columns.type")}</TableHead>
            <TableHead>{t("lhuHierarchy.columns.parent")}</TableHead>
            <TableHead>{t("lhuHierarchy.columns.status")}</TableHead>
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
