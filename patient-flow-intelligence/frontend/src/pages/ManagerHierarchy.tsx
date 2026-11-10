import { useTranslation } from 'react-i18next'
import { useOutletContext } from 'react-router'
import type { AppOutletContext } from '@/layout/ManagerScopeContext'
import ManagerScopeSelector from '@/layout/ManagerScopeSelector'
import SpaceExplorer from './space/SpaceExplorer'

const ManagerHierarchy = () => {
  const { t } = useTranslation()
  const { managerScope } = useOutletContext<AppOutletContext>()

  if (managerScope.isPending) return <div className="p-6">{t('managerHierarchy.loading')}</div>
  if (managerScope.isError) return <div className="p-6 text-red-600">{t('lhuHierarchy.error')}</div>
  if (!managerScope.root) return <div className="p-6">{t('lhuHierarchy.noData')}</div>

  return (
    <div className="flex flex-col gap-5 p-6">
      {managerScope.hasMultipleScopes && (
        <ManagerScopeSelector
          scopes={managerScope.scopes}
          selectedScope={managerScope.root}
          onSelect={managerScope.selectScope}
        />
      )}
      <SpaceExplorer
        key={managerScope.root.id}
        startLevel={managerScope.startLevel}
        initialLevel={managerScope.startLevel}
        rootId={managerScope.root.id}
      />
    </div>
  )
}

export default ManagerHierarchy