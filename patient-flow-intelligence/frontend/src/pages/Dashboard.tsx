import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { useOutletContext } from 'react-router'
import type { AppOutletContext } from '@/layout/ManagerScopeContext'
import ManagerScopeSelector from '@/layout/ManagerScopeSelector'
import { useKeycloak } from '../auth/context'
import { fetchOccupancy } from '../api/operational'
import DischargeForecastBarChart from '../dashboard_widgets/DischargeForecastBarChart'
import UpcomingDischargesTable, {
  type UpcomingDischarge,
} from '../dashboard_widgets/UpcomingDischargesTable'
import HospitalStayByConditionTable from '../dashboard_widgets/HospitalStayByConditionTable'
import OccupancyBarChart from '../dashboard_widgets/OccupancyBarChart'
import DashboardPanel from '@/components/DashboardPanel'
import ForecastCard, {
  type ForecastCardData,
} from '../dashboard_widgets/ForecastCard'
import {
  getDashboardWidgets,
  type DashboardWidgetId,
} from '../dashboard_widgets/widgetConfig'

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

const UPCOMING_DISCHARGES: UpcomingDischarge[] = [
  { patient: 'Emily Rose Parker', room: '301', bed: '1', service: 'Cardiology', day: 'today', time: '11:30', destination: 'home', status: 'ready' },
  { patient: 'Daniel Brooks', room: '301', bed: '2', service: 'Cardiology', day: 'today', time: '15:00', destination: 'rehabilitation', status: 'pendingTransport' },
  { patient: 'Cody James Fisher', room: '302', bed: '2', service: 'Cardiology', day: 'tomorrow', time: '10:00', destination: 'home', status: 'medicationReview' },
  { patient: 'Marta Correia', room: '301', bed: '5', service: 'Cardiology', day: 'tomorrow', time: '14:30', destination: 'primaryCare', status: 'ready' },
  { patient: 'Nuno Costa', room: '305', bed: '2', service: 'Cardiology', day: '26 Jun', time: '09:30', destination: 'home', status: 'clinicalReview' },
]

type DashboardItem =
  | 'service'
  | 'unit'
  | 'discharges'
  | 'lengthOfStay'
  | 'upcomingDischarges'

const getProfileScope = (roles: string[] = [], scopeType: string | null = null): Scope | undefined => {
  if (roles.includes('ADMIN_ROLE')) return 'LHU'
  switch (scopeType) {
    case 'LHU': return 'LHU'
    case 'UNIT':
    case 'BUILDING':
    case 'FLOOR': return 'Unit'
    case 'SERVICE':
    case 'WING':
    case 'WARD': return 'Service'
    default: return undefined
  }
}

interface DashboardProps {
  scope?: Scope
}

const Dashboard = ({ scope = 'LHU' }: DashboardProps) => {
  const { t, i18n } = useTranslation()
  const { user } = useKeycloak()
  const { managerScope } = useOutletContext<AppOutletContext>()
  const [expandedItem, setExpandedItem] = useState<DashboardItem | null>(null)
  const dashboardDialogRef = useRef<HTMLDialogElement>(null)
  const profileScope = getProfileScope(user?.roles, user?.scopeType) ?? scope
  const dashboardWidgets: readonly DashboardWidgetId[] = getDashboardWidgets(user?.scopeType)
  const hasWidget = (widgetId: DashboardWidgetId) => dashboardWidgets.includes(widgetId)
  const metrics = SCOPE_METRICS[profileScope]
  const { data: occupancy, isPending: occupancyPending, isError: occupancyError } = useQuery({
    queryKey: ['dashboard-occupancy', managerScope.root?.id],
    queryFn: () => fetchOccupancy(managerScope.scope),
    enabled: user?.roles.includes('MANAGER_ROLE') === true && Boolean(managerScope.root),
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

  const serviceOccupancy = occupancy?.services ?? []
  const wingOccupancy = occupancy?.wings ?? []
  const unitOccupancy = occupancy?.units ?? []
  const occupancyChartRows = profileScope === 'Service' ? wingOccupancy : serviceOccupancy
  const occupancyChartTranslation = profileScope === 'Service' ? 'dashboard.perWing' : 'dashboard.perService'
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

  if (managerScope.isPending) {
    return <div className="p-6">{t('managerHierarchy.loading')}</div>
  }
  if (managerScope.isError) {
    return <div className="p-6 text-red-600">{t('lhuHierarchy.error')}</div>
  }
  if (!managerScope.root) {
    return <div className="p-6">{t('lhuHierarchy.noData')}</div>
  }

  const forecasts: ForecastCardData[] = [
    {
      id: 'today',
      label: t('dashboard.forecast.todayLabel'),
      value: metrics.discharges,
      detail: t('dashboard.forecast.todayDetail', { confirmed: 6, pending: 2 }),
      tone: 'bg-emerald-50 text-emerald-700',
    },
    {
      id: 'next48Hours',
      label: t('dashboard.forecast.next48Label'),
      value: metrics.next48Hours,
      detail: t('dashboard.forecast.next48Detail', { count: 5 }),
      tone: 'bg-purple-50 text-purple-700',
    },
    {
      id: 'available',
      label: t('dashboard.forecast.availableLabel'),
      value: metrics.available,
      detail: t('dashboard.forecast.availableDetail', { time: '18:00' }),
      tone: 'bg-amber-50 text-amber-700',
    },
  ]

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      {managerScope.hasMultipleScopes && managerScope.root && (
        <ManagerScopeSelector
          scopes={managerScope.scopes}
          selectedScope={managerScope.root}
          onSelect={managerScope.selectScope}
        />
      )}
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

        {hasWidget('forecast') &&
          forecasts.map((forecast) => (
            <ForecastCard
              key={forecast.id}
              forecast={forecast}
              badgeLabel={t('dashboard.forecast.badge')}
            />
          ))}
      </section>

      {/* Charts */}
      {hasWidget('occupancy') && (
        <section
          className={`grid min-w-0 grid-cols-1 gap-4 ${profileScope !== 'Service' ? '2xl:grid-cols-2' : ''}`}
        >
          <DashboardPanel
            title={t(`${occupancyChartTranslation}.title`)}
            description={t(`${occupancyChartTranslation}.body`)}
            expandLabel={t('dashboard.expandChart')}
            onExpand={() => setExpandedItem('service')}
            onClick={() => setExpandedItem('service')}
            contentClassName="p-6"
          >
            <OccupancyBarChart
              rows={occupancyChartRows}
              isPending={occupancyPending}
              isError={occupancyError}
            />
          </DashboardPanel>

          {profileScope !== 'Service' && (
            <DashboardPanel
              title={t('dashboard.perUnit.title')}
              description={t('dashboard.perUnit.body')}
              expandLabel={t('dashboard.expandChart')}
              onExpand={() => setExpandedItem('unit')}
              onClick={() => setExpandedItem('unit')}
              contentClassName="p-6"
            >
              <OccupancyBarChart
                rows={unitOccupancy}
                isPending={occupancyPending}
                isError={occupancyError}
              />
            </DashboardPanel>
          )}
        </section>
      )}

      {/* Forecasts */}
      {hasWidget('dischargeForecast') || hasWidget('hospitalStayByCondition') ? (
        <section className="grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-2">
          {hasWidget('dischargeForecast') && (
            <DashboardPanel
              title={t('dashboard.forecastChart.title')}
              description={t('dashboard.forecastChart.body')}
              expandLabel={t('dashboard.expandChart')}
              onExpand={() => setExpandedItem('discharges')}
              onClick={() => setExpandedItem('discharges')}
              contentClassName="p-6"
            >
              <DischargeForecastBarChart forecast={DISCHARGE_FORECAST} />
            </DashboardPanel>
          )}

          {hasWidget('hospitalStayByCondition') && (
            <DashboardPanel
              title={t('dashboard.lengthOfStay.title')}
              description={t('dashboard.lengthOfStay.body')}
              expandLabel={t('dashboard.expandTable')}
              onExpand={() => setExpandedItem('lengthOfStay')}
              onContentClick={() => setExpandedItem('lengthOfStay')}
              contentClassName="cursor-zoom-in overflow-x-auto"
            >
              <HospitalStayByConditionTable forecasts={LENGTH_OF_STAY_FORECAST} />
            </DashboardPanel>
          )}
        </section>
      ) : null}

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
                      ? `${occupancyChartTranslation}.title`
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
                      ? `${occupancyChartTranslation}.body`
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
              <OccupancyBarChart rows={occupancyChartRows} expanded />
            )}

            {expandedItem === 'unit' && (
              <OccupancyBarChart rows={unitOccupancy} expanded />
            )}

            {hasWidget('dischargeForecast') && expandedItem === 'discharges' && (
              <DischargeForecastBarChart forecast={DISCHARGE_FORECAST} expanded />
            )}

            {hasWidget('hospitalStayByCondition') && expandedItem === 'lengthOfStay' && (
              <div className="overflow-x-auto">
                <HospitalStayByConditionTable
                  forecasts={LENGTH_OF_STAY_FORECAST}
                  expanded
                />
              </div>
            )}

            {hasWidget('upcomingDischarges') && expandedItem === 'upcomingDischarges' && (
              <div className="overflow-x-auto">
                <UpcomingDischargesTable
                  discharges={UPCOMING_DISCHARGES}
                  expanded
                />
              </div>
            )}
          </div>
        )}
      </dialog>

      {/* Upcoming discharges */}
      {hasWidget('upcomingDischarges') && (
        <DashboardPanel
          title={t('dashboard.discharges.title')}
          description={t('dashboard.discharges.body')}
          expandLabel={t('dashboard.expandTable')}
          onExpand={() => setExpandedItem('upcomingDischarges')}
          onContentClick={() => setExpandedItem('upcomingDischarges')}
          contentClassName="cursor-zoom-in overflow-x-auto"
        >
          <UpcomingDischargesTable discharges={UPCOMING_DISCHARGES} />
        </DashboardPanel>
      )}
    </div>
  )
}

export default Dashboard