import api from './axios'
import type { AccessScope, AccessScopeType } from '../auth/context'

type BackendAccessScopeType = 'ULS' | Exclude<AccessScopeType, 'LHU'>

interface BackendAccessScope {
  type: BackendAccessScopeType
  scopeId: string
}

interface BackendAccessSummary {
  subject: string
  roles: string[]
  administrator: boolean
  scopes: BackendAccessScope[]
}

export interface AccessSummary {
  subject: string
  roles: string[]
  administrator: boolean
  scopes: AccessScope[]
}

export async function fetchMyAccess(): Promise<AccessSummary> {
  const response = await api.get<BackendAccessSummary>('/access/me')
  return {
    ...response.data,
    scopes: response.data.scopes.map((scope) => ({
      ...scope,
      type: scope.type === 'ULS' ? 'LHU' : scope.type,
    })),
  }
}
