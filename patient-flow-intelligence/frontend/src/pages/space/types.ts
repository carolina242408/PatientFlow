export type Level = 'lhu' | 'unit' | 'building' | 'floor' | 'service' | 'wing' | 'ward' | 'nursery' | 'room' | 'bed'

export const LEVELS: Level[] = ['lhu', 'unit', 'building', 'floor', 'service', 'wing', 'ward', 'nursery', 'room', 'bed']

export type ResourceType = 'bed' | 'operatingRoom' | 'chair'

export const STATUS = {
    bed: ['occupied', 'available', 'reserved'],
    operatingRoom: ['inUse', 'available', 'cleaning'],
    chair: ['occupied', 'available']
} as const

export interface Patient {
  name: string
  age: number
  diagnosis: string
  admitted: string 
}

export interface Resource {
  id: string
  type: ResourceType
  number: number
  status: string
  occupant?: Patient
}

export interface SpaceNode {
  id: string
  level: Level
  name: string
  children?: SpaceNode[]
  resources?: Resource[] 
}


export type Open = (...nodes: SpaceNode[]) => void

export interface ViewProps {
  node: SpaceNode
  open: Open
}
