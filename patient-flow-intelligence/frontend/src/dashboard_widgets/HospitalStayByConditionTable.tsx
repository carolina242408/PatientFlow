import { useTranslation } from 'react-i18next'
import DashboardTable, { type DashboardTableColumn } from '../components/DashboardTable'

export interface HospitalStayForecast {
  condition: string
  minimumDays: number
  maximumDays: number
}

interface HospitalStayByConditionTableProps {
  forecasts: readonly HospitalStayForecast[]
  expanded?: boolean
}

function HospitalStayByConditionTable({
  forecasts,
  expanded = false,
}: HospitalStayByConditionTableProps) {
  const { t } = useTranslation()

  const columns: DashboardTableColumn<HospitalStayForecast>[] = [
    {
      key: 'condition',
      header: t('dashboard.lengthOfStay.condition'),
      rowHeader: true,
      renderCell: ({ condition }) => t(`dashboard.lengthOfStay.conditions.${condition}`),
    },
    {
      key: 'estimatedStay',
      header: t('dashboard.lengthOfStay.estimatedStay'),
      align: 'center',
      renderCell: ({ minimumDays, maximumDays }) =>
        t('dashboard.lengthOfStay.daysRange', {
          minimum: minimumDays,
          maximum: maximumDays,
        }),
    },
  ]

  return (
    <DashboardTable
      columns={columns}
      rows={forecasts}
      getRowKey={({ condition }) => condition}
      tableClassName={`min-w-[480px] border-collapse${expanded ? ' text-base' : ''}`}
      expanded={expanded}
    />
  )
}

export default HospitalStayByConditionTable
