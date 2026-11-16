import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/Badge'
import DashboardTable, { type DashboardTableColumn } from './DashboardTable'

type DischargeStatus = 'ready' | 'pendingTransport' | 'medicationReview' | 'clinicalReview'
type Destination = 'home' | 'rehabilitation' | 'primaryCare'

export interface UpcomingDischarge {
  patient: string
  room: string
  bed: string
  service: string
  day: string
  time: string
  destination: Destination
  status: DischargeStatus
}

interface UpcomingDischargesTableProps {
  discharges: UpcomingDischarge[]
  expanded?: boolean
}

const STATUS_STYLES: Record<DischargeStatus, string> = {
  ready: 'bg-emerald-50 text-emerald-700',
  pendingTransport: 'bg-amber-50 text-amber-700',
  medicationReview: 'bg-blue-50 text-blue-600',
  clinicalReview: 'bg-purple-50 text-purple-700',
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
      header: t('dashboard.discharges.columns.location'),
      renderCell: ({ room, bed }) => t('dashboard.discharges.location', { room, bed }),
    },
    {
      key: 'service',
      header: t('dashboard.discharges.columns.service'),
      renderCell: ({ service }) => service,
    },
    {
      key: 'expected',
      header: t('dashboard.discharges.columns.expected'),
      renderCell: ({ day, time }) => formatWhen(day, time),
    },
    {
      key: 'destination',
      header: t('dashboard.discharges.columns.destination'),
      renderCell: ({ destination }) => t(`dashboard.destinations.${destination}`),
    },
    {
      key: 'readiness',
      header: t('dashboard.discharges.columns.readiness'),
      renderCell: ({ status }) => (
        <Badge
          className={`whitespace-nowrap rounded-full border-0 ${
            expanded ? 'px-3 py-1 text-sm' : 'px-2.5 py-1 text-xs'
          } font-medium ${STATUS_STYLES[status]}`}
        >
          {t(`dashboard.status.${status}`)}
        </Badge>
      ),
    },
  ]

  return (
    <DashboardTable
      columns={columns}
      rows={discharges}
      getRowKey={({ patient }) => patient}
      tableClassName={`${
        expanded ? 'min-w-[900px] border-collapse text-base text-left' : 'min-w-[720px] border-collapse text-left'
      }`}
      expanded={expanded}
    />
  )
}

export default UpcomingDischargesTable
