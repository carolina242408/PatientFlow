import type { Resource, SpaceNode } from './types'

export type BedStatus = 'occupied' | 'available' | 'reserved'

export interface Bed {
  id: string
  number: number
  status: BedStatus
  occupant?: Resource['occupant']
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