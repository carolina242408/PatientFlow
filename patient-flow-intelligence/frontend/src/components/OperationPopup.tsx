import { useEffect, useState } from "react"

export type OperationPopupType = "success" | "error"

interface OperationPopupProps {
  type: OperationPopupType
  title: string
  description: string
}

function OperationPopup({ type, title, description }: OperationPopupProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setVisible(false), 4000)
    return () => window.clearTimeout(timeoutId)
  }, [])

  if (!visible) return null

  return (
    <div
      role={type === "success" ? "status" : "alert"}
      aria-live={type === "success" ? "polite" : "assertive"}
      className={`operation-popup operation-popup-${type}`}
    >
      <p className="text-xl font-semibold">{title}</p>
      <p className="mt-1 text-sm">{description}</p>
    </div>
  )
}

export { OperationPopup }
