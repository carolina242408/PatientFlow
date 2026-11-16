import api from './axios'

export interface EventTicketResponse {
  ticket: string
  expiresAt: string
  path: string
}

export type DomainEventType =
  | 'RESYNC_REQUIRED'
  | 'BED_STATUS_CHANGED'
  | 'PATIENT_ADMITTED'
  | 'PATIENT_DISCHARGED'
  | 'PATIENT_TRANSFERRED'
  | 'PATIENT_CREATED'
  | 'PATIENT_UPDATED'
  | 'DISCHARGE_PLAN_CHANGED'
  | 'CLINICAL_DISCHARGE_RECORDED'
  | 'ADMISSION_REQUEST_CREATED'
  | 'ADMISSION_REQUEST_UPDATED'
  | 'ADMISSION_REQUEST_ADMITTED'
  | 'ADMISSION_REQUEST_CANCELLED'
  | 'HIERARCHY_CREATED'
  | 'HIERARCHY_UPDATED'
  | 'HIERARCHY_DELETED'
  | 'ACCESS_CHANGED'

export interface DomainEventMessage {
  id: string
  type: DomainEventType
  occurredAt: string
  resourceType: string
  resourceId?: string | null
}

export async function requestEventTicket(): Promise<EventTicketResponse> {
  const { data } = await api.post<EventTicketResponse>('/events/tickets')
  return data
}
