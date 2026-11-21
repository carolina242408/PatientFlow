import { useTranslation } from 'react-i18next'
import DashboardPanel from '@/components/DashboardPanel'
import PatientsExceededStayTable from '@/components/dashboard_components/PatientsExceededStayTable'
import { type ExceededStayPatient } from '@/api/operational'

interface PatientsExceededStayWidgetProps {
  patients: readonly ExceededStayPatient[]
  onExpand: () => void
}

/**
 * Panel that hosts the “patients exceeded stay” table.
 */
export default function PatientsExceededStayWidget({
  patients,
  onExpand,
}: PatientsExceededStayWidgetProps) {
  const { t } = useTranslation()

  return (
    <DashboardPanel
      title={t('dashboard.exceededStay.title', {
        defaultValue: 'Patients exceeding LOS estimate',
      })}
      description={t('dashboard.exceededStay.body', {
        defaultValue:
          'These patients stayed longer than the average length‑of‑stay for their diagnosed condition',
      })}
      expandLabel={t('dashboard.expandTable', { defaultValue: 'Expand table' })}
      onExpand={onExpand}
      onContentClick={onExpand}
      contentClassName="cursor-zoom-in overflow-x-auto"
      dataKind="current"
    >
      <PatientsExceededStayTable patients={patients} />
    </DashboardPanel>
  )
}