import { useTranslation } from 'react-i18next'
import type { OccupancyRow } from '../../api/operational'

interface OccupancyBarChartProps {
  rows: OccupancyRow[]
  expanded?: boolean
  isPending?: boolean
  isError?: boolean
}

const barColor = (occupancy: number) =>
  occupancy >= 85 ? 'bg-violet-500' : occupancy >= 75 ? 'bg-blue-500' : 'bg-blue-400'

function OccupancyBarChart({
  rows,
  expanded = false,
  isPending = false,
  isError = false,
}: OccupancyBarChartProps) {
  const { t } = useTranslation()

  return (
    <>
      <div
        className={`flex items-end border-b border-gray-200 ${
          expanded
            ? 'h-[min(55vh,480px)] gap-6 px-4 pt-12 sm:gap-10'
            : 'mt-6 h-48 gap-3 px-1 pt-6'
        }`}
      >
        {rows.map((item) => {
          const occupancy = item.occupancyPercent ?? 0

          return (
            <div key={item.id} className="flex h-full min-w-0 flex-1 items-end justify-center">
              <div
                className={`relative w-full max-w-32 rounded-t-md ${barColor(occupancy)}`}
                style={{ height: `${occupancy}%` }}
              >
                <span
                  className={`absolute left-1/2 -translate-x-1/2 font-medium text-gray-700 ${
                    expanded ? '-top-7 text-sm' : '-top-5 text-xs'
                  }`}
                >
                  {occupancy}%
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <div className={`flex ${expanded ? 'gap-6 px-4 pt-3 sm:gap-10' : 'gap-3 px-1 pt-2'}`}>
        {rows.map((item) => (
          <div key={item.id} className="min-w-0 flex-1 text-center">
            <span
              className={`block whitespace-normal break-words font-medium ${
                expanded
                  ? 'min-h-10 text-sm text-gray-600'
                  : 'min-h-8 text-xs leading-tight text-gray-500'
              }`}
              title={item.name}
            >
              {item.name}
            </span>
            <span className={`block text-gray-400 ${expanded ? 'mt-1 text-xs' : 'mt-0.5 text-xs'}`}>
              {item.occupied} / {item.capacity}
            </span>
          </div>
        ))}
      </div>

      {isPending && <p className="mt-4 text-xs text-gray-400">{t('dashboard.occupancyLoading')}</p>}
      {isError && <p className="mt-4 text-xs text-red-600">{t('dashboard.occupancyError')}</p>}
    </>
  )
}

export default OccupancyBarChart
