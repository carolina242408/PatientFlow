import { useTranslation } from 'react-i18next'
import DashboardPanel from '@/components/DashboardPanel'
import UpcomingDischargesTable, {
  type UpcomingDischarge,
} from '@/components/dashboard_components/UpcomingDischargesTable'

interface UpcomingDischargesWidgetProps {
  discharges: UpcomingDischarge[]
  onExpand: () => void
}

function UpcomingDischargesWidget({ discharges, onExpand }: UpcomingDischargesWidgetProps) {
  const { t } = useTranslation()

  return (
    <DashboardPanel
      title={t('dashboard.discharges.title')}
      description={t('dashboard.discharges.body')}
      expandLabel={t('dashboard.expandTable')}
      onExpand={onExpand}
      onContentClick={onExpand}
      contentClassName="cursor-zoom-in overflow-x-auto"
    >
      <UpcomingDischargesTable discharges={discharges} />
    </DashboardPanel>
  )
}

export default UpcomingDischargesWidget
