import { useEffect, useRef, useState } from "react"
import type { OrgType } from "../types/tree"
import { AddResourceForm } from "./add-form/AddResourceForm"
import { SelectionHint } from "./SelectionHint"
import { TypeSelectionCard } from "./TypeSelectionCard"

export function AddResourceStep() {
  const [selected, setSelected] = useState<OrgType | null>(null)
  const stepTwoRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (selected) {
      stepTwoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [selected])

  return (
    <div className="space-y-5">
      <TypeSelectionCard selected={selected} onSelect={setSelected} />
      <div ref={stepTwoRef} className="scroll-mt-6">
        <StepTwo type={selected} onChangeType={() => setSelected(null)} />
      </div>
    </div>
  )
}

function StepTwo({ type, onChangeType }: { type: OrgType | null; onChangeType: () => void }) {
  if (!type) return <SelectionHint />

  return <AddResourceForm key={type} type={type} onChangeType={onChangeType} />
}
