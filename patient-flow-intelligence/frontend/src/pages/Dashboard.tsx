import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Button } from '@/components/Button'
import { useOutletContext } from 'react-router'
import type { AppOutletContext } from '@/layout/ManagerScopeContext'
import ManagerScopeSelector from '@/layout/ManagerScopeSelector'
import { useKeycloak, type AccessScopeType } from '../auth/context'
import { fetchOccupancy } from '../api/operational'
import type { UpcomingDischarge } from '@/components/dashboard_components/UpcomingDischargesTable'
import type { ForecastCardData } from '@/components/dashboard_components/ForecastCard'
import DischargeForecastBarChart from '@/components/dashboard_components/DischargeForecastBarChart'
import HospitalStayByConditionTable from '@/components/dashboard_components/HospitalStayByConditionTable'
import OccupancyBarChart from '@/components/dashboard_components/OccupancyBarChart'
import UpcomingDischargesTable from '@/components/dashboard_components/UpcomingDischargesTable'
import DischargeForecastWidget from '../dashboard_widgets/DischargeForecastWidget'
import ForecastWidget from '../dashboard_widgets/ForecastWidget'
import HospitalStayByConditionWidget from '../dashboard_widgets/HospitalStayByConditionWidget'
import OccupancyWidget from '../dashboard_widgets/OccupancyWidget'
import OccupancySummaryWidget from '../dashboard_widgets/OccupancySummaryWidget'
import UpcomingDischargesWidget from '../dashboard_widgets/UpcomingDischargesWidget'
import {
  getDashboardWidgets,
  type DashboardWidgetId,
} from '../dashboard_widgets/widgetConfig'
import { type BedView, fetchBeds } from '../api/operational'

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

const UPCOMING_WINDOW_MS = 72 * 60 * 60 * 1000 // 72h

// Altas previstas (modelo ou plano manual) até às próximas 72h, incluindo as já em atraso.
const toUpcomingDischarges = (beds: BedView[], language?: string): UpcomingDischarge[] => {
  const startOfToday = new Date().setHours(0, 0, 0, 0)

  return beds
    .filter((bed) => bed.expectedDischargeAt && Date.parse(bed.expectedDischargeAt) <= Date.now() + UPCOMING_WINDOW_MS)
    .sort((a, b) => Date.parse(a.expectedDischargeAt!) - Date.parse(b.expectedDischargeAt!))
    .map((bed) => {
      const at = new Date(bed.expectedDischargeAt!)

      const DAY_MS = 86_400_000 // 24h in ms
      const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - startOfToday) / DAY_MS)

      return {
        patient: bed.patientName ?? '—',
        room: bed.roomCode,
        bed: bed.code,
        service: bed.serviceName,
        day:
          // TODO: utilizar dayjs ou date-fns para internacionalização de datas, em vez de Intl.DateTimeFormat.
          days === 0 ? 'today'
          : days === 1 ? 'tomorrow'
          : new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short' }).format(at),
        time: new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(at),
      }
    })
}

type DashboardItem =
  | 'service'
  | 'unit'
  | 'discharges'
  | 'lengthOfStay'
  | 'upcomingDischarges'

const getProfileScope = (scopeType: AccessScopeType | null): Scope | undefined => {
  switch (scopeType) {
    case 'LHU': return 'LHU'
    case 'UNIT': return 'Unit'
    case 'SERVICE': return 'Service'
    default: return undefined
  }
}

const Dashboard = () => {
  const { t, i18n } = useTranslation()
  const { user } = useKeycloak()
  const [lastUpdatedAt] = useState(() => new Date())
  const { managerScope } = useOutletContext<AppOutletContext>()
  const [expandedItem, setExpandedItem] = useState<DashboardItem | null>(null)
  const dashboardDialogRef = useRef<HTMLDialogElement>(null)
  const profileScope = getProfileScope(user?.scopeType ?? null)
  const dashboardWidgets: readonly DashboardWidgetId[] = getDashboardWidgets(user?.scopeType)
  const hasConfiguredWidgets = dashboardWidgets.length > 0
  const hasWidget = (widgetId: DashboardWidgetId) => dashboardWidgets.includes(widgetId)
  const { data: occupancy, isPending: occupancyPending, isError: occupancyError } = useQuery({
    queryKey: ['dashboard-occupancy', managerScope.root?.id],
    queryFn: () => fetchOccupancy(managerScope.scope),
    enabled:
      hasConfiguredWidgets &&
      user?.roles.includes('MANAGER_ROLE') === true &&
      Boolean(managerScope.root),
  })
  const { data: upcomingDischarges = [] } = useQuery({
    queryKey: ['beds', 'upcoming-discharges', i18n.resolvedLanguage],
    // O backend limita size a 100: só as primeiras 100 camas ocupadas do âmbito entram na tabela.
    queryFn: () => fetchBeds({}, 'OCCUPIED', 0, 100),
    select: (page) => toUpcomingDischarges(page.content, i18n.resolvedLanguage),
    // Sem cliente WebSocket no frontend: polling para a previsão aparecer sem refresh.
    refetchInterval: 10_000, // 10s
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
  const criticalThreshold = occupancy?.criticalOccupancyPercent ?? CRITICAL_THRESHOLD

  if (managerScope.isPending) {
    return <div className="p-6">{t('managerHierarchy.loading')}</div>
  }
  if (managerScope.isError) {
    return <div className="p-6 text-red-600">{t('lhuHierarchy.error')}</div>
  }
  if (!managerScope.root) {
    return <div className="p-6">{t('lhuHierarchy.noData')}</div>
  }
  if (!profileScope) return null

  const metrics = SCOPE_METRICS[profileScope]

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

  const occupancySummary = serviceOccupancy.reduce(
    (summary, item) => ({
      occupiedBeds: summary.occupiedBeds + item.occupied,
      totalBeds: summary.totalBeds + item.capacity,
    }),
    { occupiedBeds: 0, totalBeds: 0 },
  )

  const widgets: Record<DashboardWidgetId, ReactNode> = {
    occupancy: (
      <OccupancyWidget
        translationKey={profileScope === 'Service' ? 'dashboard.perWing' : 'dashboard.perService'}
        rows={occupancyChartRows}
        isPending={occupancyPending}
        isError={occupancyError}
        onExpand={() => setExpandedItem('service')}
      />
    ),
    occupancyByUnit: (
      <OccupancyWidget
        translationKey="dashboard.perUnit"
        rows={unitOccupancy}
        isPending={occupancyPending}
        isError={occupancyError}
        onExpand={() => setExpandedItem('unit')}
      />
    ),
    occupancySummary: (
      <OccupancySummaryWidget
        scope={profileScope}
        occupiedBeds={occupancySummary.occupiedBeds}
        totalBeds={occupancySummary.totalBeds}
        criticalThreshold={criticalThreshold}
      />
    ),
    forecast: <ForecastWidget forecasts={forecasts} />,
    dischargeForecast: (
      <DischargeForecastWidget
        forecast={DISCHARGE_FORECAST}
        onExpand={() => setExpandedItem('discharges')}
      />
    ),
    hospitalStayByCondition: (
      <HospitalStayByConditionWidget
        forecasts={LENGTH_OF_STAY_FORECAST}
        onExpand={() => setExpandedItem('lengthOfStay')}
      />
    ),
    upcomingDischarges: (
      <UpcomingDischargesWidget
        discharges={upcomingDischarges}
        onExpand={() => setExpandedItem('upcomingDischarges')}
      />
    ),
  }

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
          {t('dashboard.lastUpdated', {
            time: new Intl.DateTimeFormat(i18n.resolvedLanguage, {
              hour: '2-digit',
              minute: '2-digit',
            }).format(lastUpdatedAt),
          })}
        </div>
      </section>

      {(hasWidget('occupancySummary') || hasWidget('forecast')) && (
        <section className="grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-4">
          {hasWidget('occupancySummary') && (
            <div className="2xl:col-span-1">{widgets.occupancySummary}</div>
          )}
          {hasWidget('forecast') && (
            <div className="2xl:col-span-3">{widgets.forecast}</div>
          )}
        </section>
      )}

      {(hasWidget('occupancy') || hasWidget('occupancyByUnit')) && (
        <section className="grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-2">
          {hasWidget('occupancy') && <div>{widgets.occupancy}</div>}
          {hasWidget('occupancyByUnit') && <div>{widgets.occupancyByUnit}</div>}
        </section>
      )}

      {(hasWidget('dischargeForecast') || hasWidget('hospitalStayByCondition')) && (
        <section className="grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-2">
          {hasWidget('dischargeForecast') && <div>{widgets.dischargeForecast}</div>}
          {hasWidget('hospitalStayByCondition') && (
            <div>{widgets.hospitalStayByCondition}</div>
          )}
        </section>
      )}

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

            {hasWidget('occupancy') && expandedItem === 'service' && (
              <OccupancyBarChart rows={occupancyChartRows} expanded />
            )}

            {hasWidget('occupancyByUnit') && expandedItem === 'unit' && (
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
                  discharges={upcomingDischarges}
                  expanded
                />
              </div>
            )}
          </div>
        )}
      </dialog>

      {hasWidget('upcomingDischarges') && (
        <UpcomingDischargesWidget
          discharges={upcomingDischarges}
          onExpand={() => setExpandedItem('upcomingDischarges')}
        />
      )}
    </div>
  )
}

export default Dashboard