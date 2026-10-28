import type { OrgType } from "../types/tree"
import { TypeCard } from "./TypeCard"

interface TypeGroupProps {
  label: string
  types: OrgType[]
  selected: OrgType | null
  onSelect: (type: OrgType) => void
}

export function TypeGroup({ label, types, selected, onSelect }: TypeGroupProps) {
  return (
    <section className="space-y-4">
      <h4 className="text-sm font-medium tracking-wide text-gray-500 uppercase">{label}</h4>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {types.map((type) => (
          <TypeCard key={type} type={type} selected={selected === type} onSelect={onSelect} />
        ))}
      </div>
    </section>
  )
}
