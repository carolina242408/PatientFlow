import { useTranslation } from 'react-i18next'
import DashboardTable, { type DashboardTableColumn } from '../DashboardTable'

export interface HospitalStayForecast {
  code: string
  name: string | null
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
      renderCell: ({ name }) =>  name,
    },
    {
      key: 'code',
      header: t('dashboard.lengthOfStay.code', { defaultValue: 'Code' }),
      align: 'center',
      renderCell: ({ code: code }) => code,
    },
    {
      key: 'estimatedStay',
      header: t('dashboard.lengthOfStay.estimatedStay'),
      align: 'center',
      renderCell: ({ minimumDays, maximumDays }) =>
        minimumDays === maximumDays
          ? t('dashboard.lengthOfStay.meanDays', {
              days: minimumDays,
              defaultValue: `${minimumDays} dias`,
            })
          : t('dashboard.lengthOfStay.daysRange', {
              minimum: minimumDays,
              maximum: maximumDays,
            }),
    },
  ]

  return (
    <DashboardTable
      columns={columns}
      rows={forecasts}
      getRowKey={({ code: code }) => code}
      tableClassName={`min-w-[480px] border-collapse${expanded ? ' text-base' : ''}`}
      expanded={expanded}
    />
  )
}

export default HospitalStayByConditionTable
