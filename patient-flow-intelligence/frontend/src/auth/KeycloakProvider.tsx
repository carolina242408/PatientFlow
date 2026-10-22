import { useEffect, useState, type ReactNode } from 'react'
import { extractRolesFromToken, getApplicationUrl, KeycloakContext, type KeycloakUser } from './context'
import keycloak, { initKeycloak } from './keycloak'

export const KeycloakProvider = ({ children }: { children: ReactNode }) => {
  const [initialized, setInitialized] = useState(false)
  const [user, setUser] = useState<KeycloakUser | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const updateUserState = () => {
      if (!keycloak.tokenParsed) return

      const token = keycloak.tokenParsed as Record<string, any>
      setUser({
        name:
          token.name ||
          `${token.given_name || ''} ${token.family_name || ''}`.trim() ||
          token.preferred_username,
        username: token.preferred_username,
        email: token.email,
        roles: extractRolesFromToken(keycloak),
      })
    }

    initKeycloak()
      .then((auth) => {
        setInitialized(true)
        if (!auth || !keycloak.tokenParsed) {
          setError('Keycloak did not authenticate the current session.')
          void keycloak.login({ redirectUri: getApplicationUrl() })
          return
        }

        updateUserState()

        keycloak.onTokenExpired = () => {
          keycloak
            .updateToken(30)
            .then(() => updateUserState())
            .catch(() => void keycloak.login({ redirectUri: getApplicationUrl() }))
        }
      })
      .catch((err) => {
        console.error('Keycloak init failed', err)
        setInitialized(true)
        setError('Unable to connect to Keycloak. Check that it is running on http://localhost:9080.')
      })
  }, [])

  if (!initialized) {
    return <div className="flex h-screen items-center justify-center font-sans">Loading...</div>
  }

  if (error) {
    return (
      <div className="p-8 font-sans">
        <h1 className="text-xl font-semibold">Authentication unavailable</h1>
        <p className="my-4">{error}</p>
        <button
          type="button"
          className="rounded bg-primary px-4 py-2 text-white hover:bg-primary-dark"
          onClick={() => void keycloak.login({ redirectUri: getApplicationUrl() })}
        >
          Try Keycloak login again
        </button>
      </div>
    )
  }

  return <KeycloakContext value={{ keycloak, user }}>{children}</KeycloakContext>
}