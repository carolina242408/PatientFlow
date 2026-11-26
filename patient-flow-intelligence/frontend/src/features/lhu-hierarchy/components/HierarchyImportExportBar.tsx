import { useEffect, useRef, useState, type ChangeEvent } from "react"
import { useTranslation } from "react-i18next"
import { useQuery } from "@tanstack/react-query"
import { AlertTriangle, ChevronDown, Download, FileSpreadsheet, Upload, X } from "lucide-react"
import { Button } from "@/components/Button"
import { ConfirmationDialog } from "@/components/ConfirmationDialog"
import { OperationPopup } from "@/components/OperationPopup"
import { fetchAllLHUHierarchyTree, fetchHierarchyLevel } from "../api/hierarchy"
import { useImportHierarchy } from "../hooks/useLHUHierarchy"
import {
  exportHierarchyFile,
  parseHierarchyFile,
  type ParsedHierarchyFile,
} from "../utils/hierarchy-spreadsheet"

export function HierarchyImportExportBar() {
  const { t } = useTranslation()
  const importMutation = useImportHierarchy()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const exportMenuRef = useRef<HTMLDivElement | null>(null)

  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [exporting, setExporting] = useState<"csv" | "xlsx" | null>(null)
  const [warningOpen, setWarningOpen] = useState(false)

  const { data: rootNodes, refetch: refetchRootNodes } = useQuery({
    queryKey: ["space-hierarchy", "lhu", undefined],
    queryFn: () => fetchHierarchyLevel("lhu"),
    staleTime: 30_000,
  })

  useEffect(() => {
    if (!exportMenuOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setExportMenuOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExportMenuOpen(false)
    }
    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [exportMenuOpen])
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedFileName, setSelectedFileName] = useState("")
  const [parsed, setParsed] = useState<ParsedHierarchyFile | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [popup, setPopup] = useState<{
    type: "success" | "error"
    title: string
    description: string
    key: number
  } | null>(null)

  const showPopup = (type: "success" | "error", title: string, description: string) => {
    setPopup((prev) => ({ type, title, description, key: (prev?.key ?? 0) + 1 }))
  }

  const handleExport = async (format: "csv" | "xlsx") => {
    setExportMenuOpen(false)
    setExporting(format)
    try {
      const tree = await fetchAllLHUHierarchyTree()
      exportHierarchyFile(tree, format)
    } catch (error) {
      console.error("Failed to export hierarchy", error)
      showPopup(
        "error",
        t("lhuHierarchy.importExport.exportErrorTitle"),
        t("lhuHierarchy.importExport.exportErrorDescription"),
      )
    } finally {
      setExporting(null)
    }
  }

  const handleOpenImport = async () => {
    let nodes = rootNodes
    if (nodes === undefined) {
      const result = await refetchRootNodes()
      nodes = result.data
    }
    if ((nodes?.length ?? 0) > 0) {
      setWarningOpen(true)
      return
    }
    setModalOpen(true)
  }

  const resetModal = () => {
    setModalOpen(false)
    setSelectedFileName("")
    setParsed(null)
    setSubmitError(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    setSubmitError(null)
    if (!file) {
      setSelectedFileName("")
      setParsed(null)
      return
    }
    setSelectedFileName(file.name)
    try {
      const result = await parseHierarchyFile(file)
      setParsed(result)
    } catch (error) {
      console.error("Failed to parse hierarchy file", error)
      setParsed({ rows: [], errors: [{ row: 1, message: t("lhuHierarchy.importExport.parseError") }] })
    }
  }

  const handleConfirmImport = async () => {
    if (!parsed || parsed.rows.length === 0 || parsed.errors.length > 0) return
    setSubmitError(null)
    try {
      const result = await importMutation.mutateAsync(parsed.rows)
      resetModal()
      showPopup(
        "success",
        t("lhuHierarchy.importExport.importSuccessTitle"),
        t("lhuHierarchy.importExport.importSuccessDescription", {
          created: result.createdCount,
          reused: result.reusedCount,
        }),
      )
    } catch (error: unknown) {
      const apiMessage =
        (error as { response?: { data?: { message?: string; detail?: string } } })?.response?.data
          ?.message ??
        (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        t("lhuHierarchy.importExport.importErrorDescription")
      setSubmitError(apiMessage)
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 pb-2">
        <div ref={exportMenuRef} className="relative">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={exporting !== null}
            aria-haspopup="menu"
            aria-expanded={exportMenuOpen}
            onClick={() => setExportMenuOpen((open) => !open)}
            className="gap-1.5"
          >
            <Download className="h-4 w-4" />
            {exporting !== null
              ? t("lhuHierarchy.importExport.exporting")
              : t("lhuHierarchy.importExport.exportButton")}
            <ChevronDown className="h-3.5 w-3.5 opacity-70" />
          </Button>

          {exportMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 z-20 mt-1.5 w-44 rounded-xl border border-gray-200 bg-white p-1 shadow-lg"
            >
              <button
                type="button"
                role="menuitem"
                onClick={() => handleExport("csv")}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-gray-100"
              >
                <Download className="h-4 w-4 text-gray-500" />
                {t("lhuHierarchy.importExport.exportCsv")}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => handleExport("xlsx")}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-slate-700 hover:bg-gray-100"
              >
                <FileSpreadsheet className="h-4 w-4 text-gray-500" />
                {t("lhuHierarchy.importExport.exportXlsx")}
              </button>
            </div>
          )}
        </div>

        <Button
          type="button"
          size="sm"
          onClick={() => void handleOpenImport()}
          className="gap-1.5 bg-[#2563EB] text-white hover:bg-[#1d4ed8]"
        >
          <Upload className="h-4 w-4" />
          {t("lhuHierarchy.importExport.importButton")}
        </Button>
      </div>

      <ConfirmationDialog
        open={warningOpen}
        title={t("lhuHierarchy.importExport.existingHierarchyTitle")}
        description={t("lhuHierarchy.importExport.existingHierarchyDescription")}
        icon={<AlertTriangle aria-hidden="true" className="h-9 w-9" />}
        cancelLabel={t("lhuHierarchy.admin.cancel")}
        confirmLabel={t("lhuHierarchy.importExport.existingHierarchyConfirm")}
        onClose={() => setWarningOpen(false)}
        onConfirm={() => {
          setWarningOpen(false)
          setModalOpen(true)
        }}
      />

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="hierarchy-import-title"
        >
          <div className="w-full max-w-lg rounded-2xl border border-gray-200 bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="hierarchy-import-title" className="text-lg font-semibold text-slate-900">
                  {t("lhuHierarchy.importExport.modalTitle")}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  {t("lhuHierarchy.importExport.modalDescription")}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetModal}
                aria-label={t("lhuHierarchy.admin.cancel")}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileChange}
                  className="block w-full text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-blue-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-blue-700 hover:file:bg-blue-100"
                />
                {selectedFileName && (
                  <p className="mt-2 text-xs text-gray-500">{selectedFileName}</p>
                )}
              </div>

              {parsed && (
                <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm">
                  <p className="font-medium text-slate-900">
                    {t("lhuHierarchy.importExport.validRows", { count: parsed.rows.length })}
                  </p>
                  {parsed.errors.length > 0 && (
                    <div className="mt-2 space-y-1 text-xs text-red-600">
                      <p className="font-medium">
                        {t("lhuHierarchy.importExport.validationErrors", {
                          count: parsed.errors.length,
                        })}
                      </p>
                      <ul className="list-disc pl-4">
                        {parsed.errors.slice(0, 5).map((err, idx) => (
                          <li key={idx}>
                            {t("lhuHierarchy.importExport.rowError", {
                              row: err.row,
                              message: err.message,
                            })}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {submitError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {submitError}
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={resetModal}>
                {t("lhuHierarchy.admin.cancel")}
              </Button>
              <Button
                type="button"
                disabled={
                  importMutation.isPending ||
                  !parsed ||
                  parsed.rows.length === 0 ||
                  parsed.errors.length > 0
                }
                onClick={handleConfirmImport}
                className="bg-[#2563EB] text-white hover:bg-[#1d4ed8]"
              >
                {importMutation.isPending
                  ? t("lhuHierarchy.importExport.importing")
                  : t("lhuHierarchy.importExport.confirmImport")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {popup && (
        <OperationPopup
          key={popup.key}
          type={popup.type}
          title={popup.title}
          description={popup.description}
        />
      )}
    </>
  )
}
