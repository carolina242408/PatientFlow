import type { Patient, Resource, ResourceType, SpaceNode } from './types'

/* Mock data: replace with data from the backend */

const POOL: Patient[] = [
  { name: 'Emily Rose Parker', age: 36, diagnosis: 'Pneumonia', admitted: '2026-09-22' },
  { name: 'Daniel Brooks', age: 67, diagnosis: 'Heart Failure', admitted: '2026-09-29' },
  { name: 'Robert Hayes', age: 72, diagnosis: 'Angina', admitted: '2026-10-02' },
  { name: 'Marta Correia', age: 59, diagnosis: 'Cardiac observation', admitted: '2026-10-06' },
  { name: 'Cody James Fisher', age: 54, diagnosis: 'Arrhythmia', admitted: '2026-10-01' },
  { name: 'Nuno Costa', age: 63, diagnosis: 'Hypertension', admitted: '2026-10-03' },
  { name: 'Sofia Almeida', age: 48, diagnosis: 'Pneumonia', admitted: '2026-09-30' },
  { name: 'Tiago Ramos', age: 71, diagnosis: 'Heart Failure', admitted: '2026-10-04' },
]

// Mapeamento de caracteres para os estados suportados por cada tipo de recurso
const CHAR_STATUS: Record<ResourceType, Record<string, string>> = {
  bed: { O: 'occupied', A: 'available', R: 'reserved' },
  operatingRoom: { U: 'inUse', A: 'available', C: 'cleaning' },
  chair: { O: 'occupied', A: 'available' },
}

// resources('bed', 'room-301', 'OOA') = 3 beds: occupied, occupied, available.
// `patientOffset` picks which patients from POOL fill the occupied beds.
const resources = (
  type: ResourceType,
  prefix: string,
  pattern: string,
  patientOffset = 0,
): Resource[] => {
  let patients = 0
  return pattern.split('').map((char, i) => {
    const status = CHAR_STATUS[type][char]
    const occupant =
      type === 'bed' && status === 'occupied'
        ? POOL[(patientOffset + patients++) % POOL.length]
        : undefined
    return { id: `${prefix}-${type}-${i + 1}`, type, number: i + 1, status, occupant }
  })
}

const room = (number: number, pattern: string, patientOffset = 4): SpaceNode => ({
  id: `room-${number}`,
  level: 'room',
  name: `Room ${number}`,
  resources: resources('bed', `room-${number}`, pattern, patientOffset),
})

const ward = (
  id: string,
  name: string,
  _nursery: { name: string; nurse: string },
  rooms: SpaceNode[],
): SpaceNode => ({
  id,
  level: 'ward',
  name,
  children: rooms,
})

const service = (id: string, name: string, wards: SpaceNode[]): SpaceNode => ({
  id,
  level: 'service',
  name,
  children: wards,
})

export const TREE: SpaceNode = {
  id: 'lhu-central',
  level: 'lhu',
  name: 'Central LHU',
  children: [
    {
      id: 'unit-hospital',
      level: 'unit',
      name: 'Hospital Unit',
      children: [
        {
          id: 'building-main',
          level: 'building',
          name: 'Main Building',
          children: [
            {
              id: 'floor-2',
              level: 'floor',
              name: 'Floor 2',
              // Operating rooms and chairs sit on the floor
              resources: [
                ...resources('operatingRoom', 'floor-2', 'UAC'),
                ...resources('chair', 'floor-2', 'OOOOOOAAAA'),
              ],
              children: [
                service('service-internal-medicine', 'Internal Medicine', [
                  ward(
                    'ward-2',
                    'Ward 2 · Internal Medicine',
                    { name: 'Internal Medicine Nursery B', nurse: 'Hugo Santos' },
                    [room(201, 'OAOA'), room(202, 'OOAA')],
                  ),
                ]),
              ],
            },
            {
              id: 'floor-3',
              level: 'floor',
              name: 'Floor 3',
              resources: [
                ...resources('operatingRoom', 'floor-3', 'UUA'),
                ...resources('chair', 'floor-3', 'OOOOOAAA'),
              ],
              children: [
                service('service-cardiology', 'Cardiology', [
                  ward(
                    'ward-3',
                    'Ward 3 · Cardiology',
                    { name: 'Cardiology Nursery A', nurse: 'Sabrina Gomez' },
                    [
                      room(301, 'OOAOOA', 0), // first four patients of POOL
                      room(302, 'AORO'),
                      room(303, 'OOAR'),
                      room(304, 'OAAR'),
                      room(305, 'OOOA'),
                      room(306, 'AARO'),
                    ],
                  ),
                ]),
              ],
            },
          ],
        },
        {
          id: 'building-outpatient',
          level: 'building',
          name: 'Outpatient Building',
          children: [
            {
              id: 'floor-1',
              level: 'floor',
              name: 'Floor 1',
              children: [
                service('service-day-care', 'Day Care', [
                  ward(
                    'ward-1',
                    'Ward 1 · Day Care',
                    { name: 'Day Care Nursery', nurse: 'Inês Duarte' },
                    [room(101, 'OAAR')],
                  ),
                ]),
              ],
            },
          ],
        },
      ],
    },
  ],
}

// Walk down the first child of each level until `depth` is reached.
// In the real app, resolve this from the node assigned to the user.
export const pathTo = (depth: number): SpaceNode[] => {
  const path = [TREE]
  while (path.length - 1 < depth) {
    const next = path[path.length - 1].children?.[0]
    if (!next) break
    path.push(next)
  }
  return path
}