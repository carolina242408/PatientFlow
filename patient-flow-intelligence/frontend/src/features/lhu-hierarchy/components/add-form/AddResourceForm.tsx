import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { useForm, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { Button } from "@/components/Button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/Card"
import { Form } from "@/components/Form"
import type { OrgType } from "../../types/tree"
import {
  buildAddNodeSchema,
  getDefaultValues,
  type AddNodeValues,
} from "../../utils/add-node-schema"
import { isResourceType } from "../../utils/org-types"
import { InformationSection } from "./InformationSection"
import { NotesField } from "./NotesField"
import { ParentLocationSection } from "./ParentLocationSection"
import { ResourceCharacteristicsSection } from "./ResourceCharacteristicsSection"
import { useCreateHierarchyNode } from "../../hooks/useLHUHierarchy"

interface AddResourceFormProps {
  type: OrgType
  onChangeType: () => void
}

export function AddResourceForm({ type, onChangeType }: AddResourceFormProps) {
  const { t } = useTranslation()
  const isResource = isResourceType(type)
  const [popup, setPopup] = useState<{
    type: "success" | "error"
    key: number
  } | null>(null)
  const form = useForm<AddNodeValues>({
    resolver: zodResolver(buildAddNodeSchema(type)) as Resolver<AddNodeValues>,
    defaultValues: getDefaultValues(type),
  })
  const createNode = useCreateHierarchyNode()

  useEffect(() => {
    if (!popup) return
    const timeoutId = window.setTimeout(() => setPopup(null), 4000)
    return () => window.clearTimeout(timeoutId)
  }, [popup])

  const showPopup = (popupType: "success" | "error") => {
    setPopup((current) => ({ type: popupType, key: (current?.key ?? 0) + 1 }))
  }

  const onSubmit = async (values: AddNodeValues) => {
    const parentId = Object.values(values.parents).reverse().find(Boolean)
    const usesCode = type === "ward" || type === "room" || type === "bed" || type === "nursery"
    try {
      await createNode.mutateAsync({
        type,
        input: {
          name: usesCode ? undefined : values.name,
          code: usesCode ? values.internalCode || values.name : undefined,
          parentId,
        },
      })
      showPopup("success")
      form.reset(getDefaultValues(type))
    } catch (error) {
      console.error("Unable to create hierarchy node", error)
      showPopup("error")
    }
  }
  const onInvalid = () => showPopup("error")

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit, onInvalid)}>
        <Card className="gap-8">
          <CardHeader className="flex-row items-start justify-between gap-3 border-b border-gray-200 pb-6">
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium tracking-wide text-[#2563EB] uppercase">
                {t("lhuHierarchy.form.step")}
              </p>

              <CardTitle className="text-2xl font-bold">
                {t("lhuHierarchy.form.title", {
                  type: t(`lhuHierarchy.types.${type}`),
                })}
              </CardTitle>
            </div>

            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={onChangeType}
            >
              {t("lhuHierarchy.form.changeType")}
            </Button>
          </CardHeader>

          <CardContent className="space-y-8">
            <ParentLocationSection type={type} />

            <InformationSection type={type}>
              {!isResource && <NotesField />}
            </InformationSection>

            {isResource && (
              <>
                <ResourceCharacteristicsSection />
                <NotesField />
              </>
            )}
          </CardContent>

          <CardFooter className="justify-end gap-3 border-t border-gray-200 pt-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => form.reset(getDefaultValues(type))}
            >
              {t("lhuHierarchy.form.actions.clear")}
            </Button>
            <Button type="submit">
              {t("lhuHierarchy.form.actions.submit")}
            </Button>
          </CardFooter>
        </Card>
      </form>
      {popup && (
        <div
          key={popup.key}
          role={popup.type === "success" ? "status" : "alert"}
          aria-live={popup.type === "success" ? "polite" : "assertive"}
          className={`operation-popup operation-popup-${popup.type}`}
        >
          <p className="text-xl font-semibold">
            {t(`lhuHierarchy.form.popup.${popup.type}.title`)}
          </p>
          <p className="mt-1 text-sm">
            {t(`lhuHierarchy.form.popup.${popup.type}.description`)}
          </p>
        </div>
      )}
    </Form>
  )
}
