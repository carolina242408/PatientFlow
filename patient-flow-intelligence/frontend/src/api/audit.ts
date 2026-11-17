import api from './axios'

export type AuditEventType = 'LOGIN' | 'LOGOUT' | 'PAGE_VIEW' | 'CONFIG_CHANGE'

export interface CreateAuditEventInput {
  eventType: 'LOGIN' | 'LOGOUT' | 'PAGE_VIEW'
  pagePath: string
  pageTitle?: string
  clientOrigin?: string
  details?: Record<string, unknown>
}

export interface AuditLogEntry {
  id: string
  occurredAt: string
  eventType: AuditEventType
  userId: string
  username: string
  userFullName: string | null
  userEmail: string | null
  userRoles: string[]
  pagePath: string
  pageTitle: string | null
  ipAddress: string
  clientOrigin: string | null
  userAgent: string | null
  sessionId: string | null
  details: Record<string, unknown>
  expiresAt: string | null
}

export interface AuditLogFilter {
  search?: string
  eventType?: string
  role?: string
  pagePath?: string
  username?: string
  ipAddress?: string
  from?: string
  to?: string
  page?: number
  size?: number
}

export interface AuditLogPageResponse {
  items: AuditLogEntry[]
  totalElements: number
  totalPages: number
  page: number
  size: number
}

export interface PageVisitStat {
  pagePath: string
  pageTitle: string | null
  visitCount: number
}

export interface AuditRetentionInfo {
  ttlDays: number
  defaultTtlDays: number
  minTtlDays: number
  maxTtlDays: number
  cleanupCron: string
  updatedAt: string
  updatedBy: string
  updatedByName: string | null
  lastCleanupAt: string | null
  lastCleanupDeletedCount: number
  totalStoredLogs: number
  oldestLogAt: string | null
  newestLogAt: string | null
  timescaleEnabled: boolean
  schemaName: string
  tableName: string
}

export interface RetentionPreviewResponse {
  currentTtlDays: number
  candidateTtlDays: number
  recordsToBeDeleted: number
  recordsRemaining: number
  cutoffTimestamp: string
}

export interface UpdateRetentionResponse {
  retention: AuditRetentionInfo
  deletedCount: number
}

export interface AuditStatsResponse {
  totalEvents: number
  loginCount: number
  logoutCount: number
  pageViewCount: number
  configChangeCount: number
  uniqueUsers: number
  uniqueIps: number
  topPages: PageVisitStat[]
  distinctPages: string[]
  distinctUsers: string[]
  retention: AuditRetentionInfo
}

export function getClientOriginMetadata(): {
  clientOrigin: string
  details: Record<string, unknown>
} {
  const timeZone =
    typeof Intl !== 'undefined'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : 'UTC'
  const language = typeof navigator !== 'undefined' ? navigator.language : 'en'
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost'
  const viewport =
    typeof window !== 'undefined'
      ? `${window.innerWidth}x${window.innerHeight}`
      : 'unknown'

  return {
    clientOrigin: `${host} (${timeZone})`,
    details: {
      timeZone,
      language,
      host,
      viewport,
      referrer: typeof document !== 'undefined' ? document.referrer || null : null,
    },
  }
}

export async function recordAuditEvent(input: CreateAuditEventInput): Promise<AuditLogEntry | null> {
  try {
    const meta = getClientOriginMetadata()
    const response = await api.post<AuditLogEntry>('/audit/events', {
      ...input,
      clientOrigin: input.clientOrigin ?? meta.clientOrigin,
      details: {
        ...meta.details,
        ...(input.details ?? {}),
      },
    })
    return response.data
  } catch {
    // Non-blocking: audit telemetry should never break navigation
    return null
  }
}

export async function fetchAuditLogs(filter: AuditLogFilter): Promise<AuditLogPageResponse> {
  const params: Record<string, string | number> = {
    page: filter.page ?? 0,
    size: filter.size ?? 25,
  }
  if (filter.search?.trim()) params.search = filter.search.trim()
  if (filter.eventType && filter.eventType !== 'ALL') params.eventType = filter.eventType
  if (filter.role && filter.role !== 'ALL') params.role = filter.role
  if (filter.pagePath && filter.pagePath !== 'ALL') params.pagePath = filter.pagePath
  if (filter.username && filter.username !== 'ALL') params.username = filter.username
  if (filter.ipAddress?.trim()) params.ipAddress = filter.ipAddress.trim()
  if (filter.from) params.from = filter.from
  if (filter.to) params.to = filter.to

  const response = await api.get<AuditLogPageResponse>('/audit/logs', { params })
  return response.data
}

export async function fetchAuditStats(
  filter: Omit<AuditLogFilter, 'page' | 'size'> = {},
): Promise<AuditStatsResponse> {
  const params: Record<string, string> = {}
  if (filter.search?.trim()) params.search = filter.search.trim()
  if (filter.eventType && filter.eventType !== 'ALL') params.eventType = filter.eventType
  if (filter.role && filter.role !== 'ALL') params.role = filter.role
  if (filter.pagePath && filter.pagePath !== 'ALL') params.pagePath = filter.pagePath
  if (filter.username && filter.username !== 'ALL') params.username = filter.username
  if (filter.ipAddress?.trim()) params.ipAddress = filter.ipAddress.trim()
  if (filter.from) params.from = filter.from
  if (filter.to) params.to = filter.to

  const response = await api.get<AuditStatsResponse>('/audit/stats', { params })
  return response.data
}

export async function fetchAuditRetention(): Promise<AuditRetentionInfo> {
  const response = await api.get<AuditRetentionInfo>('/audit/retention')
  return response.data
}

export async function previewAuditRetention(ttlDays: number): Promise<RetentionPreviewResponse> {
  const response = await api.get<RetentionPreviewResponse>('/audit/retention/preview', {
    params: { ttlDays },
  })
  return response.data
}

export async function updateAuditRetention(
  ttlDays: number,
  confirmed: boolean,
): Promise<UpdateRetentionResponse> {
  const response = await api.put<UpdateRetentionResponse>('/audit/retention', {
    ttlDays,
    confirmed,
  })
  return response.data
}

export async function runAuditCleanupNow(): Promise<UpdateRetentionResponse> {
  const response = await api.post<UpdateRetentionResponse>('/audit/retention/cleanup')
  return response.data
}
