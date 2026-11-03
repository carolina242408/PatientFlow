import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Armchair, BedSingle, CalendarDays, HeartPulse, RefreshCw, Search } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ResourceType, ViewProps } from '../types'
import { STATUS_STYLES, initialsOf } from '../utils'

const ICONS: Record<ResourceType, LucideIcon> = {
  bed: BedSingle,
  operatingRoom: HeartPulse,
  chair: Armchair,
}

const ALL_RESOURCE_TYPES: ResourceType[] = ['bed', 'operatingRoom', 'chair']

// Room: searchable list of the resources in the room (usually beds)
const RoomView = ({ node, open }: ViewProps) => {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage
  const [query, setQuery] = useState('')
  const [updatedAt, setUpdatedAt] = useState(() => new Date())

  const resources = node.resources ?? []
  const q = query.trim().toLowerCase()

  // Retorna apenas os recursos da sala de um determinado tipo
  const getResourcesByType = (type: ResourceType) =>
    resources.filter((r) => r.type === type)

  // Apenas os tipos existentes nesta sala
  const types = ALL_RESOURCE_TYPES.filter((type) => getResourcesByType(type).length > 0)

  const labelOf = (type: ResourceType, number: number) =>
    t(`space.resourceLabel.${type}`, { number })

  const visible = resources.filter(
    (r) =>
      !q ||
      r.occupant?.name.toLowerCase().includes(q) ||
      labelOf(r.type, r.number).toLowerCase().includes(q),
  )

  const lastUpdate = t('space.lastUpdate', {
    date: new Intl.DateTimeFormat(lang, {
      month: 'long',
      day: '2-digit',
      year: 'numeric',
    }).format(updatedAt),
    time: new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(updatedAt),
  })

  const formatAdmitted = (iso?: string) => {
    if (!iso) return '—'
    const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00` : iso)
    return Number.isNaN(date.getTime())
      ? '—'
      : new Intl.DateTimeFormat(lang, { month: 'short', day: 'numeric' }).format(date)
  }

  // Ex: "6 beds", ou "6 beds, 1 chair" quando a sala possui múltiplos tipos de recursos
  const items = types
    .map((type) => t(`space.counts.${type}`, { count: getResourcesByType(type).length }))
    .join(', ')

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block w-full sm:max-w-xs">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('space.searchPlaceholder')}
            aria-label={t('space.searchPlaceholder')}
            className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-10 pr-4 text-sm text-slate-900 placeholder:text-gray-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
          />
        </label>

        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
          <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0" />
          <span>{lastUpdate}</span>
          <button
            type="button"
            // TODO: refetch the room data here
            onClick={() => setUpdatedAt(new Date())}
            aria-label={t('space.refresh')}
            title={t('space.refresh')}
            className="rounded-md p-1 text-blue-600 transition-colors hover:bg-blue-50"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      <hr className="border-gray-200" />

      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <h2 className="text-sm font-medium text-gray-500">
          {t('space.inRoom', { items, room: node.name })}
        </h2>
        <ul className="flex flex-wrap gap-2">
          {types.flatMap((type) => {
            const resOfType = getResourcesByType(type)
            // Agrupa e conta por estado para este tipo
            const countsByStatus = resOfType.reduce<Record<string, number>>((acc, r) => {
              acc[r.status] = (acc[r.status] ?? 0) + 1
              return acc
            }, {})

            return Object.entries(countsByStatus).map(([status, count]) => {
              const pillStyle =
                STATUS_STYLES[status as keyof typeof STATUS_STYLES]?.pill ??
                'bg-gray-100 text-gray-700'

              return (
                <li
                  key={`${type}-${status}`}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${pillStyle}`}
                >
                  {t(`space.breakdown.${type}.${status}`, { count })}
                </li>
              )
            })
          })}
        </ul>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-10 text-center text-sm text-gray-500">
          {t('space.noResults')}
        </p>
      ) : (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((resource) => {
            const styles = STATUS_STYLES[resource.status as keyof typeof STATUS_STYLES] ?? {
              card: 'border-gray-200 bg-white',
              text: 'text-gray-700',
              chip: 'border-gray-200 bg-gray-50 text-gray-700',
              pill: 'bg-gray-100 text-gray-700',
              dot: 'border-gray-300 bg-gray-100',
            }
            const Icon = ICONS[resource.type]
            return (
              <article
                key={resource.id}
                onClick={() =>
                  open({
                    id: resource.id,
                    level: 'bed',
                    name: `${node.name} - ${labelOf(resource.type, resource.number)}`,
                    resources: [resource],
                  })
                }
                className={`flex cursor-pointer flex-col rounded-2xl border p-4 text-left transition-shadow hover:shadow-md ${styles.card}`}
              >
                <header className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 text-gray-500">
                    <Icon aria-hidden="true" className="h-4 w-4" />
                    <h3 className="font-medium text-slate-700">
                      {labelOf(resource.type, resource.number)}
                    </h3>
                  </div>
                  <span className={`text-sm font-medium ${styles.text}`}>
                    {t(`space.status.${resource.status}`)}
                  </span>
                </header>

                <div className="mt-3 flex min-h-12 items-center">
                  {resource.occupant ? (
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/70 text-xs font-medium text-slate-600"
                      >
                        {initialsOf(resource.occupant.name)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-700">
                          {resource.occupant.name}
                        </p>
                        <p className="truncate text-xs text-gray-500">
                          {resource.occupant.age === undefined
                            ? resource.occupant.diagnosis || '—'
                            : t('space.ageDiagnosis', {
                                age: resource.occupant.age,
                                diagnosis: resource.occupant.diagnosis || '—',
                              })}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500">
                      {t(`space.statusInfo.${resource.status}.title`)}
                    </p>
                  )}
                </div>

                <footer className="mt-3 border-t border-black/5 pt-2.5 text-xs text-gray-500">
                  {resource.occupant
                    ? t('space.admitted', { date: formatAdmitted(resource.occupant.admitted) })
                    : t(`space.statusInfo.${resource.status}.footer`)}
                </footer>
              </article>
            )
          })}
        </section>
      )}
    </>
  )
}

export default RoomView