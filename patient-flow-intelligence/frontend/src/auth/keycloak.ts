import Keycloak from 'keycloak-js'
import { getDashboardUrl } from './context'

const keycloak = new Keycloak({
  url: 'http://localhost:9080',
  realm: 'patientflow',
  clientId: 'web_app',
})

let initPromise: Promise<boolean> | undefined

// keycloak-js só aceita um init(); em dev o StrictMode monta o provider duas vezes.
export const initKeycloak = () =>
  (initPromise ??= keycloak.init({
    onLoad: 'login-required',
    checkLoginIframe: false,
    pkceMethod: 'S256',
    redirectUri: getDashboardUrl(),
  }))

export default keycloak
