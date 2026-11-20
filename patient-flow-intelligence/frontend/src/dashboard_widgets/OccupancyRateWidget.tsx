import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/Badge'

type OccupancyScope = 'LHU' | 'Unit' | 'Service'

interface OccupancyRateWidgetProps {
  scope: OccupancyScope
  occupiedBeds: number
  totalBeds: number
  criticalThreshold: number
}

function OccupancyRateWidget({
  scope,
  occupiedBeds,
  totalBeds,
  criticalThreshold,
}: OccupancyRateWidgetProps) {
  const { t } = useTranslation()
  const occupancyPercent =
    totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 10000) / 100 : null
  const occupancyGap =
    occupancyPercent === null
      ? null
      : Math.round((criticalThreshold - occupancyPercent) * 100) / 100
  const isCritical = occupancyGap !== null && occupancyGap < 0

  return (
    <article
      className={`h-full rounded-xl border p-5 ${
        isCritical ? 'border-red-300 bg-red-50' : 'border-blue-100 bg-white'
      }`}
    >
      <header className="flex items-start justify-between gap-2">
        <h2
          className={`text-sm font-medium ${
            isCritical ? 'text-red-800' : 'text-gray-700'
          }`}
        >
          {t('dashboard.occupancyRate', {
            scope: t(`dashboard.scopes.${scope}.name`),
          })}
        </h2>
        <Badge className="shrink-0 rounded-md border-0 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
          {t('dashboard.currentDataBadge')}
        </Badge>
      </header>
      <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-3">
        <p
          className={`text-5xl font-semibold leading-none tracking-tight ${
            isCritical ? 'text-red-700' : 'text-slate-900'
          }`}
        >
          {occupancyPercent === null ? '—' : `${occupancyPercent}%`}
        </p>
        <div>
          <Badge
            className={`shrink-0 rounded-full border-0 px-2.5 py-1 text-xs font-medium ${
              isCritical
                ? 'bg-red-100 text-red-700'
                : 'bg-blue-50 text-blue-600'
            }`}
          >
            {t('dashboard.beds', { occupied: occupiedBeds, total: totalBeds })}
          </Badge>
          <p
            className={`mt-2 text-xs ${
              isCritical ? 'text-red-700' : 'text-gray-400'
            }`}
          >
            {occupancyGap === null
              ? t('dashboard.occupancyLoading')
              : occupancyGap >= 0
                ? t('dashboard.thresholdBelow', { value: occupancyGap })
                : t('dashboard.thresholdAbove', { value: Math.abs(occupancyGap) })}
          </p>
        </div>
      </div>

      <div
        className={`mt-4 h-2 overflow-hidden rounded-full ${
          isCritical ? 'bg-red-200/70' : 'bg-slate-100'
        }`}
      >
        <div
          className={`h-full rounded-full ${
            isCritical ? 'bg-red-600' : 'bg-blue-500'
          }`}
          style={{ width: `${Math.min(100, occupancyPercent ?? 0)}%` }}
        />
      </div>
    </article>
  )
}

export default OccupancyRateWidget
