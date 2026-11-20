import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/components/Button'
import { fetchMyAccess } from '@/api/access'
import { getApplicationUrl, KeycloakContext, type KeycloakUser } from './context'
import keycloak, { initKeycloak } from './keycloak'

export const KeycloakProvider = ({ children }: { children: ReactNode }) => {
  const [initialized, setInitialized] = useState(false)
  const [user, setUser] = useState<KeycloakUser | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadUser = useCallback(async () => {
    if (!keycloak.tokenParsed) return

    const token = keycloak.tokenParsed
    const access = await fetchMyAccess()
    setUser({
      name:
        token.name ||
        `${token.given_name || ''} ${token.family_name || ''}`.trim() ||
        token.preferred_username ||
        '',
      username: token.preferred_username || '',
      email: token.email || '',
      roles: access.roles,
      scopeType: access.scopes[0]?.type ?? null,
      scopes: access.scopes,
    })
    setError(null)
  }, [])

  useEffect(() => {
    let active = true
    const loadCurrentUser = async () => {
    try {
      await loadUser()
    } catch (err) {
      console.error('Failed to load user access from backend', err)
      if (active) setError('Unable to load your roles and organizational scope from the backend.')
    }
    }

    initKeycloak()
    .then(async (auth) => {
      if (!auth || !keycloak.tokenParsed) {
        if (active) {
          setInitialized(true)
          setError('Keycloak did not authenticate the current session.')
        }
        void keycloak.login({ redirectUri: getApplicationUrl() })
        return
      }

      await loadCurrentUser()
      if (active) setInitialized(true)

      keycloak.onTokenExpired = () => {
        keycloak
          .updateToken(30)
          .then(() =>
            loadUser().catch((err) => {
              console.error('Failed to refresh user access from backend', err)
              if (active) {
                setError('Unable to refresh your roles and organizational scope from the backend.')
              }
            }),
          )
          .catch(() => void keycloak.login({ redirectUri: getApplicationUrl() }))
      }
    })
    .catch((err) => {
      console.error('Keycloak init failed', err)
      if (active) {
        setInitialized(true)
        setError('Unable to connect to Keycloak. Check that it is running on https://localhost:9080.')
      }
    })
    return () => {
    active = false
    }
  }, [loadUser])

  if (!initialized) {
    return <div className="flex h-screen items-center justify-center font-sans">Loading...</div>
  }

  if (error) {
    return (
      <div className="p-8 font-sans">
        <h1 className="text-xl font-semibold">Authentication unavailable</h1>
        <p className="my-4">{error}</p>
        <Button
          type="button"
          className="rounded bg-primary px-4 py-2 text-white hover:bg-primary-dark"
          onClick={() =>
            void loadUser().catch((err) => {
              console.error('Failed to retry loading user access', err)
              setError('Unable to load your roles and organizational scope from the backend.')
            })
          }
        >
          Retry
        </Button>
      </div>
    )
  }

  return <KeycloakContext value={{ keycloak, user }}>{children}</KeycloakContext>
}