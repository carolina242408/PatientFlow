import { useEffect, useRef, useState } from "react"
import type { OrgType } from "../types/tree"
import type { AddNodeValues } from "../utils/add-node-schema"
import { AddResourceForm } from "./add-form/AddResourceForm"
import { SelectionHint } from "./SelectionHint"
import { TypeSelectionCard } from "./TypeSelectionCard"

interface AddResourceStepProps {
  initialType?: OrgType | null
  initialParents?: AddNodeValues["parents"]
}

export function AddResourceStep({
  initialType = null,
  initialParents,
}: AddResourceStepProps) {
  const [selected, setSelected] = useState<OrgType | null>(initialType)
  const [parentContext, setParentContext] = useState(initialParents)
  const stepTwoRef = useRef<HTMLDivElement>(null)

  const selectType = (type: OrgType) => {
    if (type !== initialType) setParentContext(undefined)
    setSelected(type)
  }

  const changeType = () => {
    setParentContext(undefined)
    setSelected(null)
  }

  useEffect(() => {
    if (selected) {
      stepTwoRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }
  }, [selected])

  return (
    <div className="space-y-5">
      <TypeSelectionCard selected={selected} onSelect={selectType} />
      <div ref={stepTwoRef} className="scroll-mt-6">
        <StepTwo
          type={selected}
          initialParents={parentContext}
          onChangeType={changeType}
        />
      </div>
    </div>
  )
}

function StepTwo({
  type,
  initialParents,
  onChangeType,
}: {
  type: OrgType | null
  initialParents?: AddNodeValues["parents"]
  onChangeType: () => void
}) {
  if (!type) return <SelectionHint />

  return (
    <AddResourceForm
      key={type}
      type={type}
      initialParents={initialParents}
      onChangeType={onChangeType}
    />
  )
}
