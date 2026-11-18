import { Badge } from '@/components/Badge'

export interface ForecastCardData {
  id: string
  value: number | null
  label: string
  detail: string
  tone: string
}

interface ForecastCardProps {
  forecast: ForecastCardData
  badgeLabel: string
}

function ForecastCard({ forecast, badgeLabel }: ForecastCardProps) {
  return (
    <article className="rounded-xl border border-gray-200 bg-white p-5">
      <Badge
        className={`inline-flex rounded-md border-0 px-2 py-1 text-xs font-medium ${forecast.tone}`}
      >
        {badgeLabel}
      </Badge>
      <p className="mt-3 text-3xl font-semibold text-slate-900">{forecast.value ?? '—'}</p>
      <p className="mt-1 text-sm font-medium text-gray-600">{forecast.label}</p>
      <p className="mt-2 text-xs text-gray-400">{forecast.detail}</p>
    </article>
  )
}

export default ForecastCard
