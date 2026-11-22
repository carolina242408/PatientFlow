import { useTranslation } from 'react-i18next'
import ForecastCard, {
  type ForecastCardData,
} from '@/components/dashboard_components/ForecastCard'

interface ForecastWidgetProps {
  forecasts: ForecastCardData[]
}

function ForecastWidget({ forecasts }: ForecastWidgetProps) {
  const { t } = useTranslation()

  return (
    <section className="h-full">
      <div className="grid h-full min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-2">
        {forecasts.map((forecast) => (
          <ForecastCard
            key={forecast.id}
            forecast={forecast}
            badgeLabel={t('dashboard.forecast.badge')}
          />
        ))}
      </div>
    </section>
  )
}

export default ForecastWidget
