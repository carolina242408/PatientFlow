import axios from 'axios'
import keycloak from '../auth/keycloak'
import { getApplicationUrl } from '../auth/context'

// Instância única: renova o token e mete o Bearer em todos os pedidos a /api.
const api = axios.create({ baseURL: '/api', timeout: 60_000 })

api.interceptors.request.use(async (config) => {
  if (keycloak.token && keycloak.authenticated) {
    try {
      await keycloak.updateToken(30)
    } catch {
      void keycloak.login({ redirectUri: getApplicationUrl() })
      throw new Error('Token refresh failed')
    }
    config.headers.Authorization = `Bearer ${keycloak.token}`
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      void keycloak.login({ redirectUri: getApplicationUrl() })
    }
    return Promise.reject(err)
  },
)

export default api
