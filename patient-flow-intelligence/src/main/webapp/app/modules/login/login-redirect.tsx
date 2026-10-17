import { useEffect } from 'react';
import { useLocation } from 'react-router';

import { useKeycloak } from 'app/config/keycloak-provider';
import { REDIRECT_URL } from 'app/shared/util/url-utils';

export const LoginRedirect = () => {
  const pageLocation = useLocation();
  const { keycloak } = useKeycloak();

  useEffect(() => {
    const redirectPath = (pageLocation.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/dashboard';
    localStorage.setItem(REDIRECT_URL, redirectPath);
    void keycloak.login({
      redirectUri: `${globalThis.location.origin}${redirectPath}`,
    });
  }, [keycloak, pageLocation.state]);

  return null;
};

export default LoginRedirect;
