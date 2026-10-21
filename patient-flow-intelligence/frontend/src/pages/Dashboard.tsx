import { useTranslation } from 'react-i18next'
import { useKeycloak } from '../auth/context'

// MOCK DATA — substituir por chamadas à API (src/api/axios.ts)
const STATS = [
  { key: 'patients', value: '123', change: '10.3%', trend: 'up' },
  { key: 'doctors', value: '123', change: '1.06%', trend: 'down' },
  { key: 'appointments', value: '123', change: '15.3%', trend: 'up' },
  { key: 'rooms', value: '123', change: '19.8%', trend: 'down' },
] as const

const RECENT_PATIENTS = [
  { id: 1, name: 'Emily Rose Parker', location: 'Ward 3 - Bed 12', service: 'Cardiology', discharge: 'Oct 08, 2026', readiness: 'Ready' },
  { id: 2, name: 'Michael James Turner', location: 'ICU - Bed 4', service: 'Neurology', discharge: 'Oct 12, 2026', readiness: 'Pending Labs' },
  { id: 3, name: 'Olivia Grace Bennett', location: 'Ward 1 - Bed 8', service: 'Orthopedics', discharge: 'Oct 09, 2026', readiness: 'Waiting for PT' },
]

const card = 'rounded-[15px] border border-gray-200 bg-white'

const Dashboard = () => {
  const { t } = useTranslation()
  const { user } = useKeycloak()

  return (
    <div className="max-w-[1200px]">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-xl font-medium text-black">{t('dashboard.welcome', { name: user?.name })}</h1>
        <div className="flex items-center gap-3">
          <div className="rounded-[5px] border border-gray-200 bg-white px-3 py-[7px] text-xs text-gray-500">
            {t('dashboard.lastUpdate', { date: 'October 06, 2026 09:40' })}
          </div>
          <button type="button" className="rounded-[5px] bg-primary px-4 py-[7px] text-xs font-medium text-white hover:bg-primary-dark">
            {t('dashboard.export')}
          </button>
        </div>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {STATS.map((s) => (
          <div key={s.key} className={`relative min-h-[115px] p-4 ${card}`}>
            <div className="mb-4 h-[30px] w-[30px] rounded-md bg-[#d9d9d9]" />
            <div className="mb-1 text-xs font-medium text-gray-500">{t(`dashboard.stats.${s.key}`)}</div>
            <div className="text-lg font-semibold text-black">{s.value}</div>
            <div
              className={`absolute right-4 bottom-4 flex items-center gap-[3px] rounded-[5px] px-2 py-[3px] text-[8px] font-medium ${
                s.trend === 'up' ? 'bg-[rgba(182,255,226,0.58)] text-[#0c8e5a]' : 'bg-[rgba(255,182,182,0.58)] text-[#df0b0b]'
              }`}
            >
              <span className="text-[10px]">{s.trend === 'up' ? '↑' : '↓'}</span>
              {s.change}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <div className={`flex h-[300px] items-center justify-center text-sm text-gray-400 ${card}`}>{t('dashboard.chart')}</div>
        <div className={`flex h-[300px] items-center justify-center text-sm text-gray-400 ${card}`}>{t('dashboard.chart')}</div>
      </div>

      <div className={`overflow-hidden ${card}`}>
        <div className="flex items-center justify-between border-b border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-500">{t('dashboard.recent')}</h2>
          <input
            type="search"
            placeholder={t('dashboard.search')}
            className="w-[280px] rounded-[5px] border border-gray-200 px-3 py-[7px] text-xs outline-none focus:border-primary"
          />
        </div>
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              {(['patient', 'location', 'service', 'discharge', 'readiness'] as const).map((h) => (
                <th key={h} className="border-b border-[#d9dee8] bg-[#eaf3ff] px-3.5 py-2.5 text-left font-medium whitespace-nowrap text-black">
                  {t(`dashboard.table.${h}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RECENT_PATIENTS.map((p) => (
              <tr key={p.id} className="hover:bg-gray-50 [&:last-child>td]:border-b-0">
                <td className="border-b border-[#d9dee8] px-3.5 py-2.5 font-bold">{p.name}</td>
                <td className="border-b border-[#d9dee8] px-3.5 py-2.5">{p.location}</td>
                <td className="border-b border-[#d9dee8] px-3.5 py-2.5">{p.service}</td>
                <td className="border-b border-[#d9dee8] px-3.5 py-2.5">{p.discharge}</td>
                <td className="border-b border-[#d9dee8] px-3.5 py-2.5">{p.readiness}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default Dashboard
