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
  bed_id: string
  bed_label: string
  score: number
  justification: string
}

export interface ReallocationSuggestion {
  new_patient_encounter_id: string
  from_bed_id: string
  from_bed_label: string
  displaced_encounter_id: string
  displaced_patient_name: string
  to_bed_id: string | null
  to_bed_label: string | null
  target_is_ward_transfer: boolean
  score_combined: number
  justification: string
  room_eviction_score: number
  displaced_priority: number
  displaced_original_score: number
  warning: {
    code: 'WARD_TRANSFER' | 'NO_BED_AVAILABLE'
    message: string
    affected_patients: string[]
  } | null
}

export interface RoomEvictionEntry {
  room_id: string
  room_label: string
  eviction_score: number
  occupant_scores: [string, number][]
  is_isolation_room: boolean
}

export interface DebugEntry {
  encounter_id: string
  patient_name: string
  bed_id: string
  bed_label: string
  score_breakdown: Record<string, number>
  total_score: number
}

export interface BedComparison {
  bed_id: string
  bed_label: string
  candidates: DebugEntry[]
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
  isolation: boolean
  service_id?: string
  priority: number | undefined
  expected_discharge_at?: string
}

export interface ManualAdmissionResult {
  encounter_id: string
  patient_id: string
  suggestions: Suggestion[]
  reallocations: ReallocationSuggestion[]
  comparisons: BedComparison[]
  room_eviction_ranking: RoomEvictionEntry[]
  solver_status: string
  debug_enabled: boolean
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
  debug = false,
): Promise<ManualAdmissionResult> {
  const { data } = await bedApi.post<ManualAdmissionResult>(
    '/api/v1/manual-admissions',
    input,
    { params: { debug } },
  )
  return data
}
