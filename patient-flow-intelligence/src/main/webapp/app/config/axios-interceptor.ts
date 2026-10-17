import axios, { type AxiosError } from 'axios';
import { getApplicationUrl } from './keycloak-provider';
import keycloak from './keycloak';

const TIMEOUT = 1 * 60 * 1000;
axios.defaults.timeout = TIMEOUT;
axios.defaults.baseURL = SERVER_API_URL;

const setupAxiosInterceptors = onUnauthenticated => {
  const onRequestSuccess = async config => {
    if (keycloak.token && keycloak.authenticated) {
      try {
        await keycloak.updateToken(30);
      } catch {
        keycloak.login({ redirectUri: getApplicationUrl() });
        return Promise.reject(new Error('Token refresh failed'));
      }
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${keycloak.token}`;
    }
    return config;
  };

  const onResponseSuccess = response => response;

  const onResponseError = (err: AxiosError) => {
    const status = err.status ?? err.response?.status ?? 0;
    if (status === 401) {
      onUnauthenticated();
    }
    return Promise.reject(err);
  };

  axios.interceptors.request.use(onRequestSuccess);
  axios.interceptors.response.use(onResponseSuccess, onResponseError);
};

export default setupAxiosInterceptors;
