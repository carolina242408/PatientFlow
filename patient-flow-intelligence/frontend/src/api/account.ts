import api from './axios'

export interface AccountData {
  login: string
  name: string | null
  email: string | null
  roles: string[]
}

export async function fetchAccount(): Promise<AccountData> {
  const response = await api.get<AccountData>('/account')
  return response.data
}
