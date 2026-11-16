import { useTranslation } from 'react-i18next'

export interface DischargeForecastDay {
  day: string
  count: number
}

interface DischargeForecastBarChartProps {
  forecast: readonly DischargeForecastDay[]
  expanded?: boolean
}

function DischargeForecastBarChart({
  forecast,
  expanded = false,
}: DischargeForecastBarChartProps) {
  const { t } = useTranslation()
  const total = forecast.reduce((sum, item) => sum + item.count, 0)
  const maxCount = Math.max(1, ...forecast.map((item) => item.count))

  return (
    <>
      <div
        className={`flex items-end border-b border-gray-200 ${
          expanded
            ? 'h-[min(55vh,480px)] gap-4 px-4 pt-12 sm:gap-8'
            : 'mt-6 h-48 gap-2 pt-6'
        }`}
      >
        {forecast.map((item) => (
          <div key={item.day} className="flex h-full min-w-0 flex-1 items-end justify-center">
            <div
              className="relative w-full max-w-32 rounded-t-md bg-blue-300"
              style={{ height: `${(item.count / maxCount) * 100}%` }}
            >
              <span
                className={`absolute left-1/2 -translate-x-1/2 font-medium text-gray-700 ${
                  expanded ? '-top-7 text-sm' : '-top-5 text-xs'
                }`}
              >
                {item.count}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className={`flex ${expanded ? 'gap-4 px-4 pt-3 sm:gap-8' : 'gap-2 pt-2'}`}>
        {forecast.map((item) => (
          <span
            key={item.day}
            className={`flex-1 text-center font-medium text-gray-500 ${
              expanded ? 'text-sm' : 'text-xs'
            }`}
          >
            {t(`dashboard.weekdays.${item.day}`)}
          </span>
        ))}
      </div>
      <div
        className={`flex items-center justify-between rounded-lg bg-blue-50/60 ${
          expanded ? 'mt-6 px-4 py-3' : 'mt-4 px-3 py-2'
        }`}
      >
        <span className="text-sm text-gray-500">{t('dashboard.forecastChart.total')}</span>
        <span className="text-sm font-semibold text-blue-600">
          {t('dashboard.forecastChart.patients', { count: total })}
        </span>
      </div>
    </>
  )
}

export default DischargeForecastBarChart
