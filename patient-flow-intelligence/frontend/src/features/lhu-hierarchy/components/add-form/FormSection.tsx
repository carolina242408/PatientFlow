import type { ReactNode } from "react"

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="flex items-center gap-3">
        <h3 className="text-base font-semibold text-gray-900">{title}</h3>
        <div className="flex-1 border-t border-gray-200" />
      </div>
      <div className="mt-5">{children}</div>
    </section>
  )
}
