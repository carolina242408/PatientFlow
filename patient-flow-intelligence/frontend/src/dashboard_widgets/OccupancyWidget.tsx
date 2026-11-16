import { useTranslation } from 'react-i18next'
import DashboardPanel from '@/components/DashboardPanel'
import OccupancyBarChart from '@/components/dashboard_components/OccupancyBarChart'
import type { OccupancyRow } from '@/api/operational'

interface OccupancyWidgetProps {
  translationKey: 'dashboard.perService' | 'dashboard.perWing' | 'dashboard.perUnit'
  rows: OccupancyRow[]
  isPending: boolean
  isError: boolean
  onExpand: () => void
}

function OccupancyWidget({
  translationKey,
  rows,
  isPending,
  isError,
  onExpand,
}: OccupancyWidgetProps) {
  const { t } = useTranslation()

  return (
    <DashboardPanel
      title={t(`${translationKey}.title`)}
      description={t(`${translationKey}.body`)}
      expandLabel={t('dashboard.expandChart')}
      onExpand={onExpand}
      onClick={onExpand}
      contentClassName="p-6"
    >
      <OccupancyBarChart rows={rows} isPending={isPending} isError={isError} />
    </DashboardPanel>
  )
}

export default OccupancyWidget
