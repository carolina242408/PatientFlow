import { useTranslation } from 'react-i18next'
import DashboardTable, { type DashboardTableColumn } from '../DashboardTable'
import type { ExceededStayPatient } from '@/api/operational'

interface PatientsExceededStayTableProps {
  patients: readonly ExceededStayPatient[]
  expanded?: boolean
}

/**
 * Simple table that shows the patients whose stay exceeded the mean.
 */
export default function PatientsExceededStayTable({
  patients,
  expanded = false,
}: PatientsExceededStayTableProps) {
  const { t } = useTranslation()

  const columns: DashboardTableColumn<ExceededStayPatient>[] = [
    {
      key: 'patient',
      header: t('dashboard.exceededStay.patient', { defaultValue: 'Patient' }),
      rowHeader: true,
      renderCell: ({ patientName }) => patientName ?? '—',
    },
    {
      key: 'code',
      header: t('dashboard.exceededStay.code', { defaultValue: 'Code' }),
      align: 'center',
      renderCell: ({ conditionCode }) => conditionCode,
    },
    {
      key: 'condition',
      header: t('dashboard.exceededStay.condition', { defaultValue: 'Condition' }),
      renderCell: ({ conditionName }) => conditionName ?? '—',
    },
    {
      key: 'actual',
      header: t('dashboard.exceededStay.actual', {
        defaultValue: 'Actual stay (days)',
      }),
      align: 'center',
      renderCell: ({ actualDays }) => Math.round(actualDays),
    },
    {
      key: 'mean',
      header: t('dashboard.exceededStay.mean', {
        defaultValue: 'Mean stay (days)',
      }),
      align: 'center',
      renderCell: ({ meanDays }) => Math.round(meanDays),
    },
    {
      key: 'diff',
      header: t('dashboard.exceededStay.diff', {
        defaultValue: 'Overrun (days)',
      }),
      align: 'center',
      renderCell: ({ diffDays }) => Math.round(diffDays),
    },
  ]

  return (
    <DashboardTable
      columns={columns}
      rows={patients}
      getRowKey={({ patientId }) => patientId}
      tableClassName={`${
        expanded ? 'min-w-[900px] border-collapse text-base text-left' : 'min-w-[720px] border-collapse text-left'
      }`}
      containerClassName={expanded ? 'max-h-[70vh] overflow-y-auto' : undefined}
      expanded={expanded}
    />
  )
}