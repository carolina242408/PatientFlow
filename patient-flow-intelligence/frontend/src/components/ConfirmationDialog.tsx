import { useEffect, useId, useRef, type ReactNode } from "react"
import { Button } from "@/components/Button"

interface ConfirmationDialogProps {
  open: boolean
  title: string
  description: string
  icon: ReactNode
  cancelLabel: string
  confirmLabel?: string
  onClose: () => void
  onConfirm?: () => void
}

function ConfirmationDialog({
  open,
  title,
  description,
  icon,
  cancelLabel,
  confirmLabel,
  onClose,
  onConfirm,
}: ConfirmationDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const id = useId()
  const titleId = `${id}-title`
  const descriptionId = `${id}-description`

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClose={onClose}
      className="confirmation-dialog w-[calc(100%-2rem)] max-w-[500px] rounded-2xl border-0 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/40"
    >
      <div className="p-8 sm:p-10">
        <div className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-full bg-red-50 text-red-600">
          {icon}
        </div>
        <h2 id={titleId} className="text-center text-2xl font-bold text-slate-900">
          {title}
        </h2>
        <p id={descriptionId} className="mt-3 text-center text-base text-slate-500">
          {description}
        </p>
        <div className="mt-8 flex flex-col gap-3 border-t border-gray-200 pt-7 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={() => dialogRef.current?.close()}
            className="h-14 flex-1 rounded-xl border border-gray-200 bg-gray-100 px-5 text-base font-semibold text-slate-700 transition-colors hover:bg-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            {cancelLabel}
          </Button>
          {confirmLabel && onConfirm && (
            <Button
              type="button"
              onClick={() => {
                dialogRef.current?.close()
                onConfirm()
              }}
              className="h-14 flex-1 rounded-xl bg-red-500 px-5 text-base font-semibold text-white shadow-md transition-colors hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
            >
              {confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </dialog>
  )
}

export { ConfirmationDialog }
