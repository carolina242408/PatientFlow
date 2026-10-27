import { useTranslation } from 'react-i18next'
import { useKeycloak } from '../auth/context'

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

const SERVICE_OCCUPANCY = [
  { service: 'Cardiology', occupancy: 88, beds: '42 / 48' },
  { service: 'Internal Medicine', occupancy: 82, beds: '54 / 66' },
  { service: 'Surgery', occupancy: 76, beds: '38 / 50' },
  { service: 'Orthopedics', occupancy: 69, beds: '29 / 42' },
  { service: 'Pediatrics', occupancy: 63, beds: '22 / 35' },
  { service: 'Maternity', occupancy: 57, beds: '17 / 30' },
]

const UNIT_OCCUPANCY = [
  { unit: 'Hospital Unit', occupancy: 81, beds: '96 / 118' },
  { unit: 'Outpatient Unit', occupancy: 74, beds: '52 / 70' },
  { unit: 'Maternity Unit', occupancy: 68, beds: '34 / 50' },
  { unit: 'Surgical Unit', occupancy: 63, beds: '44 / 70' },
]

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
  const profileScope = getProfileScope(user?.roles) ?? scope
  const metrics = SCOPE_METRICS[scope]

  const today = new Intl.DateTimeFormat(i18n.resolvedLanguage, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date())

  const gap = CRITICAL_THRESHOLD - metrics.occupancy
  const weekTotal = DISCHARGE_FORECAST.reduce((sum, item) => sum + item.count, 0)
  const maxForecast = Math.max(...DISCHARGE_FORECAST.map((item) => item.count))

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
              <p className="mt-2 text-3xl font-semibold text-slate-900">{metrics.occupancy}%</p>
            </div>
            <span className="shrink-0 rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-600">
              {t('dashboard.beds', { occupied: metrics.occupiedBeds, total: metrics.totalBeds })}
            </span>
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-blue-500"
              style={{ width: `${metrics.occupancy}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-gray-400">
            {gap >= 0
              ? t('dashboard.thresholdBelow', { value: gap })
              : t('dashboard.thresholdAbove', { value: Math.abs(gap) })}
          </p>
        </article>

        {forecasts.map((item) => (
          <article key={item.label} className="rounded-xl border border-gray-200 bg-white p-5">
            <span className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${item.tone}`}>
              {t('dashboard.forecast.badge')}
            </span>
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
        <article className="rounded-2xl border border-gray-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">{t('dashboard.perService.title')}</h2>
          <p className="mt-1 text-sm text-gray-400">{t('dashboard.perService.body')}</p>

          {/* Service Occupancy */}
          <div className="mt-6 flex h-48 items-end gap-3 border-b border-gray-200 px-1 pt-6">
            {SERVICE_OCCUPANCY.map((item) => (
              <div key={item.service} className="flex h-full min-w-0 flex-1 items-end justify-center">
                <div
                  className={`relative w-full max-w-12 rounded-t-md ${barColor(item.occupancy)}`}
                  style={{ height: `${item.occupancy}%` }}
                >
                  <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-medium text-gray-700">
                    {item.occupancy}%
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Legendas (mesmo gap e flex-1 para alinhar com as barras) */}
          <div className="flex gap-3 px-1 pt-2">
            {SERVICE_OCCUPANCY.map((item) => (
              <div key={item.service} className="min-w-0 flex-1 text-center">
                <span className="block min-h-8 whitespace-normal break-words text-xs font-medium leading-tight text-gray-500" title={item.service}>
                  {item.service}
                </span>
                <span className="mt-0.5 block text-xs text-gray-400">{item.beds}</span>
              </div>
            ))}
          </div>
        </article>

        {profileScope !== 'Service' && (
          <article className="rounded-2xl border border-gray-200 bg-white p-6">
            <h2 className="text-base font-semibold text-slate-900">{t('dashboard.perUnit.title')}</h2>
            <p className="mt-1 text-sm text-gray-400">{t('dashboard.perUnit.body')}</p>

            <div className="mt-6 flex h-48 items-end gap-3 border-b border-gray-200 px-1 pt-6">
              {UNIT_OCCUPANCY.map((item) => (
                <div key={item.unit} className="flex h-full min-w-0 flex-1 items-end justify-center">
                  <div
                    className={`relative w-full max-w-12 rounded-t-md ${barColor(item.occupancy)}`}
                    style={{ height: `${item.occupancy}%` }}
                  >
                    <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-xs font-medium text-gray-700">
                      {item.occupancy}%
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-3 px-1 pt-2">
              {UNIT_OCCUPANCY.map((item) => (
                <div key={item.unit} className="min-w-0 flex-1 text-center">
                  <span className="block min-h-8 whitespace-normal break-words text-xs font-medium leading-tight text-gray-500" title={item.unit}>
                    {item.unit}
                  </span>
                  <span className="mt-0.5 block text-xs text-gray-400">{item.beds}</span>
                </div>
              ))}
            </div>
          </article>
        )}
      </section>

      {/* Forecasts */}
      <section className="grid min-w-0 grid-cols-1 gap-4 2xl:grid-cols-2">

        {/* Discharge Forecast */}
        <article className="rounded-2xl border border-gray-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">{t('dashboard.forecastChart.title')}</h2>
          <p className="mt-1 text-sm text-gray-400">{t('dashboard.forecastChart.body')}</p>

          <div className="mt-6 flex h-48 items-end gap-2 border-b border-gray-200 pt-6">
            {DISCHARGE_FORECAST.map((item) => (
              <div key={item.day} className="flex h-full min-w-0 flex-1 items-end justify-center">
                <div
                  className="relative w-full max-w-8 rounded-t-md bg-blue-300"
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
            <div className="border-b border-gray-200 px-6 py-7">
              <h2 className="text-base font-semibold text-slate-900">
                {t('dashboard.lengthOfStay.title')}
              </h2>
              <p className="mt-1 text-sm text-gray-400">
                {t('dashboard.lengthOfStay.body')}
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-400">
                    <th scope="col" className="px-6 py-3 text-left">
                      {t('dashboard.lengthOfStay.condition')}
                    </th>
                    <th scope="col" className="px-4 py-3 text-center">
                      {t('dashboard.lengthOfStay.estimatedStay')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {LENGTH_OF_STAY_FORECAST.map(({ condition, minimumDays, maximumDays }) => (
                    <tr key={condition} className="border-t border-gray-100 text-sm text-gray-600">
                      <th scope="row" className="px-6 py-3.5 text-left font-medium text-slate-900">
                        {t(`dashboard.lengthOfStay.conditions.${condition}`)}
                      </th>
                      <td className="px-4 py-3.5 text-center">
                        {t('dashboard.lengthOfStay.daysRange', { minimum: minimumDays, maximum: maximumDays })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </article>
      </section>

      {/* Upcoming discharges */}
      <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-200 px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">{t('dashboard.discharges.title')}</h2>
            <p className="mt-1 text-sm text-gray-400">{t('dashboard.discharges.body')}</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-400">
                {(['patient', 'location', 'service', 'expected', 'destination', 'readiness'] as const).map(
                  (col, i) => (
                    <th key={col} className={`py-3 ${i === 0 ? 'px-6' : 'px-4'}`}>
                      {t(`dashboard.discharges.columns.${col}`)}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {UPCOMING_DISCHARGES.map((d) => (
                <tr key={d.patient} className="border-t border-gray-100 text-sm text-gray-600">
                  <td className="px-6 py-3.5 font-medium text-slate-900">{d.patient}</td>
                  <td className="px-4 py-3.5">
                    {t('dashboard.discharges.location', { room: d.room, bed: d.bed })}
                  </td>
                  <td className="px-4 py-3.5">{d.service}</td>
                  <td className="px-4 py-3.5">{formatWhen(d.day, d.time)}</td>
                  <td className="px-4 py-3.5">{t(`dashboard.destinations.${d.destination}`)}</td>
                  <td className="px-4 py-3.5">
                    <span
                      className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_STYLES[d.status]}`}
                    >
                      {t(`dashboard.status.${d.status}`)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

export default Dashboard