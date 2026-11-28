import { useTranslation } from 'react-i18next'
import DashboardTable, { type DashboardTableColumn } from '../DashboardTable'

export interface UpcomingDischarge {
  patient: string
  room: string
  bed: string
  service: string
  day: string
  time: string
}

interface UpcomingDischargesTableProps {
  discharges: UpcomingDischarge[]
  expanded?: boolean
}

function UpcomingDischargesTable({
  discharges,
  expanded = false,
}: UpcomingDischargesTableProps) {
  const { t } = useTranslation()
  const formatWhen = (day: string, time: string) =>
    day === 'today' || day === 'tomorrow'
      ? `${t(`dashboard.days.${day}`)}, ${time}`
      : `${day}, ${time}`

  const columns: DashboardTableColumn<UpcomingDischarge>[] = [
    {
      key: 'patient',
      header: t('dashboard.discharges.columns.patient'),
      rowHeader: expanded,
      renderCell: ({ patient }) => patient,
    },
    {
      key: 'location',
      align: 'center',
      header: t('dashboard.discharges.columns.location'),
      renderCell: ({ room, bed }) => t('dashboard.discharges.location', { room, bed }),
    },
    {
      key: 'service',
      align: 'center',
      header: t('dashboard.discharges.columns.service'),
      renderCell: ({ service }) => service,
    },
    {
      key: 'expected',
      align: 'center',
      header: t('dashboard.discharges.columns.expected'),
      renderCell: ({ day, time }) => formatWhen(day, time),
    },
  ]

  return (
    <DashboardTable
      columns={columns}
      rows={discharges}
      getRowKey={({ patient, room, bed }) => `${patient}-${room}-${bed}`}
      tableClassName={`${
        expanded ? 'min-w-[900px] border-collapse text-base text-left' : 'min-w-[720px] border-collapse text-left'
      }`}
      expanded={expanded}
      dataKind="forecast"
    />
  )
}

export default UpcomingDischargesTable
