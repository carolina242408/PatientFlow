import type Keycloak from 'keycloak-js'
import { createContext, use } from 'react'

export interface KeycloakUser {
  name: string
  username: string
  email: string
  roles: string[]
  groups: string[]
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

export const extractGroupsFromToken = (keycloak: Keycloak): string[] => {
  const tokenParsed = keycloak.tokenParsed as Record<string, unknown> | undefined
  const groups = tokenParsed?.groups
  return Array.isArray(groups) ? groups.filter((group): group is string => typeof group === 'string') : []
}


export const buildKeycloakUser = (keycloak: Keycloak): KeycloakUser | null => {
  if (!keycloak.authenticated || !keycloak.tokenParsed) return null

  const token = keycloak.tokenParsed

  return {
    name: token.name || token.preferred_username || '',
    username: token.preferred_username || '',
    email: token.email || '',
    roles: extractRolesFromToken(keycloak),
    groups: extractGroupsFromToken(keycloak),
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
