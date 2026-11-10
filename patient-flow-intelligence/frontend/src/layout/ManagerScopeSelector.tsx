import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Building2, Check, ChevronDown, Circle } from 'lucide-react'
import type { OrgNode } from '@/features/lhu-hierarchy/types/tree'

interface ManagerScopeSelectorProps {
  scopes: OrgNode[]
  selectedScope: OrgNode
  onSelect: (scopeId: string) => void
}

const ManagerScopeSelector = ({
  scopes,
  selectedScope,
  onSelect,
}: ManagerScopeSelectorProps) => {
  const { t } = useTranslation()
  const selectorRef = useRef<HTMLDetailsElement>(null)

  if (scopes.length < 2) return null

  const selectScope = (scopeId: string) => {
    onSelect(scopeId)
    if (selectorRef.current) selectorRef.current.open = false
  }

  return (
    <section
      aria-label={t('managerHierarchy.currentContext')}
      className="relative z-10 flex min-h-[68px] items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 sm:gap-4 sm:px-5"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
        <Building2 aria-hidden="true" className="size-5" />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
          {t('managerHierarchy.currentContext')}
        </p>
        <p className="truncate text-sm font-semibold text-slate-900">
          {t(`space.levels.${selectedScope.type}`)} · {selectedScope.name}
        </p>
      </div>

      <details ref={selectorRef} className="group relative ml-auto w-44 shrink-0 sm:w-60">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-left shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-blue-500/30 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0">
            <span className="block truncate text-[9px] font-medium uppercase tracking-wide text-slate-400">
              {t('managerHierarchy.switchContext')}
            </span>
            <span className="block truncate text-xs font-medium text-slate-800">
              {selectedScope.name}
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180"
          />
        </summary>
        <div className="absolute right-0 top-full z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
          <div className="border-b border-slate-100 px-3 py-2">
            <p className="text-xs font-semibold text-slate-800">
              {t('managerHierarchy.selectContext')}
            </p>
            <p className="mt-0.5 text-[10px] text-slate-400">
              {t('managerHierarchy.contextUpdates')}
            </p>
          </div>
          <div className="mt-1 space-y-0.5">
            {scopes.map((scope) => {
              const isSelected = scope.id === selectedScope.id
              return (
                <button
                  key={scope.id}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => selectScope(scope.id)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    isSelected ? 'bg-blue-50' : 'hover:bg-slate-50'
                  }`}
                >
                  {isSelected ? (
                    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white">
                      <Check aria-hidden="true" className="size-3" />
                    </span>
                  ) : (
                    <Circle aria-hidden="true" className="size-4 shrink-0 text-slate-300" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-xs ${isSelected ? 'font-semibold text-blue-700' : 'text-slate-800'}`}>
                      {scope.name}
                    </span>
                    <span className="block truncate text-[10px] text-slate-400">
                      {t(`space.levels.${scope.type}`)}
                    </span>
                  </span>
                  {isSelected && (
                    <span className="rounded-full bg-white px-2 py-0.5 text-[9px] text-blue-600">
                      {t('managerHierarchy.active')}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </details>
    </section>
  )
}

export default ManagerScopeSelector
