import type { Resource, SpaceNode } from './types'

export type BedStatus = 'occupied' | 'available' | 'reserved'

export interface Bed {
  id: string
  number: number
  status: BedStatus
  occupant?: Resource['occupant']
}

export interface ResourcesCount {
  operatingRoom: {
    inUse: number
    available: number
    cleaning: number
  }
  chair: {
    occupied: number
    available: number
  }
}


const EMPTY_RESOURCES: ResourcesCount = {
 operatingRoom: { inUse: 0, available: 0, cleaning: 0 },
 chair: { occupied: 0, available: 0 },
}

/**
 * Soma recursivamente as salas de operação (operatingRoom) e cadeiras (chair)
 * presentes no nó atual e em todos os seus descendentes.
 */
export const sumResources = (node?: SpaceNode | null): ResourcesCount => {
  if (!node) return EMPTY_RESOURCES
  // Recursos próprios do nó atual (filtrados do array resources)
  const nodeResources = (node.resources ?? []).reduce(
    (acc, res) => {
      if (res.type === 'operatingRoom') {
        if (res.status === 'inUse') acc.operatingRoom.inUse++
        if (res.status === 'available') acc.operatingRoom.available++
        if (res.status === 'cleaning') acc.operatingRoom.cleaning++
      } else if (res.type === 'chair') {
        if (res.status === 'occupied') acc.chair.occupied++
        if (res.status === 'available') acc.chair.available++
      }
      return acc
    },
    {
      operatingRoom: { inUse: 0, available: 0, cleaning: 0 },
      chair: { occupied: 0, available: 0 },
    }
  )

  // Soma recursiva com os filhos
  return (node.children ?? []).reduce((acc, child) => {
    const r = sumResources(child)
    return {
      operatingRoom: {
        inUse: acc.operatingRoom.inUse + r.operatingRoom.inUse,
        available: acc.operatingRoom.available + r.operatingRoom.available,
        cleaning: acc.operatingRoom.cleaning + r.operatingRoom.cleaning,
      },
      chair: {
        occupied: acc.chair.occupied + r.chair.occupied,
        available: acc.chair.available + r.chair.available,
      },
    }
  }, nodeResources)
}

/**
 * Coleciona todas as camas (resources de tipo 'bed') do nó e sub-nós (recursivo).
 */
export const collectBeds = (node?: SpaceNode | null): Bed[] => {
  if (!node) return []

  const nodeBeds: Bed[] = (node.resources ?? [])
    .filter((r): r is Resource & { status: BedStatus } => r.type === 'bed')
    .map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status as BedStatus,
      occupant: r.occupant,
    }))

  const childrenBeds = (node.children ?? [])
    .filter((child): child is SpaceNode => Boolean(child))
    .flatMap(collectBeds)

  return [...nodeBeds, ...childrenBeds]
}

/**
 * Contabiliza o estado das camas passadas por parâmetro.
 */
export const countBeds = (beds: Bed[] = []) => {
  const list = beds ?? []
  return {
    total: list.length,
    occupied: list.filter((b) => b?.status === 'occupied').length,
    available: list.filter((b) => b?.status === 'available').length,
    reserved: list.filter((b) => b?.status === 'reserved').length,
  }
}

/**
 * Retorna as iniciais (até 2 letras) a partir do nome.
 */
export const initialsOf = (name: string) =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')

export const BED_STATUSES: BedStatus[] = ['occupied', 'available', 'reserved']

export const STATUS_STYLES: Record<
  BedStatus,
  { card: string; text: string; chip: string; pill: string; dot: string }
> = {
  occupied: {
    card: 'border-purple-200 bg-purple-50',
    text: 'text-purple-700',
    chip: 'border-purple-200 bg-purple-50 text-purple-700',
    pill: 'bg-purple-100 text-purple-700',
    dot: 'border-purple-300 bg-purple-100',
  },
  available: {
    card: 'border-emerald-200 bg-emerald-50',
    text: 'text-emerald-700',
    chip: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    pill: 'bg-emerald-100 text-emerald-700',
    dot: 'border-emerald-300 bg-emerald-100',
  },
  reserved: {
    card: 'border-orange-200 bg-orange-50',
    text: 'text-orange-700',
    chip: 'border-orange-200 bg-orange-50 text-orange-700',
    pill: 'bg-orange-100 text-orange-700',
    dot: 'border-orange-300 bg-orange-100',
  },
}