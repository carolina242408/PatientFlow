import * as XLSX from "xlsx"
import { z } from "zod"
import type { HierarchyImportRow } from "../api/hierarchy"
import type { OrgNode, OrgType } from "../types/tree"

export const EXPORT_COLUMNS = [
  "uls",
  "unit",
  "building",
  "floor",
  "service",
  "serviceCode",
  "wing",
  "ward",
  "wardCode",
  "room",
  "bed",
] as const

const LEVEL_SEQUENCE: OrgType[] = [
  "lhu",
  "unit",
  "building",
  "floor",
  "service",
  "wing",
  "ward",
  "room",
  "bed",
]

const importRowSchema = z
  .object({
    uls: z.string().trim().min(1),
    unit: z.string().trim().optional(),
    building: z.string().trim().optional(),
    floor: z.string().trim().optional(),
    service: z.string().trim().optional(),
    serviceCode: z.string().trim().optional(),
    wing: z.string().trim().optional(),
    ward: z.string().trim().optional(),
    wardCode: z.string().trim().optional(),
    room: z.string().trim().optional(),
    bed: z.string().trim().optional(),
  })
  .superRefine((row, ctx) => {
    const values = [
      row.uls,
      row.unit,
      row.building,
      row.floor,
      row.service,
      row.wing,
      row.ward,
      row.room,
      row.bed,
    ]
    let sawGap = false
    for (let i = 0; i < values.length; i++) {
      const hasVal = Boolean(values[i] && values[i]!.length > 0)
      if (!hasVal) {
        sawGap = true
      } else if (sawGap) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing parent level before "${LEVEL_SEQUENCE[i]}"`,
        })
        break
      }
    }
  })

const HEADER_ALIASES: Record<string, keyof HierarchyImportRow> = {
  uls: "uls",
  lhu: "uls",
  unit: "unit",
  unidade: "unit",
  building: "building",
  edificio: "building",
  floor: "floor",
  piso: "floor",
  service: "service",
  servico: "service",
  servicecode: "serviceCode",
  service_code: "serviceCode",
  codigoservico: "serviceCode",
  wing: "wing",
  ala: "wing",
  ward: "ward",
  enfermaria: "ward",
  wardcode: "wardCode",
  ward_code: "wardCode",
  codigoenfermaria: "wardCode",
  room: "room",
  quarto: "room",
  bed: "bed",
  cama: "bed",
}

function normalizeHeader(header: string): keyof HierarchyImportRow | undefined {
  const key = header
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]/g, "")
  return HEADER_ALIASES[key]
}

export interface ParsedHierarchyFile {
  rows: HierarchyImportRow[]
  errors: Array<{ row: number; message: string }>
}

export async function parseHierarchyFile(file: File): Promise<ParsedHierarchyFile> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: "array" })
  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) {
    return { rows: [], errors: [{ row: 1, message: "Empty file" }] }
  }

  const sheet = workbook.Sheets[firstSheetName]
  const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
  })

  const rows: HierarchyImportRow[] = []
  const errors: Array<{ row: number; message: string }> = []

  rawRows.forEach((raw: Record<string, unknown>, index: number) => {
    const mapped: Record<string, string> = {}
    for (const [col, val] of Object.entries(raw)) {
      const target = normalizeHeader(col)
      if (!target) continue
      const strVal = val == null ? "" : String(val).trim()
      if (strVal !== "") mapped[target] = strVal
    }

    // Skip completely blank lines
    if (Object.keys(mapped).length === 0) return

    const parsed = importRowSchema.safeParse(mapped)
    if (!parsed.success) {
      errors.push({
        row: index + 2, // +1 for 1-based, +1 for header row
        message: parsed.error.issues[0]?.message ?? "Invalid row",
      })
      return
    }
    rows.push(parsed.data)
  })

  return { rows, errors }
}

type ExportRow = Record<(typeof EXPORT_COLUMNS)[number], string>

function emptyExportRow(): ExportRow {
  return {
    uls: "",
    unit: "",
    building: "",
    floor: "",
    service: "",
    serviceCode: "",
    wing: "",
    ward: "",
    wardCode: "",
    room: "",
    bed: "",
  }
}

export function flattenHierarchyForExport(roots: OrgNode[]): ExportRow[] {
  const rows: ExportRow[] = []

  const visit = (node: OrgNode, current: ExportRow) => {
    const next: ExportRow = { ...current }
    switch (node.type) {
      case "lhu":
        next.uls = node.name
        break
      case "unit":
        next.unit = node.name
        break
      case "building":
        next.building = node.name
        break
      case "floor":
        next.floor = node.name
        break
      case "service":
        next.service = node.name
        next.serviceCode = node.code ?? ""
        break
      case "wing":
        next.wing = node.name
        break
      case "ward":
        next.ward = node.name
        next.wardCode = node.code ?? ""
        break
      case "room":
        next.room = node.code ?? node.name
        break
      case "bed":
        next.bed = node.code ?? node.name
        break
    }

    if (!node.children || node.children.length === 0) {
      rows.push(next)
      return
    }
    for (const child of node.children) {
      visit(child, next)
    }
  }

  for (const root of roots) {
    visit(root, emptyExportRow())
  }
  return rows
}

export function exportHierarchyFile(roots: OrgNode[], format: "xlsx" | "csv") {
  const data = flattenHierarchyForExport(roots)
  const worksheet = XLSX.utils.json_to_sheet(data, {
    header: [...EXPORT_COLUMNS],
  })

  if (format === "xlsx") {
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, worksheet, "Hierarchy")
    XLSX.writeFile(workbook, "hierarchy.xlsx")
    return
  }

  const csvContent = XLSX.utils.sheet_to_csv(worksheet)
  const blob = new Blob(["\uFEFF" + csvContent], {
    type: "text/csv;charset=utf-8;",
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = "hierarchy.csv"
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
