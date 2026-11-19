import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { useOutletContext } from 'react-router'
import type { AppOutletContext } from '@/layout/ManagerScopeContext'
import ManagerScopeSelector from '@/layout/ManagerScopeSelector'
import { useKeycloak } from '../auth/context'
import {
  fetchBeds,
  fetchDischargeForecast,
  fetchIndicators,
  fetchOccupancy,
  fetchOccupancyForecast,
  type BedView,
} from '../api/operational'
import {
  createManualAdmission,
  fetchCamasEmLibertacaoBreve,
  fetchServicos,
  type ManualAdmissionInput,
  type ManualAdmissionResult,
} from '../api/bed-allocation'
import UpcomingDischargesTable, {
  type UpcomingDischarge,
} from './dashboard_components/UpcomingDischargesTable'
import HospitalStayByConditionTable from './dashboard_components/HospitalStayByConditionTable'
import OccupancyBarChart from './dashboard_components/OccupancyBarChart'
import DashboardPanel from './dashboard_components/DashboardPanel'
import ForecastCard, {
  type ForecastCardData,
} from './dashboard_components/ForecastCard'

type Scope = 'LHU' | 'Unit' | 'Service'

const CRITICAL_THRESHOLD = 82

const UPCOMING_WINDOW_MS = 72 * 60 * 60 * 1000 // 72h
const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

// Altas previstas (modelo ou plano manual) entre agora e as próximas 72h.
const toUpcomingDischarges = (beds: BedView[], language?: string): UpcomingDischarge[] => {
  const startOfToday = new Date().setHours(0, 0, 0, 0)
  const now = Date.now()

  return beds
    .filter((bed) => {
      if (!bed.expectedDischargeAt) return false
      const expectedAt = Date.parse(bed.expectedDischargeAt)
      return expectedAt >= now && expectedAt <= now + UPCOMING_WINDOW_MS
    })
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

type DashboardItem = 'service' | 'unit' | 'discharges' | 'lengthOfStay' | 'upcomingDischarges'

const getProfileScope = (roles: string[] = [], scopeType: string | null = null): Scope | undefined => {
  if (roles.includes('ADMIN_ROLE')) return 'LHU'
  switch (scopeType) {
    case 'ULS': return 'LHU'
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
  const [lastUpdatedAt] = useState(() => new Date())
  const { managerScope } = useOutletContext<AppOutletContext>()
  const [expandedItem, setExpandedItem] = useState<DashboardItem | null>(null)
  const dashboardDialogRef = useRef<HTMLDialogElement>(null)
  const manualDialogRef = useRef<HTMLDialogElement>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualResult, setManualResult] = useState<ManualAdmissionResult | null>(null)
  const [manualError, setManualError] = useState<string | null>(null)
  const [manualDebug, setManualDebug] = useState(false)
  const [manualForm, setManualForm] = useState<ManualAdmissionInput>({
    full_name: '',
    priority: 3,
    isolation: false,
  })
  const resetManualAdmission = () => {
    setManualForm({ full_name: '', priority: 3, isolation: false })
    setManualResult(null)
    setManualError(null)
  }
  const { data: services = [] } = useQuery({
    queryKey: ['servicos'],
    queryFn: fetchServicos,
  })
  const manualAdmission = useMutation({
    mutationFn: (input: ManualAdmissionInput) =>
      createManualAdmission(input, manualDebug),
    onSuccess: (result) => {
      setManualResult(result)
      setManualError(null)
    },
    onError: (error: unknown) => {
      const status = (error as { response?: { status?: number } }).response?.status
      setManualResult(null)
      setManualError(
        status === 409
          ? 'manualAdmission.errors.conflict'
          : status === 422
            ? 'manualAdmission.errors.validation'
            : 'manualAdmission.errors.generic',
      )
    },
  })
  const profileScope = getProfileScope(user?.roles, user?.scopeType) ?? scope
  const { data: occupancy, isPending: occupancyPending, isError: occupancyError } = useQuery({
    queryKey: ['dashboard-occupancy', managerScope.root?.id],
    queryFn: () => fetchOccupancy(managerScope.scope),
    enabled: Boolean(managerScope.root),
    refetchInterval: 30_000,
  })
  const { data: indicators } = useQuery({
    queryKey: ['dashboard-indicators', managerScope.root?.id],
    queryFn: () => fetchIndicators(managerScope.scope),
    enabled: Boolean(managerScope.root),
    refetchInterval: 30_000,
  })
  const { data: forecast } = useQuery({
    queryKey: ['dashboard-forecast', managerScope.root?.id],
    queryFn: () => fetchOccupancyForecast(managerScope.scope),
    enabled: Boolean(managerScope.root),
    refetchInterval: 60_000,
  })
  const { data: dischargeByDay = [] } = useQuery({
    queryKey: ['dashboard-discharge-forecast', managerScope.root?.id],
    queryFn: () => fetchDischargeForecast(managerScope.scope),
    enabled: Boolean(managerScope.root),
    refetchInterval: 60_000,
  })
  const { data: upcomingDischarges = [] } = useQuery({
    queryKey: ['beds', 'upcoming-discharges', managerScope.root?.id, i18n.resolvedLanguage],
    // O backend limita size a 100: só as primeiras 100 camas ocupadas do âmbito entram na tabela.
    queryFn: () => fetchBeds(managerScope.scope, 'OCCUPIED', 0, 100),
    enabled: Boolean(managerScope.root),
    select: (page) => toUpcomingDischarges(page.content, i18n.resolvedLanguage),
    // Sem cliente WebSocket no frontend: polling para a previsão aparecer sem refresh.
    refetchInterval: 10_000, // 10s
  })

  useEffect(() => {
    const dialog = dashboardDialogRef.current
    if (expandedItem && dialog && !dialog.open) dialog.showModal()
  }, [expandedItem])

  useEffect(() => {
    const dialog = manualDialogRef.current
    if (manualOpen && dialog && !dialog.open) dialog.showModal()
  }, [manualOpen])

  const today = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date())

  const weekTotal = dischargeByDay.reduce((sum, item) => sum + item.expectedDischarges, 0)
  const maxForecast = Math.max(...dischargeByDay.map((item) => item.expectedDischarges), 1)
  const serviceOccupancy = occupancy?.services.length
    ? occupancy.services
    : indicators
      ? [{
          id: managerScope.root?.id ?? 'scope',
          name: managerScope.root?.name ?? '—',
          occupied: indicators.beds.occupied,
          capacity: indicators.beds.capacity,
          occupancyPercent: indicators.beds.occupancyPercent,
        }]
      : []
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
  const occupancyPercent = indicators?.beds.occupancyPercent
    ?? (occupancySummary.totalBeds > 0
      ? Math.round((occupancySummary.occupiedBeds / occupancySummary.totalBeds) * 10000) / 100
      : null)
  const criticalThreshold = indicators?.thresholds.occupancyCriticalPercent
    ?? occupancy?.criticalOccupancyPercent
    ?? CRITICAL_THRESHOLD
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
      value: indicators?.stays.expectedDischarges24h ?? null,
      detail: t('dashboard.forecast.todayDetail', {
        confirmed: indicators?.stays.expectedDischarges24h ?? 0,
        pending: indicators?.waiting.pending ?? 0,
      }),
      tone: 'bg-emerald-50 text-emerald-700',
    },
    {
      id: 'next48Hours',
      label: t('dashboard.forecast.next48Label'),
      value: indicators?.stays.expectedDischarges48h ?? null,
      detail: t('dashboard.forecast.next48Detail', { count: forecast?.services.totalElements ?? 0 }),
      tone: 'bg-purple-50 text-purple-700',
    },
    {
      id: 'available',
      label: t('dashboard.forecast.availableLabel'),
      value: indicators ? indicators.beds.available + indicators.stays.expectedDischarges48h : null,
      detail: t('dashboard.forecast.availableDetail', { time: '—' }),
      tone: 'bg-amber-50 text-amber-700',
    },
  ]
  const lengthOfStayForecast = indicators?.stays.averageLengthOfStayDays == null
    ? []
    : [{
        condition: 'all',
        minimumDays: indicators.stays.averageLengthOfStayDays,
        maximumDays: indicators.stays.averageLengthOfStayDays,
      }]
  const serviceName = managerScope.root?.name ?? '—'

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      {managerScope.hasMultipleScopes && managerScope.root && (
        <ManagerScopeSelector
          scopes={managerScope.scopes}
          selectedScope={managerScope.root}
          onSelect={managerScope.selectScope}
        />
      )}
      {manualResult && manualResult.debug_enabled && (
        <details className="rounded-lg border border-gray-200 p-3">
          <summary className="cursor-pointer font-medium">{t('manualAdmission.debug.title')}</summary>
          <div className="mt-3 space-y-3 text-sm">
            {manualResult.comparisons.map((comparison) => (
              <div key={comparison.bed_id}>
                <p className="font-medium">{comparison.bed_label}</p>
                {comparison.candidates.map((candidate) => (
                  <div key={candidate.encounter_id}>
                    <p>{candidate.patient_name}: {candidate.total_score}</p>
                    <p className="pl-3 text-xs text-gray-500">
                      {Object.entries(candidate.score_breakdown)
                        .map(([name, value]) => `${name}: ${value}`)
                        .join(' · ')}
                    </p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </details>
      )}
      {/* Header */}
      <section className="flex flex-col items-start justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <p className="text-sm font-medium capitalize text-blue-600">{today}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">
            {t(`dashboard.scopes.${profileScope}.title`)}
          </h1>
          <p className="mt-1.5 text-sm text-gray-500">
            {t(`dashboard.scopes.${profileScope}.description`, { service: serviceName })}
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

        {forecasts.map((forecast) => (
          <ForecastCard
            key={forecast.id}
            forecast={forecast}
            badgeLabel={t('dashboard.forecast.badge')}
          />
        ))}
      </section>

      {/* Charts */}
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

      {/* Forecasts */}
      <section className="grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-2">

        {/* Discharge Forecast */}
        <DashboardPanel
          title={t('dashboard.forecastChart.title')}
          description={t('dashboard.forecastChart.body')}
          expandLabel={t('dashboard.expandChart')}
          onExpand={() => setExpandedItem('discharges')}
          onClick={() => setExpandedItem('discharges')}
          contentClassName="p-6"
        >
          <div className="mt-6 flex h-48 items-end gap-2 border-b border-gray-200 pt-6">
            {dischargeByDay.map((item) => (
              <div key={item.date} className="flex h-full min-w-0 flex-1 items-end justify-center">
                <div
                  className="relative w-full max-w-32 rounded-t-md bg-blue-300"
                  style={{ height: `${(item.expectedDischarges / maxForecast) * 100}%` }}
                >
                  <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-medium text-gray-700">
                    {item.expectedDischarges.toFixed(1)}
                  </span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-2">
            {dischargeByDay.map((item) => (
              <span key={item.date} className="flex-1 text-center text-xs font-medium text-gray-500">
                {t(`dashboard.weekdays.${WEEKDAY_KEYS[item.dayOfWeek - 1]}`)}
              </span>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-between rounded-lg bg-blue-50/60 px-3 py-2">
            <span className="text-sm text-gray-500">{t('dashboard.forecastChart.total')}</span>
            <span className="text-sm font-semibold text-blue-600">
              {t('dashboard.forecastChart.patients', { count: weekTotal })}
            </span>
          </div>
        </DashboardPanel>

        {/* Length-of-stay forecast */}
        <DashboardPanel
          title={t('dashboard.lengthOfStay.title')}
          description={t('dashboard.lengthOfStay.body')}
          expandLabel={t('dashboard.expandTable')}
          onExpand={() => setExpandedItem('lengthOfStay')}
          onContentClick={() => setExpandedItem('lengthOfStay')}
          contentClassName="cursor-zoom-in overflow-x-auto"
        >
          <HospitalStayByConditionTable forecasts={lengthOfStayForecast} />
        </DashboardPanel>
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

            {expandedItem === 'discharges' && (
              <>
                <div className="flex h-[min(55vh,480px)] items-end gap-4 border-b border-gray-200 px-4 pt-12 sm:gap-8">
                  {dischargeByDay.map((item) => (
                    <div key={item.date} className="flex h-full min-w-0 flex-1 items-end justify-center">
                      <div
                        className="relative w-full max-w-32 rounded-t-md bg-blue-300"
                        style={{ height: `${(item.expectedDischarges / maxForecast) * 100}%` }}
                      >
                        <span className="absolute -top-7 left-1/2 -translate-x-1/2 text-sm font-medium text-gray-700">
                          {item.expectedDischarges.toFixed(1)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-4 px-4 pt-3 sm:gap-8">
                  {dischargeByDay.map((item) => (
                    <span key={item.date} className="flex-1 text-center text-sm font-medium text-gray-500">
                      {t(`dashboard.weekdays.${WEEKDAY_KEYS[item.dayOfWeek - 1]}`)}
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
                <HospitalStayByConditionTable
                  forecasts={lengthOfStayForecast}
                  expanded
                />
              </div>
            )}

            {expandedItem === 'upcomingDischarges' && (
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

      {/* Upcoming discharges */}
      <DashboardPanel
        title={t('dashboard.discharges.title')}
        description={t('dashboard.discharges.body')}
        expandLabel={t('dashboard.expandTable')}
        onExpand={() => setExpandedItem('upcomingDischarges')}
        onContentClick={() => setExpandedItem('upcomingDischarges')}
        contentClassName="cursor-zoom-in overflow-x-auto"
      >
          <UpcomingDischargesTable discharges={upcomingDischarges} />
      </DashboardPanel>

      <DashboardPanel
        title={t('manualAdmission.title')}
        description={t('manualAdmission.body')}
        expandLabel={t('manualAdmission.open')}
        onExpand={() => setManualOpen(true)}
        contentClassName="p-6"
      >
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <p className="text-sm text-gray-500">{t('manualAdmission.body')}</p>
          <Button type="button" onClick={() => setManualOpen(true)}>
            {t('manualAdmission.open')}
          </Button>
        </div>
      </DashboardPanel>

      <dialog
        ref={manualDialogRef}
        onClose={() => {
          setManualOpen(false)
          resetManualAdmission()
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-2xl border border-gray-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/40"
      >
        <form
          className="mx-auto w-full max-w-2xl space-y-5 p-6 sm:p-8"
          onSubmit={(event) => {
            event.preventDefault()
            if (event.currentTarget.checkValidity()) manualAdmission.mutate(manualForm)
          }}
        >
          <header className="flex items-start justify-between gap-4 border-b border-gray-200 pb-5">
            <div>
              <h2 className="text-xl font-semibold">{t('manualAdmission.title')}</h2>
              <p className="mt-1 text-sm text-gray-500">{t('manualAdmission.body')}</p>
            </div>
            <Button type="button" variant="ghost" onClick={() => manualDialogRef.current?.close()}>
              <X aria-hidden="true" className="h-5 w-5" />
            </Button>
          </header>
          <div className="grid gap-4 sm:grid-cols-2">
            {([
              ['full_name', 'text', 'manualAdmission.field.fullName'],
              ['birth_date', 'date', 'manualAdmission.field.birthDate'],
              ['expected_discharge_at', 'datetime-local', 'manualAdmission.field.expectedDischargeAt'],
            ] as const).map(([field, type, label]) => (
              <label key={field} className="flex flex-col gap-1 text-sm font-medium text-slate-700">
                {t(label)}
                <input
                  type={type}
                  required={field === 'full_name'}
                  minLength={field === 'full_name' ? 2 : undefined}
                  maxLength={field === 'full_name' ? 120 : undefined}
                  value={manualForm[field] ?? ''}
                  onChange={(event) =>
                    setManualForm((current) => ({ ...current, [field]: event.target.value }))
                  }
                  className="h-10 rounded-md border border-gray-300 px-3 font-normal"
                />
              </label>
            ))}
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              {t('manualAdmission.field.gender')}
              <select
                value={manualForm.gender ?? ''}
                onChange={(event) =>
                  setManualForm((current) => ({
                    ...current,
                    gender: (event.target.value || undefined) as 'F' | 'M' | undefined,
                  }))
                }
                className="h-10 rounded-md border border-gray-300 px-3 font-normal"
              >
                <option value="">{t('manualAdmission.gender.unspecified')}</option>
                <option value="F">{t('manualAdmission.gender.female')}</option>
                <option value="M">{t('manualAdmission.gender.male')}</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              {t('manualAdmission.field.service')}
              <select
                value={manualForm.service_id ?? ''}
                onChange={(event) =>
                  setManualForm((current) => ({ ...current, service_id: event.target.value || undefined }))
                }
                className="h-10 rounded-md border border-gray-300 px-3 font-normal"
              >
                <option value="">—</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>{service.name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              {t('manualAdmission.field.priority')}
              <select
                required
                value={manualForm.priority}
                onChange={(event) =>
                  setManualForm((current) => ({
                    ...current,
                    priority: event.target.value ? Number(event.target.value) : undefined,
                  }))
                }
                className="h-10 rounded-md border border-gray-300 px-3 font-normal"
              >
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((priority) => (
                  <option key={priority} value={priority}>{t(`manualAdmission.priority.${priority}`)}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={manualForm.isolation}
              onChange={(event) =>
                setManualForm((current) => ({ ...current, isolation: event.target.checked }))
              }
            />
            {t('manualAdmission.field.isolation')}
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={manualDebug}
              onChange={(event) => setManualDebug(event.target.checked)}
            />
            {t('manualAdmission.debug.toggle')}
          </label>
          {manualError && <p className="text-sm text-red-600">{t(manualError)}</p>}
          {manualAdmission.isPending && <p className="text-sm text-gray-500">{t('manualAdmission.loading')}</p>}
          {manualResult && (
            <div className="space-y-3">
              <h3 className="font-semibold">{t('manualAdmission.results.title')}</h3>
              {manualResult.suggestions.length > 0 && (
                <h4 className="font-semibold">{t('manualAdmission.results.direct')}</h4>
              )}
              {manualResult.suggestions.map((suggestion) => (
                <div key={suggestion.bed_id} className="flex flex-col gap-3 rounded-lg border border-gray-200 p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">{suggestion.bed_label}</p>
                    <p className="text-sm text-gray-500">{suggestion.justification}</p>
                    <Badge variant="secondary">{suggestion.score}</Badge>
                  </div>
                </div>
              ))}
              {manualResult.reallocations.length > 0 && (
                <h4 className="font-semibold">{t('manualAdmission.results.reallocations')}</h4>
              )}
              {manualResult.reallocations.map((suggestion) => (
                <div key={`${suggestion.displaced_encounter_id}-${suggestion.to_bed_id}`} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="font-medium">
                    {t('manualAdmission.results.freeBed', { bed: suggestion.from_bed_label })}
                  </p>
                  <p className="text-sm text-gray-600">
                    {suggestion.displaced_patient_name} ({t('manualAdmission.results.priority', { priority: suggestion.displaced_priority })})
                    {' → '}
                    {suggestion.to_bed_label ?? t('manualAdmission.results.noBed')}
                  </p>
                  <p className="text-sm text-gray-600">
                    {t('manualAdmission.results.combinedScore', { score: suggestion.score_combined })}
                    {' · '}
                    {t('manualAdmission.results.roomEvictionScore', { score: suggestion.room_eviction_score })}
                  </p>
                  <p className="text-sm text-gray-600">{suggestion.justification}</p>
                  {suggestion.warning && (
                    <div className="mt-2 rounded border border-amber-300 bg-amber-100 p-2 text-sm text-amber-900">
                      <p>{suggestion.warning.message}</p>
                      {suggestion.warning.code === 'NO_BED_AVAILABLE' && (
                        <ul className="list-disc pl-5">
                          {suggestion.warning.affected_patients.map((patient) => <li key={patient}>{patient}</li>)}
                        </ul>
                      )}
                    </div>
                  )}
                  <Badge variant="secondary">{suggestion.score_combined}</Badge>
                </div>
              ))}
              {manualResult.room_eviction_ranking.length > 0 && (
                <div className="rounded-lg border border-gray-200 p-3">
                  <h4 className="font-semibold">{t('manualAdmission.results.roomRanking')}</h4>
                  <div className="mt-2 space-y-2 text-sm">
                    {manualResult.room_eviction_ranking.map((room, index) => (
                      <div
                        key={room.room_id}
                        className={index === 0 ? 'rounded border border-blue-200 bg-blue-50 p-2' : 'p-2'}
                      >
                        <div className="flex justify-between gap-3">
                          <span>{room.room_label}</span>
                          <span>{room.eviction_score}</span>
                        </div>
                        <p className="text-gray-600">
                          {room.occupant_scores.map(([name, score]) => `${name} (${score})`).join(', ')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {manualResult.suggestions.length === 0 && manualResult.reallocations.length === 0 && (
                <EmptyDischarges
                  title={t('manualAdmission.results.empty.title')}
                  message={t('manualAdmission.results.empty.body')}
                />
              )}
            </div>
          )}
          <footer className="flex justify-end gap-3 border-t border-gray-200 pt-5">
            <Button type="button" variant="outline" onClick={() => manualDialogRef.current?.close()}>{t('manualAdmission.cancel')}</Button>
            <Button type="submit" disabled={manualAdmission.isPending}>{t('manualAdmission.submit')}</Button>
          </footer>
        </form>
      </dialog>
    </div>
  )
}

function EmptyDischarges({ title, message }: { title: string; message: string }) {
  const { data = [] } = useQuery({
    queryKey: ['camas-em-libertacao-breve'],
    queryFn: () => fetchCamasEmLibertacaoBreve(24),
  })
  return (
    <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
      <p className="font-medium">{title}</p>
      <p>{message}</p>
      {data.map((bed) => <p key={bed.bed_id}>{bed.bed_label} · {bed.current_patient_name}</p>)}
    </div>
  )
}

export default Dashboard