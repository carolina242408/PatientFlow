import api from './axios'

// ─── Tipos que espelham os DTOs do backend ───────────────────────────────────

export interface PageResult<T> {
  content: T[]
  page: number
  size: number
  totalElements: number
  totalPages: number
}

export interface Scope {
  ulsId?: string
  unitId?: string
  buildingId?: string
  floorId?: string
  serviceId?: string
  wingId?: string
  wardId?: string
  roomId?: string
}

export type BedStatus = 'AVAILABLE' | 'OCCUPIED' | 'BLOCKED' | 'RESERVED' | 'CLEANING'

export interface BedView {
  id: string
  code: string
  status: BedStatus
  reason: string | null
  version: number
  ulsId: string
  ulsName: string
  unitId: string
  unitName: string
  serviceId: string
  serviceName: string
  wardId: string
  wardCode: string
  roomId: string
  roomCode: string
  patientId: string | null
  patientName: string | null
  patientBirthDate: string | null
  encounterId: string | null
  admittedAt: string | null
  expectedDischargeAt: string | null
  clinicalDischargeAt: string | null
}

export interface BedMap {
  beds: PageResult<BedView>
  counts: Record<BedStatus, number>
}

export interface PatientView {
  id: string
  snsNumber: string
  fullName: string
  hospitalNumber: string | null
  birthDate: string | null
  gender: string
  version: number
}

export interface EncounterView {
  id: string
  visitNumber: string
  patientId: string
  patientName: string
  status: string
  admittedAt: string | null
  expectedDischargeAt: string | null
  clinicalDischargeAt: string | null
  administrativeDischargeAt: string | null
  serviceId: string
  serviceName: string
  bedId: string | null
  bedCode: string | null
  wardId: string | null
  wardCode: string | null
  version: number
}

export interface OccupancyRow {
  id: string
  name: string
  occupied: number
  capacity: number
  occupancyPercent: number | null
}

export interface Occupancy {
  asOf: string
  scope: Scope
  criticalOccupancyPercent: number
  services: OccupancyRow[]
  units: OccupancyRow[]
  wings: OccupancyRow[]
}

export interface Indicators {
  asOf: string
  beds: {
    total: number
    capacity: number
    available: number
    occupied: number
    blocked: number
    cleaning: number
    occupancyPercent: number | null
  }
  stays: {
    expectedDischarges24h: number
    expectedDischarges48h: number
    averageLengthOfStayDays: number | null
  }
  waiting: { pending: number }
  thresholds: { occupancyCriticalPercent: number }
}

export interface ForecastHorizon {
  hours: number
  expectedAdmissions: number
  expectedDischarges: number
  projectedOccupied: number
  occupancyPercent: number | null
  unmetDemand: number
}

export interface OccupancyForecast {
  services: PageResult<{
    serviceName: string
    input: { capacity: number; occupied: number }
    horizons: ForecastHorizon[]
    historyQuality: string
  }>
}

export interface DischargeForecastDay {
  date: string
  dayOfWeek: number
  expectedDischarges: number
}

// ─── Funções de acesso à API ──────────────────────────────────────────────────

/** Occupancy rows aggregated by service, unit, and wing within the authorized scope. */
export async function fetchOccupancy(scope: Scope = {}): Promise<Occupancy> {
  const { data } = await api.get<Occupancy>('/analytics/occupancy', { params: scope })
  return data
}

export async function fetchIndicators(scope: Scope = {}): Promise<Indicators> {
  const { data } = await api.get<Indicators>('/analytics/indicators', { params: scope })
  return data
}

export async function fetchOccupancyForecast(
  scope: Scope = {},
  page = 0,
  size = 100,
): Promise<OccupancyForecast> {
  const { data } = await api.get<OccupancyForecast>('/analytics/occupancy-forecast', {
    params: { ...scope, page, size },
  })
  return data
}

export async function fetchDischargeForecast(scope: Scope = {}): Promise<DischargeForecastDay[]> {
  const { data } = await api.get<DischargeForecastDay[]>('/analytics/discharge-forecast', {
    params: scope,
  })
  return data
}

/** Lista de camas, opcionalmente filtrada por escopo e/ou estado */
export async function fetchBeds(
  scope: Scope = {},
  status?: BedStatus,
  page = 0,
  size = 200,
): Promise<PageResult<BedView>> {
  const { data } = await api.get<PageResult<BedView>>('/beds', {
    params: { ...scope, ...(status ? { status } : {}), page, size },
  })
  return data
}

/** Mapa de camas com contagens por estado */
export async function fetchBedMap(
  scope: Scope = {},
  status?: BedStatus,
  page = 0,
  size = 200,
): Promise<BedMap> {
  const { data } = await api.get<BedMap>('/bed-map', {
    params: { ...scope, ...(status ? { status } : {}), page, size },
  })
  return data
}

/** Uma cama pelo ID */
export async function fetchBed(id: string): Promise<BedView> {
  const { data } = await api.get<BedView>(`/beds/${id}`)
  return data
}

/** Atualiza o estado de uma cama */
export async function updateBedStatus(
  id: string,
  payload: { status: BedStatus; version: number; reason?: string },
): Promise<BedView> {
  const { data } = await api.put<BedView>(`/beds/${id}/status`, payload)
  return data
}

/** Lista de doentes, opcionalmente filtrada por escopo */
export async function fetchPatients(
  scope: Scope = {},
  q?: string,
  page = 0,
  size = 200,
): Promise<PageResult<PatientView>> {
  const { data } = await api.get<PageResult<PatientView>>('/patients', {
    params: { ...scope, ...(q ? { q } : {}), page, size },
  })
  return data
}

/** Um doente pelo ID */
export async function fetchPatient(id: string): Promise<PatientView> {
  const { data } = await api.get<PatientView>(`/patients/${id}`)
  return data
}

/** Cria um doente */
export async function createPatient(input: {
  snsNumber: string
  fullName: string
  hospitalNumber?: string
  birthDate?: string
  gender?: string
}): Promise<PatientView> {
  const { data } = await api.post<PatientView>('/patients', input)
  return data
}

/** Atualiza um doente */
export async function updatePatient(
  id: string,
  input: {
    version: number
    fullName: string
    hospitalNumber?: string
    birthDate?: string
    gender?: string
  },
): Promise<PatientView> {
  const { data } = await api.put<PatientView>(`/patients/${id}`, input)
  return data
}

/** Lista de episódios, opcionalmente filtrada por escopo e/ou estado */
export async function fetchEncounters(
  scope: Scope = {},
  status?: string,
  patientId?: string,
  page = 0,
  size = 200,
): Promise<PageResult<EncounterView>> {
  const { data } = await api.get<PageResult<EncounterView>>('/encounters', {
    params: {
      ...scope,
      ...(status ? { status } : {}),
      ...(patientId ? { patientId } : {}),
      page,
      size,
    },
  })
  return data
}

/** Um episódio pelo ID */
export async function fetchEncounter(id: string): Promise<EncounterView> {
  const { data } = await api.get<EncounterView>(`/encounters/${id}`)
  return data
}
