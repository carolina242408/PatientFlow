import { useTranslation } from 'react-i18next'
import DashboardPanel from '@/components/DashboardPanel'
import DischargeForecastBarChart, {
  type DischargeForecastDay,
} from '@/components/dashboard_components/DischargeForecastBarChart'

interface DischargeForecastWidgetProps {
  forecast: readonly DischargeForecastDay[]
  onExpand: () => void
}

function DischargeForecastWidget({ forecast, onExpand }: DischargeForecastWidgetProps) {
  const { t } = useTranslation()

  return (
    <DashboardPanel
      title={t('dashboard.forecastChart.title')}
      description={t('dashboard.forecastChart.body')}
      expandLabel={t('dashboard.expandChart')}
      onExpand={onExpand}
      onClick={onExpand}
      contentClassName="p-6"
    >
      <DischargeForecastBarChart forecast={forecast} />
    </DashboardPanel>
  )
}

export default DischargeForecastWidget
