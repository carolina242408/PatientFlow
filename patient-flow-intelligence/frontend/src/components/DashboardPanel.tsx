import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Maximize2 } from 'lucide-react'
import { Badge } from '@/components/Badge'
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
  dataKind?: 'current' | 'forecast'
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
  dataKind,
}: DashboardPanelProps) {
  const { t } = useTranslation()

  return (
    <article
      onClick={onClick}
      className={`flex h-full flex-col overflow-hidden rounded-2xl border bg-white ${
        dataKind === 'forecast'
          ? 'border-amber-200'
          : dataKind === 'current'
            ? 'border-blue-100'
            : 'border-gray-200'
      } ${onClick ? 'cursor-zoom-in' : ''}`}
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 px-6 py-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-gray-400">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {dataKind && (
            <Badge
              className={`rounded-md border-0 px-2.5 py-1 text-xs font-medium ${
                dataKind === 'forecast'
                  ? 'bg-amber-100/80 text-amber-800'
                  : 'bg-blue-50 text-blue-700'
              }`}
            >
              {t(
                dataKind === 'forecast'
                  ? 'dashboard.forecast.badge'
                  : 'dashboard.currentDataBadge',
              )}
            </Badge>
          )}
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
        </div>
      </header>
      <div className={contentClassName} onClick={onContentClick}>
        {children}
      </div>
    </article>
  )
}

export default DashboardPanel