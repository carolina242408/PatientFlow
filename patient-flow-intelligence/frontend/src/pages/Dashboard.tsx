import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { Maximize2, X } from 'lucide-react'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/Table'
import { useKeycloak } from '../auth/context'
import { fetchOccupancy } from '../api/operational'

type Scope = 'LHU' | 'Unit' | 'Service'

// Dados de exemplo: substitui por dados do backend
const CRITICAL_THRESHOLD = 82
const SERVICE_NAME = 'Cardiology'

const SCOPE_METRICS: Record<
  Scope,
  {
    occupancy: number
    occupiedBeds: number
    totalBeds: number
    discharges: number
    next48Hours: number
    available: number
  }
> = {
  LHU: { occupancy: 78, occupiedBeds: 187, totalBeds: 240, discharges: 8, next48Hours: 14, available: 67 },
  Unit: { occupancy: 81, occupiedBeds: 96, totalBeds: 118, discharges: 5, next48Hours: 9, available: 31 },
  Service: { occupancy: 88, occupiedBeds: 42, totalBeds: 48, discharges: 3, next48Hours: 5, available: 9 },
}

const DISCHARGE_FORECAST = [
  { day: 'mon', count: 3 },
  { day: 'tue', count: 5 },
  { day: 'wed', count: 4 },
  { day: 'thu', count: 7 },
  { day: 'fri', count: 6 },
  { day: 'sat', count: 2 },
  { day: 'sun', count: 3 },
]

const LENGTH_OF_STAY_FORECAST = [
  { condition: 'pneumonia', minimumDays: 5, maximumDays: 7 },
  { condition: 'heartFailure', minimumDays: 4, maximumDays: 6 },
  { condition: 'angina', minimumDays: 2, maximumDays: 4 },
  { condition: 'arrhythmia', minimumDays: 3, maximumDays: 5 },
  { condition: 'cardiacObservation', minimumDays: 1, maximumDays: 2 },
] as const

type DischargeStatus = 'ready' | 'pendingTransport' | 'medicationReview' | 'clinicalReview'
type Destination = 'home' | 'rehabilitation' | 'primaryCare'

const UPCOMING_DISCHARGES: {
  patient: string
  room: string
  bed: string
  service: string
  day: 'today' | 'tomorrow' | string
  time: string
  destination: Destination
  status: DischargeStatus
}[] = [
  { patient: 'Emily Rose Parker', room: '301', bed: '1', service: 'Cardiology', day: 'today', time: '11:30', destination: 'home', status: 'ready' },
  { patient: 'Daniel Brooks', room: '301', bed: '2', service: 'Cardiology', day: 'today', time: '15:00', destination: 'rehabilitation', status: 'pendingTransport' },
  { patient: 'Cody James Fisher', room: '302', bed: '2', service: 'Cardiology', day: 'tomorrow', time: '10:00', destination: 'home', status: 'medicationReview' },
  { patient: 'Marta Correia', room: '301', bed: '5', service: 'Cardiology', day: 'tomorrow', time: '14:30', destination: 'primaryCare', status: 'ready' },
  { patient: 'Nuno Costa', room: '305', bed: '2', service: 'Cardiology', day: '26 Jun', time: '09:30', destination: 'home', status: 'clinicalReview' },
]

const STATUS_STYLES: Record<DischargeStatus, string> = {
  ready: 'bg-emerald-50 text-emerald-700',
  pendingTransport: 'bg-amber-50 text-amber-700',
  medicationReview: 'bg-blue-50 text-blue-600',
  clinicalReview: 'bg-purple-50 text-purple-700',
}

const barColor = (occupancy: number) =>
  occupancy >= 85 ? 'bg-violet-500' : occupancy >= 75 ? 'bg-blue-500' : 'bg-blue-400'

type DashboardItem = 'service' | 'unit' | 'discharges' | 'lengthOfStay' | 'upcomingDischarges'

const getProfileScope = (roles: string[] = []): Scope | undefined => {
  if (roles.includes('ROLE_ADMIN') || roles.includes('LHU_MANAGER')) return 'LHU'
  if (roles.includes('UNIT_MANAGER')) return 'Unit'
  if (roles.includes('SERVICE_MANAGER')) return 'Service'
  return undefined
}

interface DashboardProps {
  scope?: Scope
}

const Dashboard = ({ scope = 'LHU' }: DashboardProps) => {
  const { t, i18n } = useTranslation()
  const { user } = useKeycloak()
  const [expandedItem, setExpandedItem] = useState<DashboardItem | null>(null)
  const dashboardDialogRef = useRef<HTMLDialogElement>(null)
  const profileScope = getProfileScope(user?.roles) ?? scope
  const metrics = SCOPE_METRICS[scope]
  const { data: occupancy, isPending: occupancyPending, isError: occupancyError } = useQuery({
    queryKey: ['dashboard-occupancy'],
    queryFn: () => fetchOccupancy(),
  })

  useEffect(() => {
    const dialog = dashboardDialogRef.current
    if (expandedItem && dialog && !dialog.open) dialog.showModal()
  }, [expandedItem])

  const today = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date())

  const weekTotal = DISCHARGE_FORECAST.reduce((sum, item) => sum + item.count, 0)
  const maxForecast = Math.max(...DISCHARGE_FORECAST.map((item) => item.count))
  const serviceOccupancy = occupancy?.services ?? []
  const unitOccupancy = occupancy?.units ?? []
  const occupancySummary = serviceOccupancy.reduce(
    (summary, item) => ({
      occupiedBeds: summary.occupiedBeds + item.occupied,
      totalBeds: summary.totalBeds + item.capacity,
    }),
    { occupiedBeds: 0, totalBeds: 0 },
  )
  const occupancyPercent =
    occupancySummary.totalBeds > 0
      ? Math.round((occupancySummary.occupiedBeds / occupancySummary.totalBeds) * 10000) / 100
      : null
  const criticalThreshold = occupancy?.criticalOccupancyPercent ?? CRITICAL_THRESHOLD
  const occupancyGap = occupancyPercent === null ? null : criticalThreshold - occupancyPercent

  const forecasts = [
    {
      label: t('dashboard.forecast.todayLabel'),
      value: metrics.discharges,
      detail: t('dashboard.forecast.todayDetail', { confirmed: 6, pending: 2 }),
      tone: 'bg-emerald-50 text-emerald-700',
    },
    {
      label: t('dashboard.forecast.next48Label'),
      value: metrics.next48Hours,
      detail: t('dashboard.forecast.next48Detail', { count: 5 }),
      tone: 'bg-purple-50 text-purple-700',
    },
    {
      label: t('dashboard.forecast.availableLabel'),
      value: metrics.available,
      detail: t('dashboard.forecast.availableDetail', { time: '18:00' }),
      tone: 'bg-amber-50 text-amber-700',
    },
  ]

  const formatWhen = (day: string, time: string) =>
    day === 'today' || day === 'tomorrow' ? `${t(`dashboard.days.${day}`)}, ${time}` : `${day}, ${time}`

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      {/* Header */}
      <section className="flex flex-col items-start justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <p className="text-sm font-medium capitalize text-blue-600">{today}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            {t(`dashboard.scopes.${profileScope}.title`)}
          </h1>
          <p className="mt-1.5 text-sm text-gray-500">
            {t(`dashboard.scopes.${profileScope}.description`, { service: SERVICE_NAME })}
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-500">
          {t('dashboard.lastUpdated', { time: '09:40' })}
        </div>
      </section>

      {/* KPI cards */}
      <section className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <article className="rounded-xl border border-blue-100 bg-white p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-500">
                {t('dashboard.occupancyRate', { scope: t(`dashboard.scopes.${scope}.name`) })}
              </p>
              <p className="mt-2 text-3xl font-semibold text-slate-900">
                {occupancyPercent === null ? '—' : `${occupancyPercent}%`}
              </p>
            </div>
            <Badge className="shrink-0 rounded-full border-0 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600">
              {t('dashboard.beds', {
                occupied: occupancySummary.occupiedBeds,
                total: occupancySummary.totalBeds,
              })}
            </Badge>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-blue-500"
              style={{ width: `${occupancyPercent ?? 0}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-gray-400">
            {occupancyGap === null
              ? t('dashboard.occupancyLoading')
              : occupancyGap >= 0
                ? t('dashboard.thresholdBelow', { value: occupancyGap })
                : t('dashboard.thresholdAbove', { value: Math.abs(occupancyGap) })}
          </p>
        </article>

        {forecasts.map((item) => (
          <article key={item.label} className="rounded-xl border border-gray-200 bg-white p-5">
            <Badge className={`inline-flex rounded-md border-0 px-2 py-1 text-xs font-medium ${item.tone}`}>
              {t('dashboard.forecast.badge')}
            </Badge>
            <p className="mt-3 text-3xl font-semibold text-slate-900">{item.value}</p>
            <p className="mt-1 text-sm font-medium text-gray-600">{item.label}</p>
            <p className="mt-2 text-xs text-gray-400">{item.detail}</p>
          </article>
        ))}
      </section>

      {/* Charts */}
      <section
        className={`grid min-w-0 grid-cols-1 gap-4 ${profileScope !== 'Service' ? '2xl:grid-cols-2' : ''}`}
      >
        <article
          onClick={() => setExpandedItem('service')}
          className="cursor-zoom-in rounded-2xl border border-gray-200 bg-white p-6"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">{t('dashboard.perService.title')}</h2>
              <p className="mt-1 text-sm text-gray-400">{t('dashboard.perService.body')}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              aria-haspopup="dialog"
              aria-label={`${t('dashboard.perService.title')}. ${t('dashboard.expandChart')}`}
              onClick={() => setExpandedItem('service')}
              className="shrink-0 rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Maximize2 aria-hidden="true" className="h-4 w-4" />
            </Button>
          </div>

          {/* Service Occupancy */}
          <div className="mt-6 flex h-48 items-end gap-3 border-b border-gray-200 px-1 pt-6">
            {serviceOccupancy.map((item) => (
              <div key={item.id} className="flex h-full min-w-0 flex-1 items-end justify-center">
                <div
                  className={`relative w-full max-w-32 rounded-t-md ${barColor(item.occupancyPercent ?? 0)}`}
                  style={{ height: `${item.occupancyPercent ?? 0}%` }}
                >
                  <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-medium text-gray-700">
                    {item.occupancyPercent ?? 0}%
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Legendas (mesmo gap e flex-1 para alinhar com as barras) */}
          <div className="flex gap-3 px-1 pt-2">
            {serviceOccupancy.map((item) => (
              <div key={item.id} className="min-w-0 flex-1 text-center">
                <span className="block min-h-8 whitespace-normal break-words text-xs font-medium leading-tight text-gray-500" title={item.name}>
                  {item.name}
                </span>
                <span className="mt-0.5 block text-xs text-gray-400">{item.occupied} / {item.capacity}</span>
              </div>
            ))}
          </div>
          {occupancyPending && <p className="mt-4 text-xs text-gray-400">{t('dashboard.occupancyLoading')}</p>}
          {occupancyError && <p className="mt-4 text-xs text-red-600">{t('dashboard.occupancyError')}</p>}
        </article>

        {profileScope !== 'Service' && (
          <article
            onClick={() => setExpandedItem('unit')}
            className="cursor-zoom-in rounded-2xl border border-gray-200 bg-white p-6"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">{t('dashboard.perUnit.title')}</h2>
                <p className="mt-1 text-sm text-gray-400">{t('dashboard.perUnit.body')}</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                aria-haspopup="dialog"
                aria-label={`${t('dashboard.perUnit.title')}. ${t('dashboard.expandChart')}`}
                onClick={() => setExpandedItem('unit')}
                className="shrink-0 rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <Maximize2 aria-hidden="true" className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-6 flex h-48 items-end gap-3 border-b border-gray-200 px-1 pt-6">
              {unitOccupancy.map((item) => (
                <div key={item.id} className="flex h-full min-w-0 flex-1 items-end justify-center">
                  <div
                    className={`relative w-full max-w-32 rounded-t-md ${barColor(item.occupancyPercent ?? 0)}`}
                    style={{ height: `${item.occupancyPercent ?? 0}%` }}
                  >
                    <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-medium text-gray-700">
                      {item.occupancyPercent ?? 0}%
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-3 px-1 pt-2">
              {unitOccupancy.map((item) => (
                <div key={item.id} className="min-w-0 flex-1 text-center">
                  <span className="block min-h-8 whitespace-normal break-words text-xs font-medium leading-tight text-gray-500" title={item.name}>
                    {item.name}
                  </span>
                  <span className="mt-0.5 block text-xs text-gray-400">{item.occupied} / {item.capacity}</span>
                </div>
              ))}
            </div>
            {occupancyPending && <p className="mt-4 text-xs text-gray-400">{t('dashboard.occupancyLoading')}</p>}
            {occupancyError && <p className="mt-4 text-xs text-red-600">{t('dashboard.occupancyError')}</p>}
          </article>
        )}
      </section>

      {/* Forecasts */}
      <section className="grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-2">

        {/* Discharge Forecast */}
        <article
          onClick={() => setExpandedItem('discharges')}
          className="cursor-zoom-in rounded-2xl border border-gray-200 bg-white p-6"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">{t('dashboard.forecastChart.title')}</h2>
              <p className="mt-1 text-sm text-gray-400">{t('dashboard.forecastChart.body')}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              aria-haspopup="dialog"
              aria-label={`${t('dashboard.forecastChart.title')}. ${t('dashboard.expandChart')}`}
              onClick={() => setExpandedItem('discharges')}
              className="shrink-0 rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <Maximize2 aria-hidden="true" className="h-4 w-4" />
            </Button>
          </div>

          <div className="mt-6 flex h-48 items-end gap-2 border-b border-gray-200 pt-6">
            {DISCHARGE_FORECAST.map((item) => (
              <div key={item.day} className="flex h-full min-w-0 flex-1 items-end justify-center">
                <div
                  className="relative w-full max-w-32 rounded-t-md bg-blue-300"
                  style={{ height: `${(item.count / maxForecast) * 100}%` }}
                >
                  <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-medium text-gray-700">
                    {item.count}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-2">
            {DISCHARGE_FORECAST.map((item) => (
              <span key={item.day} className="flex-1 text-center text-xs font-medium text-gray-500">
                {t(`dashboard.weekdays.${item.day}`)}
              </span>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between rounded-lg bg-blue-50/60 px-3 py-2">
            <span className="text-sm text-gray-500">{t('dashboard.forecastChart.total')}</span>
            <span className="text-sm font-semibold text-blue-600">
              {t('dashboard.forecastChart.patients', { count: weekTotal })}
            </span>
          </div>
        </article>

        {/* Length-of-stay forecast */}
        <article>
          <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-7">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  {t('dashboard.lengthOfStay.title')}
                </h2>
                <p className="mt-1 text-sm text-gray-400">
                  {t('dashboard.lengthOfStay.body')}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                aria-haspopup="dialog"
                aria-label={`${t('dashboard.lengthOfStay.title')}. ${t('dashboard.expandTable')}`}
                onClick={() => setExpandedItem('lengthOfStay')}
                className="shrink-0 rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <Maximize2 aria-hidden="true" className="h-4 w-4" />
              </Button>
            </div>

            <div
              className="cursor-zoom-in overflow-x-auto"
              onClick={() => setExpandedItem('lengthOfStay')}
            >
              <Table className="min-w-[480px] border-collapse">
                <TableHeader>
                  <TableRow className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-400 hover:bg-transparent">
                    <TableHead scope="col" className="px-6 py-3 text-left">
                      {t('dashboard.lengthOfStay.condition')}
                    </TableHead>
                    <TableHead scope="col" className="px-4 py-3 text-center">
                      {t('dashboard.lengthOfStay.estimatedStay')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {LENGTH_OF_STAY_FORECAST.map(({ condition, minimumDays, maximumDays }) => (
                    <TableRow key={condition} className="border-t border-gray-100 border-b-0 text-sm text-gray-600 hover:bg-transparent">
                      <TableHead scope="row" className="px-6 py-3.5 text-left font-medium text-slate-900">
                        {t(`dashboard.lengthOfStay.conditions.${condition}`)}
                      </TableHead>
                      <TableCell className="px-4 py-3.5 text-center">
                        {t('dashboard.lengthOfStay.daysRange', { minimum: minimumDays, maximum: maximumDays })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        </article>
      </section>

      <dialog
        ref={dashboardDialogRef}
        aria-labelledby="dashboard-item-dialog-title"
        onClose={() => setExpandedItem(null)}
        className="dashboard-chart-dialog w-[calc(100%-2rem)] max-w-6xl overflow-y-auto rounded-2xl border border-gray-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/40"
      >
        {expandedItem && (
          <div className="p-6 sm:p-8">
            <header className="mb-6 flex items-start justify-between gap-4 border-b border-gray-200 pb-5">
              <div>
                <h2 id="dashboard-item-dialog-title" className="text-xl font-semibold text-slate-900">
                  {t(
                    expandedItem === 'service'
                      ? 'dashboard.perService.title'
                      : expandedItem === 'unit'
                        ? 'dashboard.perUnit.title'
                        : expandedItem === 'discharges'
                          ? 'dashboard.forecastChart.title'
                          : expandedItem === 'lengthOfStay'
                            ? 'dashboard.lengthOfStay.title'
                            : 'dashboard.discharges.title',
                  )}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  {t(
                    expandedItem === 'service'
                      ? 'dashboard.perService.body'
                      : expandedItem === 'unit'
                        ? 'dashboard.perUnit.body'
                        : expandedItem === 'discharges'
                          ? 'dashboard.forecastChart.body'
                          : expandedItem === 'lengthOfStay'
                            ? 'dashboard.lengthOfStay.body'
                            : 'dashboard.discharges.body',
                  )}
                </p>
              </div>
              <Button
                type="button"
                autoFocus
                variant="ghost"
                onClick={() => dashboardDialogRef.current?.close()}
                aria-label={t('dashboard.closeExpandedItem')}
                className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </Button>
            </header>

            {expandedItem === 'service' && (
              <div>
                <div className="flex h-[min(55vh,480px)] items-end gap-6 border-b border-gray-200 px-4 pt-12 sm:gap-10">
                  {serviceOccupancy.map((item) => (
                    <div key={item.id} className="flex h-full min-w-0 flex-1 items-end justify-center">
                      <div
                        className={`relative w-full max-w-32 rounded-t-md ${barColor(item.occupancyPercent ?? 0)}`}
                        style={{ height: `${item.occupancyPercent ?? 0}%` }}
                      >
                        <span className="absolute -top-7 left-1/2 -translate-x-1/2 text-sm font-medium text-gray-700">
                          {item.occupancyPercent ?? 0}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-6 px-4 pt-3 sm:gap-10">
                  {serviceOccupancy.map((item) => (
                    <div key={item.id} className="min-w-0 flex-1 text-center">
                      <span className="block min-h-10 whitespace-normal break-words text-sm font-medium text-gray-600">
                        {item.name}
                      </span>
                      <span className="mt-1 block text-xs text-gray-400">{item.occupied} / {item.capacity}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {expandedItem === 'unit' && (
              <div>
                <div className="flex h-[min(55vh,480px)] items-end gap-6 border-b border-gray-200 px-4 pt-12 sm:gap-10">
                  {unitOccupancy.map((item) => (
                    <div key={item.id} className="flex h-full min-w-0 flex-1 items-end justify-center">
                      <div
                        className={`relative w-full max-w-32 rounded-t-md ${barColor(item.occupancyPercent ?? 0)}`}
                        style={{ height: `${item.occupancyPercent ?? 0}%` }}
                      >
                        <span className="absolute -top-7 left-1/2 -translate-x-1/2 text-sm font-medium text-gray-700">
                          {item.occupancyPercent ?? 0}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-6 px-4 pt-3 sm:gap-10">
                  {unitOccupancy.map((item) => (
                    <div key={item.id} className="min-w-0 flex-1 text-center">
                      <span className="block min-h-10 whitespace-normal break-words text-sm font-medium text-gray-600">
                        {item.name}
                      </span>
                      <span className="mt-1 block text-xs text-gray-400">{item.occupied} / {item.capacity}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {expandedItem === 'discharges' && (
              <>
                <div className="flex h-[min(55vh,480px)] items-end gap-4 border-b border-gray-200 px-4 pt-12 sm:gap-8">
                  {DISCHARGE_FORECAST.map((item) => (
                    <div key={item.day} className="flex h-full min-w-0 flex-1 items-end justify-center">
                      <div
                        className="relative w-full max-w-32 rounded-t-md bg-blue-300"
                        style={{ height: `${(item.count / maxForecast) * 100}%` }}
                      >
                        <span className="absolute -top-7 left-1/2 -translate-x-1/2 text-sm font-medium text-gray-700">
                          {item.count}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-4 px-4 pt-3 sm:gap-8">
                  {DISCHARGE_FORECAST.map((item) => (
                    <span key={item.day} className="flex-1 text-center text-sm font-medium text-gray-500">
                      {t(`dashboard.weekdays.${item.day}`)}
                    </span>
                  ))}
                </div>
                <div className="mt-6 flex items-center justify-between rounded-lg bg-blue-50/60 px-4 py-3">
                  <span className="text-sm text-gray-500">{t('dashboard.forecastChart.total')}</span>
                  <span className="text-sm font-semibold text-blue-600">
                    {t('dashboard.forecastChart.patients', { count: weekTotal })}
                  </span>
                </div>
              </>
            )}

            {expandedItem === 'lengthOfStay' && (
              <div className="overflow-x-auto">
                <Table className="min-w-[480px] border-collapse text-base">
                  <TableHeader>
                    <TableRow className="bg-gray-50 text-sm font-medium uppercase tracking-wide text-gray-500 hover:bg-transparent">
                      <TableHead scope="col" className="px-8 py-5 text-left">
                        {t('dashboard.lengthOfStay.condition')}
                      </TableHead>
                      <TableHead scope="col" className="px-8 py-5 text-center">
                        {t('dashboard.lengthOfStay.estimatedStay')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {LENGTH_OF_STAY_FORECAST.map(({ condition, minimumDays, maximumDays }) => (
                      <TableRow key={condition} className="border-t border-gray-100 border-b-0 text-gray-600 hover:bg-transparent">
                        <TableHead scope="row" className="px-8 py-6 text-left font-medium text-slate-900">
                          {t(`dashboard.lengthOfStay.conditions.${condition}`)}
                        </TableHead>
                        <TableCell className="px-8 py-6 text-center">
                          {t('dashboard.lengthOfStay.daysRange', { minimum: minimumDays, maximum: maximumDays })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}

            {expandedItem === 'upcomingDischarges' && (
              <div className="overflow-x-auto">
                <Table className="min-w-[900px] border-collapse text-base text-left">
                  <TableHeader>
                    <TableRow className="bg-gray-50 text-sm font-medium uppercase tracking-wide text-gray-500 hover:bg-transparent">
                      {(['patient', 'location', 'service', 'expected', 'destination', 'readiness'] as const).map(
                        (column) => (
                          <TableHead key={column} scope="col" className="px-6 py-5">
                            {t(`dashboard.discharges.columns.${column}`)}
                          </TableHead>
                        ),
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {UPCOMING_DISCHARGES.map((discharge) => (
                      <TableRow key={discharge.patient} className="border-t border-gray-100 border-b-0 text-gray-600 hover:bg-transparent">
                        <TableHead scope="row" className="px-6 py-5 font-medium text-slate-900">
                          {discharge.patient}
                        </TableHead>
                        <TableCell className="px-6 py-5">
                          {t('dashboard.discharges.location', { room: discharge.room, bed: discharge.bed })}
                        </TableCell>
                        <TableCell className="px-6 py-5">{discharge.service}</TableCell>
                        <TableCell className="px-6 py-5">{formatWhen(discharge.day, discharge.time)}</TableCell>
                        <TableCell className="px-6 py-5">{t(`dashboard.destinations.${discharge.destination}`)}</TableCell>
                        <TableCell className="px-6 py-5">
                          <Badge className={`whitespace-nowrap rounded-full border-0 px-3 py-1 text-sm font-medium ${STATUS_STYLES[discharge.status]}`}>
                            {t(`dashboard.status.${discharge.status}`)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </dialog>

      {/* Upcoming discharges */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">{t('dashboard.discharges.title')}</h2>
            <p className="mt-1 text-sm text-gray-400">{t('dashboard.discharges.body')}</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            aria-haspopup="dialog"
            aria-label={`${t('dashboard.discharges.title')}. ${t('dashboard.expandTable')}`}
            onClick={() => setExpandedItem('upcomingDischarges')}
            className="shrink-0 rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <Maximize2 aria-hidden="true" className="h-4 w-4" />
          </Button>
        </div>

        <div
          className="cursor-zoom-in overflow-x-auto"
          onClick={() => setExpandedItem('upcomingDischarges')}
        >
          <Table className="min-w-[720px] border-collapse text-left">
            <TableHeader>
              <TableRow className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-400 hover:bg-transparent">
                {(['patient', 'location', 'service', 'expected', 'destination', 'readiness'] as const).map(
                  (col, i) => (
                    <TableHead key={col} className={`py-3 ${i === 0 ? 'px-6' : 'px-4'}`}>
                      {t(`dashboard.discharges.columns.${col}`)}
                    </TableHead>
                  ),
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {UPCOMING_DISCHARGES.map((d) => (
                <TableRow key={d.patient} className="border-t border-gray-100 border-b-0 text-sm text-gray-600 hover:bg-transparent">
                  <TableCell className="px-6 py-3.5 font-medium text-slate-900">{d.patient}</TableCell>
                  <TableCell className="px-4 py-3.5">
                    {t('dashboard.discharges.location', { room: d.room, bed: d.bed })}
                  </TableCell>
                  <TableCell className="px-4 py-3.5">{d.service}</TableCell>
                  <TableCell className="px-4 py-3.5">{formatWhen(d.day, d.time)}</TableCell>
                  <TableCell className="px-4 py-3.5">{t(`dashboard.destinations.${d.destination}`)}</TableCell>
                  <TableCell className="px-4 py-3.5">
                    <Badge className={`whitespace-nowrap rounded-full border-0 px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[d.status]}`}>
                      {t(`dashboard.status.${d.status}`)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  )
}

export default Dashboard