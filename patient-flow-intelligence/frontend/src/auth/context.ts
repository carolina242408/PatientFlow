import type Keycloak from 'keycloak-js'
import { createContext, use } from 'react'

export interface KeycloakUser {
  name: string
  username: string
  email: string
  roles: string[]
  scopeType: string | null
}

export interface KeycloakContextType {
  keycloak: Keycloak
  user: KeycloakUser | null
}

export const KeycloakContext = createContext<KeycloakContextType | null>(null)

export const extractRolesFromToken = (keycloak: Keycloak): string[] => {
  const tokenParsed = keycloak.tokenParsed
  if (!tokenParsed) return []

  const realmRoles: string[] = tokenParsed.realm_access?.roles || []

  return Array.from(new Set([...realmRoles]))
}

export const extractScopeTypeFromToken = (keycloak: Keycloak): string | null => {
  const groups = keycloak.tokenParsed?.groups
  if (!Array.isArray(groups)) return null

  const scopeTypes = new Set<string>()
  for (const group of groups) {
    for (const segment of String(group).split('/')) {
      const match = /^(ULS|UNIT|BUILDING|FLOOR|SERVICE|WING|WARD)_[^/]*__[0-9a-fA-F-]{36}$/.exec(segment)
      if (match) scopeTypes.add(match[1])
    }
  }

  return ['WARD', 'WING', 'SERVICE', 'FLOOR', 'BUILDING', 'UNIT', 'ULS'].find((type) =>
    scopeTypes.has(type),
  ) ?? null
}

export const buildKeycloakUser = (keycloak: Keycloak): KeycloakUser | null => {
  if (!keycloak.authenticated || !keycloak.tokenParsed) return null

  const token = keycloak.tokenParsed

  return {
    name: token.name || token.preferred_username || '',
    username: token.preferred_username || '',
    email: token.email || '',
    roles: extractRolesFromToken(keycloak),
    scopeType: extractScopeTypeFromToken(keycloak),
  }
}

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
