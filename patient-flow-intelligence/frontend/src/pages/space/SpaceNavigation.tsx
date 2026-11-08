import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import type { SpaceNode } from './types'

interface SpaceNavigationProps {
  crumbs: SpaceNode[]
  onSelect: (index: number) => void
}

const SpaceNavigation = ({ crumbs, onSelect }: SpaceNavigationProps) => {
  const { t } = useTranslation()

  return (
    <nav
      aria-label={t('space.breadcrumb')}
      className="overflow-x-auto rounded-2xl border border-gray-200 bg-white p-3"
    >
      <ol className="flex items-center gap-2 whitespace-nowrap">
        {crumbs.map((node, i) => {
          const isLast = i === crumbs.length - 1

          return (
            <li key={node.id} className="flex items-center gap-2">
              {i > 0 && (
                <span aria-hidden="true" className="text-gray-300">
                  /
                </span>
              )}
              <Button
                type="button"
                variant="ghost"
                disabled={isLast}
                aria-current={isLast ? 'page' : undefined}
                onClick={() => onSelect(i)}
                className={`rounded-lg px-3 py-2 text-xs transition-colors ${
                  isLast ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}
              >
                <span className={isLast ? 'text-blue-400' : 'text-gray-400'}>
                  {t(`space.levels.${node.level}`)}
                </span>
                <span aria-hidden="true" className="mx-1.5 text-gray-300">
                  ·
                </span>
                <span className={`font-medium ${isLast ? 'text-blue-700' : 'text-slate-700'}`}>
                  {node.name}
                </span>
              </Button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

export default SpaceNavigation