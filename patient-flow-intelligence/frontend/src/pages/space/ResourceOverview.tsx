import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { Badge } from '@/components/Badge'
import { Skeleton } from '@/components/Skeleton'
import type { ViewProps } from './types'
import { collectBeds, countBeds } from './utils'

const ResourceOverview = ({
  node,
  open,
  onPrefetch,
  bedCountsLoading = false,
  bedCountsError = false,
}: ViewProps) => {
  const { t } = useTranslation()
  const beds = node.bedCounts ?? countBeds(collectBeds(node))
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
  ]

  return (
    <>
      <section className="grid grid-cols-1 gap-5 md:grid-cols-1">
        {cards.map((card) => (
          <article key={card.key} className="rounded-2xl border border-gray-200 bg-white p-6">
            <Badge className={`rounded-lg border-0 px-3 py-1.5 text-sm font-medium ${card.badge}`}>
              {t(`space.resources.${card.key}`)}
            </Badge>
            {bedCountsLoading ? (
              <>
                <div className="mt-5 h-10" role="status" aria-label={t('app.loading')}>
                  <Skeleton className="h-9 w-12" />
                </div>
                <Skeleton className="mt-3 h-4 w-56" aria-hidden="true" />
              </>
            ) : bedCountsError ? (
              <p className="mt-5 text-sm text-red-600" role="alert">
                {t('space.bedCountsError')}
              </p>
            ) : (
              <>
                <p className="mt-5 text-4xl font-semibold text-slate-900">{card.total}</p>
                <p className="mt-3 text-sm text-gray-500">
                  {card.parts
                    .map(([part, count]) => t(`space.breakdown.${card.key}.${part}`, { count }))
                    .join(' · ')}
                </p>
              </>
            )}
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
                <Button
                  type="button"
                  variant="link"
                  onClick={() => open(child)}
                  onPointerEnter={() => onPrefetch?.(child)}
                  onFocus={() => onPrefetch?.(child)}
                  className="h-auto p-0 text-lg font-semibold text-blue-600 transition-colors hover:text-blue-700 hover:underline"
                >
                  {child.name}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

export default ResourceOverview