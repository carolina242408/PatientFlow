import { useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Resource {
  key: 'beds' | 'rooms' | 'chairs'
  total: number
  breakdown: { key: string; count: number }[]
  badgeClass: string
}

// Dados de exemplo
const LHU_NAME = 'Central LHU'
const NEXT_UNIT = 'Hospital Unit'

const RESOURCES: Resource[] = [
  {
    key: 'beds',
    total: 48,
    badgeClass: 'bg-purple-100 text-purple-700',
    breakdown: [
      { key: 'occupied', count: 34 },
      { key: 'available', count: 10 },
      { key: 'reserved', count: 4 },
    ],
  },
  {
    key: 'rooms',
    total: 6,
    badgeClass: 'bg-emerald-100 text-emerald-700',
    breakdown: [
      { key: 'inUse', count: 3 },
      { key: 'available', count: 2 },
      { key: 'cleaning', count: 1 },
    ],
  },
  {
    key: 'chairs',
    total: 18,
    badgeClass: 'bg-blue-100 text-blue-700',
    breakdown: [
      { key: 'occupied', count: 11 },
      { key: 'available', count: 7 },
    ],
  },
]

const Lhu = () => {
  const { t } = useTranslation()
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-5">
      <nav
        aria-label="Breadcrumb"
        className="rounded-2xl border border-gray-200 bg-white p-4"
      >
        <ol className="flex items-center gap-2">
          <li className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-medium">
            <span className="text-blue-400">{t('lhu.level')}</span>
            <span className="mx-2 text-gray-300">·</span>
            <span className="text-blue-700">{LHU_NAME}</span>
          </li>
        </ol>
      </nav>

      {/* Resource cards */}
      <section className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {RESOURCES.map((resource) => (
          <article
            key={resource.key}
            className="rounded-2xl border border-gray-200 bg-white p-6"
          >
            <span
              className={`inline-block rounded-lg px-3 py-1.5 text-sm font-medium ${resource.badgeClass}`}
            >
              {t(`lhu.resources.${resource.key}`)}
            </span>
            <p className="mt-5 text-4xl font-semibold text-slate-900">{resource.total}</p>
            <p className="mt-3 text-sm text-gray-500">
              {resource.breakdown
                .map(({ key, count }) => t(`lhu.status.${key}`, { count }))
                .join(' · ')}
            </p>
          </article>
        ))}
      </section>

      {/* Continue to unit */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
          {t('lhu.continue')}
        </p>
        <button
          type="button"
          onClick={() => setSelectedUnit(NEXT_UNIT)}
          className="mt-3 text-lg font-semibold text-blue-600 transition-colors hover:text-blue-700 hover:underline"
        >
          {NEXT_UNIT}
        </button>
        {selectedUnit && (
          <p className="mt-2 text-sm text-gray-500">
            {t('lhu.selected', { unit: selectedUnit })}
          </p>
        )}
      </section>
    </div>
  )
}

export default Lhu