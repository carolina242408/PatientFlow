import React, { createContext, useContext, useEffect, useState } from 'react';
import Keycloak from 'keycloak-js';
import keycloak from './keycloak';

interface KeycloakContextType {
  keycloak: Keycloak;
  authenticated: boolean;
  initialized: boolean;
  user: {
    name: string;
    username: string;
    email: string;
    roles: string[];
  } | null;
}

export const hasAdminRole = (roles: string[] = []) =>
  roles.some(role => {
    const normalizedRole = role.toUpperCase();
    return normalizedRole === 'ADMIN' || normalizedRole === 'ROLE_ADMIN';
  });

export const getApplicationUrl = () => globalThis.location.href;

const KeycloakContext = createContext<KeycloakContextType | null>(null);

export const KeycloakProvider = ({ children }: { children: React.ReactNode }) => {
  const [initialized, setInitialized] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState<KeycloakContextType['user']>(null);
  const [initializationError, setInitializationError] = useState<string | null>(null);

  useEffect(() => {
    keycloak
      .init({
        onLoad: 'login-required',
        checkLoginIframe: false,
        pkceMethod: 'S256',
        redirectUri: getApplicationUrl(),
      })
      .then(auth => {
        setAuthenticated(auth);
        setInitialized(true);

        if (!auth || !keycloak.tokenParsed) {
          setInitializationError('Keycloak did not authenticate the current session.');
          void keycloak.login({ redirectUri: getApplicationUrl() });
          return;
        }

        const token = keycloak.tokenParsed as any;
        setUser({
          name: token.name || `${token.given_name || ''} ${token.family_name || ''}`.trim() || token.preferred_username,
          username: token.preferred_username,
          email: token.email,
          roles: token.realm_access?.roles || [],
        });

        // Auto-refresh token
        keycloak.onTokenExpired = () => {
          keycloak.updateToken(30).catch(() => keycloak.login({ redirectUri: getApplicationUrl() }));
        };
      })
      .catch(err => {
        console.error('Keycloak init failed', err);
        setInitialized(true);
        setInitializationError('Unable to connect to Keycloak. Check that Keycloak is running on http://localhost:9080.');
      });
  }, []);

  if (!initialized) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontFamily: 'Inter, sans-serif' }}>
        <div>Loading...</div>
      </div>
    );
  }

  if (initializationError) {
    return (
      <div style={{ padding: '2rem', fontFamily: 'Inter, sans-serif' }}>
        <h1>Authentication unavailable</h1>
        <p>{initializationError}</p>
        <button type="button" onClick={() => void keycloak.login({ redirectUri: getApplicationUrl() })}>
          Try Keycloak login again
        </button>
      </div>
    );
  }

  return <KeycloakContext.Provider value={{ keycloak, authenticated, initialized, user }}>{children}</KeycloakContext.Provider>;
};

export const useKeycloak = () => {
  const ctx = useContext(KeycloakContext);
  if (!ctx) throw new Error('useKeycloak must be used inside KeycloakProvider');
  return ctx;
};
