import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/Badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/Table'

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

const COLUMNS = ['patient', 'location', 'service', 'expected', 'destination', 'readiness'] as const

function UpcomingDischargesTable({
  discharges,
  expanded = false,
}: UpcomingDischargesTableProps) {
  const { t } = useTranslation()
  const cellPadding = expanded ? 'px-6 py-5' : 'px-4 py-3.5'
  const patientCellPadding = expanded ? cellPadding : 'px-6 py-3.5'
  const formatWhen = (day: string, time: string) =>
    day === 'today' || day === 'tomorrow'
      ? `${t(`dashboard.days.${day}`)}, ${time}`
      : `${day}, ${time}`

  return (
    <Table
      className={
        expanded
          ? 'min-w-[900px] border-collapse text-base text-left'
          : 'min-w-[720px] border-collapse text-left'
      }
    >
      <TableHeader>
        <TableRow
          className={`bg-gray-50 ${expanded ? 'text-sm text-gray-500' : 'text-xs text-gray-400'} font-medium uppercase tracking-wide hover:bg-transparent`}
        >
          {COLUMNS.map((column, index) => (
            <TableHead
              key={column}
              scope="col"
              className={
                expanded
                  ? 'px-6 py-5'
                  : `py-3 ${index === 0 ? 'px-6' : 'px-4'}`
              }
            >
              {t(`dashboard.discharges.columns.${column}`)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {discharges.map((discharge) => (
          <TableRow
            key={discharge.patient}
            className="border-t border-gray-100 border-b-0 text-gray-600 hover:bg-transparent"
          >
            {expanded ? (
              <TableHead scope="row" className={`${patientCellPadding} font-medium text-slate-900`}>
                {discharge.patient}
              </TableHead>
            ) : (
              <TableCell className={`${patientCellPadding} font-medium text-slate-900`}>
                {discharge.patient}
              </TableCell>
            )}
            <TableCell className={cellPadding}>
              {t('dashboard.discharges.location', {
                room: discharge.room,
                bed: discharge.bed,
              })}
            </TableCell>
            <TableCell className={cellPadding}>{discharge.service}</TableCell>
            <TableCell className={cellPadding}>
              {formatWhen(discharge.day, discharge.time)}
            </TableCell>
            <TableCell className={cellPadding}>
              {t(`dashboard.destinations.${discharge.destination}`)}
            </TableCell>
            <TableCell className={cellPadding}>
              <Badge
                className={`whitespace-nowrap rounded-full border-0 ${
                  expanded
                    ? 'px-3 py-1 text-sm'
                    : 'px-2.5 py-1 text-xs'
                } font-medium ${STATUS_STYLES[discharge.status]}`}
              >
                {t(`dashboard.status.${discharge.status}`)}
              </Badge>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export default UpcomingDischargesTable
