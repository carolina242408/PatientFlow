export type Level = 'lhu' | 'unit' | 'building' | 'floor' | 'service' | 'wing' | 'ward' | 'room' | 'bed'

export const LEVELS: Level[] = ['lhu', 'unit', 'building', 'floor', 'service', 'wing', 'ward', 'room', 'bed']

export type ResourceType = 'bed'

export const STATUS = {
    bed: ['occupied', 'available', 'reserved'],
} as const

export interface Patient {
  name: string
  age?: number
  diagnosis: string
  admitted?: string
  id?: string
  snsNumber?: string
  hospitalNumber?: string
  birthDate?: string
  gender?: string
  expectedDischargeAt?: string
  serviceName?: string
  wardCode?: string
}

export interface Resource {
  id: string
  code?: string
  type: ResourceType
  number: number
  status: string
  location?: string
  occupant?: Patient
}

export interface SpaceNode {
  id: string
  level: Level
  name: string
  children?: SpaceNode[]
  resources?: Resource[] 
  bedCounts?: {
    total: number
    occupied: number
    available: number
    reserved: number
  }
}


export type Open = (...nodes: SpaceNode[]) => void

export interface ViewProps {
  node: SpaceNode
  open: Open
}
