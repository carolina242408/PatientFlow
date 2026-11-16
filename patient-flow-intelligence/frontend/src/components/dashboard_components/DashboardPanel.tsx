import type { ReactNode } from 'react'
import { Maximize2 } from 'lucide-react'
import { Button } from '@/components/Button'

interface DashboardPanelProps {
  title: string
  description: string
  expandLabel: string
  onExpand: () => void
  children: ReactNode
  onClick?: () => void
  onContentClick?: () => void
  contentClassName?: string
}

function DashboardPanel({
  title,
  description,
  expandLabel,
  onExpand,
  children,
  onClick,
  onContentClick,
  contentClassName = '',
}: DashboardPanelProps) {
  return (
    <article
      onClick={onClick}
      className={`overflow-hidden rounded-2xl border border-gray-200 bg-white ${
        onClick ? 'cursor-zoom-in' : ''
      }`}
    >
      <header className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-gray-400">{description}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          aria-haspopup="dialog"
          aria-label={`${title}. ${expandLabel}`}
          onClick={onExpand}
          className="shrink-0 rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <Maximize2 aria-hidden="true" className="h-4 w-4" />
        </Button>
      </header>
      <div className={contentClassName} onClick={onContentClick}>
        {children}
      </div>
    </article>
  )
}

export default DashboardPanel
