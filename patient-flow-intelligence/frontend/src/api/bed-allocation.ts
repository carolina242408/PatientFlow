import axios from 'axios'
import keycloak from '../auth/keycloak'
import { getApplicationUrl } from '../auth/context'

const bedApi = axios.create({
  baseURL: import.meta.env.VITE_BED_ALLOCATION_URL ?? 'http://localhost:8002',
  timeout: 60_000,
})

bedApi.interceptors.request.use(async (config) => {
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

export interface Servico {
  id: string
  code: string
  name: string
}

export interface Suggestion {
  id: string
  bed_id: string
  bed_label: string
  score: number
  justification: string
}

export interface ImminentBed {
  bed_id: string
  bed_label: string
  current_patient_name: string
  expected_discharge_at: string
  hours_until_free: number
}

export interface ManualAdmissionInput {
  full_name: string
  birth_date?: string
  gender?: 'F' | 'M'
  service_id?: string
  priority: number | undefined
  expected_discharge_at?: string
  auto_accept: boolean
}

export interface ManualAdmissionResult {
  encounter_id: string
  patient_id: string
  suggestions: Suggestion[]
  solver_status: string
  accepted_allocation_id: string | null
}

export async function fetchServicos(): Promise<Servico[]> {
  const { data } = await bedApi.get<Servico[]>('/api/v1/servicos')
  return data
}

export async function fetchCamasEmLibertacaoBreve(withinHours = 24): Promise<ImminentBed[]> {
  const { data } = await bedApi.get<ImminentBed[]>('/api/v1/camas-em-libertacao-breve', {
    params: { within_hours: withinHours },
  })
  return data
}

export async function createManualAdmission(
  input: ManualAdmissionInput,
): Promise<ManualAdmissionResult> {
  const { data } = await bedApi.post<ManualAdmissionResult>('/api/v1/manual-admissions', input)
  return data
}

export async function updateSugestaoStatus(
  id: string,
  status: 'ACEITE' | 'REJEITADA',
): Promise<Suggestion> {
  const { data } = await bedApi.patch<Suggestion>(`/api/v1/sugestoes/${id}`, {
    status,
  })
  return data
}
