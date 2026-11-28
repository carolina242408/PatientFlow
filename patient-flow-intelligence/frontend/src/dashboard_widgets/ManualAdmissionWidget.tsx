import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { Badge } from '@/components/Badge'
import { Button } from '@/components/Button'
import DashboardPanel from '@/components/DashboardPanel'
import {
  createManualAdmission,
  fetchCamasEmLibertacaoBreve,
  fetchServicos,
  type ManualAdmissionInput,
  type ManualAdmissionResult,
} from '@/api/bed-allocation'

const INITIAL_FORM: ManualAdmissionInput = {
  full_name: '',
  priority: 3,
  isolation: false,
}

function EmptyDischarges({ title, message }: { title: string; message: string }) {
  const { data = [] } = useQuery({
    queryKey: ['camas-em-libertacao-breve'],
    queryFn: () => fetchCamasEmLibertacaoBreve(24),
  })

  return (
    <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
      <p className="font-medium">{title}</p>
      <p>{message}</p>
      {data.map((bed) => (
        <p key={bed.bed_id}>
          {bed.bed_label} · {bed.current_patient_name}
        </p>
      ))}
    </div>
  )
}

function ManualAdmissionWidget() {
  const { t } = useTranslation()
  const manualDialogRef = useRef<HTMLDialogElement>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [manualResult, setManualResult] = useState<ManualAdmissionResult | null>(null)
  const [manualError, setManualError] = useState<string | null>(null)
  const [manualDebug, setManualDebug] = useState(false)
  const [manualForm, setManualForm] = useState<ManualAdmissionInput>(INITIAL_FORM)

  const resetManualAdmission = () => {
    setManualForm(INITIAL_FORM)
    setManualResult(null)
    setManualError(null)
  }

  const { data: services = [] } = useQuery({
    queryKey: ['servicos'],
    queryFn: fetchServicos,
  })

  const manualAdmission = useMutation({
    mutationFn: (input: ManualAdmissionInput) => createManualAdmission(input, manualDebug),
    onSuccess: (result) => {
      setManualResult(result)
      setManualError(null)
    },
    onError: (error: unknown) => {
      const status = (error as { response?: { status?: number } }).response?.status
      setManualResult(null)
      setManualError(
        status === 409
          ? 'manualAdmission.errors.conflict'
          : status === 422
            ? 'manualAdmission.errors.validation'
            : 'manualAdmission.errors.generic',
      )
    },
  })

  useEffect(() => {
    const dialog = manualDialogRef.current
    if (manualOpen && dialog && !dialog.open) dialog.showModal()
  }, [manualOpen])

  return (
    <>
      <DashboardPanel
        title={t('manualAdmission.title')}
        description={t('manualAdmission.body')}
        expandLabel={t('manualAdmission.open')}
        onExpand={() => setManualOpen(true)}
        contentClassName="p-6"
      >
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <p className="text-sm text-gray-500">{t('manualAdmission.body')}</p>
          <Button type="button" onClick={() => setManualOpen(true)}>
            {t('manualAdmission.open')}
          </Button>
        </div>

        {manualResult && manualResult.debug_enabled && (
          <details className="mt-4 rounded-lg border border-gray-200 p-3">
            <summary className="cursor-pointer font-medium">
              {t('manualAdmission.debug.title')}
            </summary>
            <div className="mt-3 space-y-3 text-sm">
              {manualResult.comparisons.map((comparison) => (
                <div key={comparison.bed_id}>
                  <p className="font-medium">{comparison.bed_label}</p>
                  {comparison.candidates.map((candidate) => (
                    <div key={candidate.encounter_id}>
                      <p>
                        {candidate.patient_name}: {candidate.total_score}
                      </p>
                      <p className="pl-3 text-xs text-gray-500">
                        {Object.entries(candidate.score_breakdown)
                          .map(([name, value]) => `${name}: ${value}`)
                          .join(' · ')}
                      </p>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </details>
        )}
      </DashboardPanel>

      <dialog
        ref={manualDialogRef}
        onClose={() => {
          setManualOpen(false)
          resetManualAdmission()
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-2xl border border-gray-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-black/40"
      >
        <form
          className="mx-auto w-full max-w-2xl space-y-5 p-6 sm:p-8"
          onSubmit={(event) => {
            event.preventDefault()
            if (event.currentTarget.checkValidity()) manualAdmission.mutate(manualForm)
          }}
        >
          <header className="flex items-start justify-between gap-4 border-b border-gray-200 pb-5">
            <div>
              <h2 className="text-xl font-semibold">{t('manualAdmission.title')}</h2>
              <p className="mt-1 text-sm text-gray-500">{t('manualAdmission.body')}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() => manualDialogRef.current?.close()}
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </Button>
          </header>

          <div className="grid gap-4 sm:grid-cols-2">
            {(
              [
                ['full_name', 'text', 'manualAdmission.field.fullName'],
                ['birth_date', 'date', 'manualAdmission.field.birthDate'],
                [
                  'expected_discharge_at',
                  'datetime-local',
                  'manualAdmission.field.expectedDischargeAt',
                ],
              ] as const
            ).map(([field, type, label]) => (
              <label
                key={field}
                className="flex flex-col gap-1 text-sm font-medium text-slate-700"
              >
                {t(label)}
                <input
                  type={type}
                  required={field === 'full_name'}
                  minLength={field === 'full_name' ? 2 : undefined}
                  maxLength={field === 'full_name' ? 120 : undefined}
                  value={manualForm[field] ?? ''}
                  onChange={(event) =>
                    setManualForm((current) => ({ ...current, [field]: event.target.value }))
                  }
                  className="h-10 rounded-md border border-gray-300 px-3 font-normal"
                />
              </label>
            ))}

            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              {t('manualAdmission.field.gender')}
              <select
                value={manualForm.gender ?? ''}
                onChange={(event) =>
                  setManualForm((current) => ({
                    ...current,
                    gender: (event.target.value || undefined) as 'F' | 'M' | undefined,
                  }))
                }
                className="h-10 rounded-md border border-gray-300 px-3 font-normal"
              >
                <option value="">{t('manualAdmission.gender.unspecified')}</option>
                <option value="F">{t('manualAdmission.gender.female')}</option>
                <option value="M">{t('manualAdmission.gender.male')}</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              {t('manualAdmission.field.service')}
              <select
                value={manualForm.service_id ?? ''}
                onChange={(event) =>
                  setManualForm((current) => ({
                    ...current,
                    service_id: event.target.value || undefined,
                  }))
                }
                className="h-10 rounded-md border border-gray-300 px-3 font-normal"
              >
                <option value="">—</option>
                {services.map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
              {t('manualAdmission.field.priority')}
              <select
                required
                value={manualForm.priority}
                onChange={(event) =>
                  setManualForm((current) => ({
                    ...current,
                    priority: event.target.value ? Number(event.target.value) : undefined,
                  }))
                }
                className="h-10 rounded-md border border-gray-300 px-3 font-normal"
              >
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((priority) => (
                  <option key={priority} value={priority}>
                    {t(`manualAdmission.priority.${priority}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={manualForm.isolation}
              onChange={(event) =>
                setManualForm((current) => ({ ...current, isolation: event.target.checked }))
              }
            />
            {t('manualAdmission.field.isolation')}
          </label>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={manualDebug}
              onChange={(event) => setManualDebug(event.target.checked)}
            />
            {t('manualAdmission.debug.toggle')}
          </label>

          {manualError && <p className="text-sm text-red-600">{t(manualError)}</p>}
          {manualAdmission.isPending && (
            <p className="text-sm text-gray-500">{t('manualAdmission.loading')}</p>
          )}

          {manualResult && (
            <div className="space-y-3">
              <h3 className="font-semibold">{t('manualAdmission.results.title')}</h3>
              {manualResult.suggestions.length > 0 && (
                <h4 className="font-semibold">{t('manualAdmission.results.direct')}</h4>
              )}
              {manualResult.suggestions.map((suggestion) => (
                <div
                  key={suggestion.bed_id}
                  className="flex flex-col gap-3 rounded-lg border border-gray-200 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium">{suggestion.bed_label}</p>
                    <p className="text-sm text-gray-500">{suggestion.justification}</p>
                    <Badge variant="secondary">{suggestion.score}</Badge>
                  </div>
                </div>
              ))}

              {manualResult.reallocations.length > 0 && (
                <h4 className="font-semibold">{t('manualAdmission.results.reallocations')}</h4>
              )}
              {manualResult.reallocations.map((suggestion) => (
                <div
                  key={`${suggestion.displaced_encounter_id}-${suggestion.to_bed_id}`}
                  className="rounded-lg border border-amber-200 bg-amber-50 p-3"
                >
                  <p className="font-medium">
                    {t('manualAdmission.results.freeBed', { bed: suggestion.from_bed_label })}
                  </p>
                  <p className="text-sm text-gray-600">
                    {suggestion.displaced_patient_name} (
                    {t('manualAdmission.results.priority', {
                      priority: suggestion.displaced_priority,
                    })}
                    ){' → '}
                    {suggestion.to_bed_label ?? t('manualAdmission.results.noBed')}
                  </p>
                  <p className="text-sm text-gray-600">
                    {t('manualAdmission.results.combinedScore', {
                      score: suggestion.score_combined,
                    })}
                    {' · '}
                    {t('manualAdmission.results.roomEvictionScore', {
                      score: suggestion.room_eviction_score,
                    })}
                  </p>
                  <p className="text-sm text-gray-600">{suggestion.justification}</p>
                  {suggestion.warning && (
                    <div className="mt-2 rounded border border-amber-300 bg-amber-100 p-2 text-sm text-amber-900">
                      <p>{suggestion.warning.message}</p>
                      {suggestion.warning.code === 'NO_BED_AVAILABLE' && (
                        <ul className="list-disc pl-5">
                          {suggestion.warning.affected_patients.map((patient) => (
                            <li key={patient}>{patient}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <Badge variant="secondary">{suggestion.score_combined}</Badge>
                </div>
              ))}

              {manualResult.room_eviction_ranking.length > 0 && (
                <div className="rounded-lg border border-gray-200 p-3">
                  <h4 className="font-semibold">{t('manualAdmission.results.roomRanking')}</h4>
                  <div className="mt-2 space-y-2 text-sm">
                    {manualResult.room_eviction_ranking.map((room, index) => (
                      <div
                        key={room.room_id}
                        className={
                          index === 0 ? 'rounded border border-blue-200 bg-blue-50 p-2' : 'p-2'
                        }
                      >
                        <div className="flex justify-between gap-3">
                          <span>{room.room_label}</span>
                          <span>{room.eviction_score}</span>
                        </div>
                        <p className="text-gray-600">
                          {room.occupant_scores
                            .map(([name, score]) => `${name} (${score})`)
                            .join(', ')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {manualResult.suggestions.length === 0 &&
                manualResult.reallocations.length === 0 && (
                  <EmptyDischarges
                    title={t('manualAdmission.results.empty.title')}
                    message={t('manualAdmission.results.empty.body')}
                  />
                )}
            </div>
          )}

          <footer className="flex justify-end gap-3 border-t border-gray-200 pt-5">
            <Button
              type="button"
              variant="outline"
              onClick={() => manualDialogRef.current?.close()}
            >
              {t('manualAdmission.cancel')}
            </Button>
            <Button type="submit" disabled={manualAdmission.isPending}>
              {t('manualAdmission.submit')}
            </Button>
          </footer>
        </form>
      </dialog>
    </>
  )
}

export default ManualAdmissionWidget
