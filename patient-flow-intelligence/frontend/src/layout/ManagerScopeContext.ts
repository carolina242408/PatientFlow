import type { Scope } from '@/api/operational'
import type { OrgNode } from '@/features/lhu-hierarchy/types/tree'
import type { Level } from '@/pages/space/types'

export interface ManagerScopeContext {
  startLevel: Level
  scopes: OrgNode[]
  root?: OrgNode
  scope: Scope
  isPending: boolean
  isError: boolean
  hasMultipleScopes: boolean
  selectScope: (scopeId: string) => void
}

export interface AppOutletContext {
  managerScope: ManagerScopeContext
}
