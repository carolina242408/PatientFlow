import { useTranslation } from 'react-i18next'
import type { ViewProps } from '../types'
import {
  BED_STATUSES,
  STATUS_STYLES,
  collectBeds,
  countBeds,
} from '../utils'

// Nursery: every room as a card with its beds as coloured chips
const NurseryView = ({ node, open }: ViewProps) => {
  const { t } = useTranslation()
  const rooms = node.children ?? []

  // Totais globais do berçário (soma de todas as camas nos quartos do nó)
  const nodeBeds = collectBeds(node)
  const totals = countBeds(nodeBeds)

  return (
    <>
      <div className="flex justify-end">
        <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
            {t('space.nurseryOccupancy')}
          </p>
          <p className="mt-1 text-xl font-semibold text-slate-900">
            {t('space.bedsOccupied', {
              occupied: totals.occupied,
              total: totals.total,
            })}
          </p>
        </div>
      </div>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {rooms.map((room) => {
          const roomBeds = collectBeds(room)
          const c = countBeds(roomBeds)
          const percent = c.total ? Math.round((c.occupied / c.total) * 100) : 0

          return (
            <button
              key={room.id}
              type="button"
              onClick={() => open(room)}
              className="rounded-2xl border border-gray-200 bg-white p-5 text-left transition-colors hover:border-blue-200 hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    {room.name}
                  </h3>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {t('space.ofOccupied', {
                      occupied: c.occupied,
                      total: c.total,
                    })}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                  {t('space.breakdown.bed.available', {
                    count: c.available,
                  })}
                </span>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {roomBeds.map((bed) => (
                  <span
                    key={bed.id}
                    title={t(`space.status.${bed.status}`)}
                    className={`flex h-8 w-12 items-center justify-center rounded-md border text-xs font-medium ${STATUS_STYLES[bed.status].chip}`}
                  >
                    {bed.number}
                  </span>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-gray-100 pt-3 text-xs text-gray-500">
                <span>{t('space.percentOccupied', { percent })}</span>
                <span>
                  {t('space.breakdown.bed.reserved', { count: c.reserved })}
                </span>
              </div>
            </button>
          )
        })}
      </section>

      <section className="flex flex-col justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-500 sm:flex-row sm:items-center">
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {BED_STATUSES.map((status) => (
            <li key={status} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={`size-3.5 rounded border ${STATUS_STYLES[status].dot}`}
              />
              {t(`space.status.${status}`)}
            </li>
          ))}
        </ul>
        <p className="text-gray-400">{t('space.legendHint')}</p>
      </section>
    </>
  )
}

export default NurseryView