import api from './axios'
import type { AccessScope } from '../auth/context'

export interface AccessSummary {
  subject: string
  roles: string[]
  administrator: boolean
  scopes: AccessScope[]
}

export async function fetchMyAccess(): Promise<AccessSummary> {
  const response = await api.get<AccessSummary>('/access/me')
  return response.data
}
