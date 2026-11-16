import { useTranslation } from 'react-i18next'
import DashboardPanel from '@/components/DashboardPanel'
import HospitalStayByConditionTable, {
  type HospitalStayForecast,
} from '@/components/dashboard_components/HospitalStayByConditionTable'

interface HospitalStayByConditionWidgetProps {
  forecasts: readonly HospitalStayForecast[]
  onExpand: () => void
}

function HospitalStayByConditionWidget({
  forecasts,
  onExpand,
}: HospitalStayByConditionWidgetProps) {
  const { t } = useTranslation()

  return (
    <DashboardPanel
      title={t('dashboard.lengthOfStay.title')}
      description={t('dashboard.lengthOfStay.body')}
      expandLabel={t('dashboard.expandTable')}
      onExpand={onExpand}
      onContentClick={onExpand}
      contentClassName="cursor-zoom-in overflow-x-auto"
    >
      <HospitalStayByConditionTable forecasts={forecasts} />
    </DashboardPanel>
  )
}

export default HospitalStayByConditionWidget
