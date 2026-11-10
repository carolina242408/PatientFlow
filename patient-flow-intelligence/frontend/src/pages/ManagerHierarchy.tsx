import { useKeycloak, type AccessScopeType } from '@/auth/context'
import SpaceExplorer from './space/SpaceExplorer'
import type { Level } from './space/types'

const SCOPE_LEVELS: Record<AccessScopeType, Level> = {
  ULS: 'lhu',
  UNIT: 'unit',
  BUILDING: 'building',
  FLOOR: 'floor',
  SERVICE: 'service',
  WING: 'wing',
  WARD: 'ward',
}

const ManagerHierarchy = () => {
  const { user } = useKeycloak()
  const startLevel = (user?.scopeType && SCOPE_LEVELS[user.scopeType]) || 'lhu'

  return (
    <div className="p-6">
      <SpaceExplorer startLevel={startLevel} initialLevel={startLevel} />
    </div>
  )
}

export default ManagerHierarchy