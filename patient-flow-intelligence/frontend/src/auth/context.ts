import type Keycloak from 'keycloak-js'
import { createContext, use } from 'react'

export interface KeycloakUser {
  name: string
  username: string
  email: string
  roles: string[]
  scopeType: AccessScopeType | null
  scopes: AccessScope[]
}

export type AccessScopeType = 'ULS' | 'UNIT' | 'BUILDING' | 'FLOOR' | 'SERVICE' | 'WING' | 'WARD'

export interface AccessScope {
  type: AccessScopeType
  scopeId: string
}

export interface KeycloakContextType {
  keycloak: Keycloak
  user: KeycloakUser | null
}

export const KeycloakContext = createContext<KeycloakContextType | null>(null)

export const hasAdminRole = (roles: string[] = []) =>
  roles.some((role) => {
    const r = role.toLowerCase()
    return r === 'admin' || r === 'role_admin'
  })

export const getApplicationUrl = () =>
  `${globalThis.location.origin}${globalThis.location.pathname}`

export const getDashboardUrl = () =>
  `${globalThis.location.origin}/dashboard`

export const useKeycloak = () => {
  const ctx = use(KeycloakContext)
  if (!ctx) throw new Error('useKeycloak must be used inside KeycloakProvider')
  return ctx
}
