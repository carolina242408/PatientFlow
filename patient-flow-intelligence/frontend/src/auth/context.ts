import type Keycloak from 'keycloak-js'
import { createContext, use } from 'react'

export interface KeycloakUser {
  name: string
  username: string
  email: string
  roles: string[]
}

export interface KeycloakContextType {
  keycloak: Keycloak
  user: KeycloakUser | null
}

export const KeycloakContext = createContext<KeycloakContextType | null>(null)

export const hasAdminRole = (roles: string[] = []) =>
  roles.some((role) => {
    const r = role.toUpperCase()
    return r === 'ADMIN' || r === 'ROLE_ADMIN'
  })

export const getApplicationUrl = () => globalThis.location.href

export const useKeycloak = () => {
  const ctx = use(KeycloakContext)
  if (!ctx) throw new Error('useKeycloak must be used inside KeycloakProvider')
  return ctx
}
