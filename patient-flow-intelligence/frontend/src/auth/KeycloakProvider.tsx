import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/Button'
import { fetchMyAccess } from '@/api/access'
import { recordAuditEvent } from '@/api/audit'
import { getApplicationUrl, KeycloakContext, type KeycloakUser } from './context'
import keycloak, { initKeycloak } from './keycloak'

export const KeycloakProvider = ({ children }: { children: ReactNode }) => {
  const { t } = useTranslation()
  const [initialized, setInitialized] = useState(false)
  const [user, setUser] = useState<KeycloakUser | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadUser = useCallback(async () => {
    if (!keycloak.tokenParsed) return

    const token = keycloak.tokenParsed as Record<string, any>
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

    const sessionId =
      (typeof token.sid === 'string' && token.sid) ||
      (typeof token.session_state === 'string' && token.session_state) ||
      token.sub ||
      'session'
    const storageKey = `pfi_audit_login_${sessionId}`
    if (typeof sessionStorage !== 'undefined' && !sessionStorage.getItem(storageKey)) {
      sessionStorage.setItem(storageKey, new Date().toISOString())
      void recordAuditEvent({
        eventType: 'LOGIN',
        pagePath: window.location.pathname || '/',
        pageTitle: 'User Login',
        details: {
          authMethod: 'Keycloak OIDC',
          roles: access.roles,
        },
      })
    }
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
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fafafa] px-6 font-sans">
        <div role="status" aria-live="polite" className="flex flex-col items-center text-center">
          <img src="/assets/app-logo.png" alt="" className="h-16 w-16 object-contain" />
          <h1 className="mt-4 text-xl font-semibold">{t('app.name')}</h1>
          <LoaderCircle aria-hidden="true" className="mt-8 h-6 w-6 animate-spin text-blue-600 motion-reduce:animate-none" />
          <p className="mt-3 text-sm text-gray-500">{t('app.loading')}</p>
        </div>
      </main>
    )
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