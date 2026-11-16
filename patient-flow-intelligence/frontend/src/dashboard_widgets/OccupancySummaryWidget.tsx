import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/Badge'

type OccupancyScope = 'LHU' | 'Unit' | 'Service'

interface OccupancySummaryWidgetProps {
  scope: OccupancyScope
  occupiedBeds: number
  totalBeds: number
  criticalThreshold: number
}

function OccupancySummaryWidget({
  scope,
  occupiedBeds,
  totalBeds,
  criticalThreshold,
}: OccupancySummaryWidgetProps) {
  const { t } = useTranslation()
  const occupancyPercent =
    totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 10000) / 100 : null
  const occupancyGap = occupancyPercent === null ? null : criticalThreshold - occupancyPercent

  return (
    <article className="h-full rounded-xl border border-blue-100 bg-white p-5">
      <header>
        <h2 className="text-sm font-medium text-gray-700">
          {t('dashboard.occupancyRate', {
            scope: t(`dashboard.scopes.${scope}.name`),
          })}
        </h2>
      </header>
      <div className="mt-4 flex items-start justify-between gap-3">
        <p className="text-3xl font-semibold text-slate-900">
          {occupancyPercent === null ? '—' : `${occupancyPercent}%`}
        </p>
        <Badge className="shrink-0 rounded-full border-0 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600">
          {t('dashboard.beds', { occupied: occupiedBeds, total: totalBeds })}
        </Badge>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-blue-500"
          style={{ width: `${occupancyPercent ?? 0}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-gray-400">
        {occupancyGap === null
          ? t('dashboard.occupancyLoading')
          : occupancyGap >= 0
            ? t('dashboard.thresholdBelow', { value: occupancyGap })
            : t('dashboard.thresholdAbove', { value: Math.abs(occupancyGap) })}
      </p>
    </article>
  )
}

export default OccupancySummaryWidget
