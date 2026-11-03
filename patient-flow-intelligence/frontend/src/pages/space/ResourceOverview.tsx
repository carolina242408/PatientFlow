import { useTranslation } from 'react-i18next'
import type { ViewProps } from './types'
import { collectBeds, countBeds, sumResources } from './utils'

// Resource cards (beds, operating rooms, treatment chairs) plus the
// "Continue to…" list. LHU, unit, building and floor all share this layout.
const ResourceOverview = ({ node, open }: ViewProps) => {
  const { t } = useTranslation()
  const beds = node.bedCounts ?? countBeds(collectBeds(node))
  const res = sumResources(node)
  const nextLevel = node?.children?.[0]?.level

  const cards = [
    {
      key: 'beds',
      total: beds.total,
      badge: 'bg-purple-100 text-purple-700',
      parts: [
        ['occupied', beds.occupied],
        ['available', beds.available],
        ['reserved', beds.reserved],
      ] as const,
    },
    {
      key: 'operatingRoom',
      total:
        res.operatingRoom.inUse +
        res.operatingRoom.available +
        res.operatingRoom.cleaning,
      badge: 'bg-emerald-100 text-emerald-700',
      parts: [
        ['inUse', res.operatingRoom.inUse],
        ['available', res.operatingRoom.available],
        ['cleaning', res.operatingRoom.cleaning],
      ] as const,
    },
    {
      key: 'chairs',
      total: res.chair.occupied + res.chair.available,
      badge: 'bg-blue-100 text-blue-700',
      parts: [
        ['occupied', res.chair.occupied],
        ['available', res.chair.available],
      ] as const,
    },
  ]

  return (
    <>
      <section className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {cards.map((card) => (
          <article key={card.key} className="rounded-2xl border border-gray-200 bg-white p-6">
            <span
              className={`inline-block rounded-lg px-3 py-1.5 text-sm font-medium ${card.badge}`}
            >
              {t(`space.resources.${card.key}`)}
            </span>
            <p className="mt-5 text-4xl font-semibold text-slate-900">{card.total}</p>
            <p className="mt-3 text-sm text-gray-500">
              {card.parts
                .map(([part, count]) => t(`space.breakdown.${card.key}.${part}`, { count }))
                .join(' · ')}
            </p>
          </article>
        ))}
      </section>

      {nextLevel && (
        <section className="rounded-2xl border border-gray-200 bg-white p-6">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
            {t(`space.continue.${nextLevel}`)}
          </p>
          <ul className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
            {(node.children ?? []).map((child) => (
              <li key={child.id}>
                <button
                  type="button"
                  onClick={() => open(child)}
                  className="text-lg font-semibold text-blue-600 transition-colors hover:text-blue-700 hover:underline"
                >
                  {child.name}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

export default ResourceOverview