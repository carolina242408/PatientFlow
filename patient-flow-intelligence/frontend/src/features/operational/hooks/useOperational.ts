import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  fetchBeds,
  fetchBed,
  fetchBedMap,
  updateBedStatus,
  fetchPatients,
  fetchPatient,
  fetchEncounters,
  type Scope,
  type BedStatus,
} from '@/api/operational'

// ─── Camas ───────────────────────────────────────────────────────────────────

export function useBeds(scope: Scope = {}, status?: BedStatus, page = 0, size = 200) {
  return useQuery({
    queryKey: ['beds', scope, status, page, size],
    queryFn: () => fetchBeds(scope, status, page, size),
  })
}

export function useBed(id: string) {
  return useQuery({
    queryKey: ['bed', id],
    queryFn: () => fetchBed(id),
    enabled: !!id,
  })
}

export function useBedMap(scope: Scope = {}, status?: BedStatus, page = 0, size = 200) {
  return useQuery({
    queryKey: ['bed-map', scope, status, page, size],
    queryFn: () => fetchBedMap(scope, status, page, size),
  })
}

export function useUpdateBedStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      payload,
    }: {
      id: string
      payload: { status: BedStatus; version: number; reason?: string }
    }) => updateBedStatus(id, payload),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: ['beds'] })
      void qc.invalidateQueries({ queryKey: ['bed', id] })
      void qc.invalidateQueries({ queryKey: ['bed-map'] })
    },
  })
}

// ─── Doentes ─────────────────────────────────────────────────────────────────

export function usePatients(scope: Scope = {}, q?: string, page = 0, size = 200) {
  return useQuery({
    queryKey: ['patients', scope, q, page, size],
    queryFn: () => fetchPatients(scope, q, page, size),
  })
}

export function usePatient(id: string) {
  return useQuery({
    queryKey: ['patient', id],
    queryFn: () => fetchPatient(id),
    enabled: !!id,
  })
}

// ─── Episódios ────────────────────────────────────────────────────────────────

export function useEncounters(
  scope: Scope = {},
  status?: string,
  patientId?: string,
  page = 0,
  size = 200,
) {
  return useQuery({
    queryKey: ['encounters', scope, status, patientId, page, size],
    queryFn: () => fetchEncounters(scope, status, patientId, page, size),
  })
}
