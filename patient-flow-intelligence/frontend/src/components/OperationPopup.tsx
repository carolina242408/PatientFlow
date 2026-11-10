import { useEffect, useState } from "react"

export type OperationPopupType = "success" | "error"

interface OperationPopupProps {
  type: OperationPopupType
  title: string
  description: string
  persistent?: boolean
}

function OperationPopup({ type, title, description, persistent = false }: OperationPopupProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    if (persistent) return
    const timeoutId = window.setTimeout(() => setVisible(false), 4000)
    return () => window.clearTimeout(timeoutId)
  }, [persistent])

  if (!visible) return null

  return (
    <div
      role={type === "success" ? "status" : "alert"}
      aria-live={type === "success" ? "polite" : "assertive"}
      className={`operation-popup operation-popup-${type}${persistent ? " operation-popup-persistent" : ""}`}
    >
      <p className="text-xl font-semibold">{title}</p>
      <p className="mt-1 text-sm">{description}</p>
    </div>
  )
}

export { OperationPopup }
