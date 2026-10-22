import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Field = 'lhu' | 'unit' | 'building' | 'floor' | 'service'
type ServiceMapping = Record<Field, string>

// Dados de exemplo: substitui por dados do backend quando existirem
const serviceData = {
  Cardiology: {
    occupancy: '88%',
    occupiedBeds: '42 / 48',
    discharges: '3',
    admissions: '5',
    professionals: '18',
    wards: [
      { name: 'Cardiology Ward 3', occupancy: 88, beds: '42 / 48' },
      { name: 'Cardiac Intensive Care', occupancy: 75, beds: '9 / 12' },
      { name: 'Cardiology Day Unit', occupancy: 63, beds: '10 / 16' },
    ],
  },
  'Internal Medicine': {
    occupancy: '82%',
    occupiedBeds: '54 / 66',
    discharges: '5',
    admissions: '7',
    professionals: '24',
    wards: [
      { name: 'Internal Medicine Ward A', occupancy: 82, beds: '27 / 33' },
      { name: 'Internal Medicine Ward B', occupancy: 79, beds: '26 / 33' },
      { name: 'Observation Unit', occupancy: 68, beds: '11 / 16' },
    ],
  },
  Surgery: {
    occupancy: '76%',
    occupiedBeds: '38 / 50',
    discharges: '4',
    admissions: '4',
    professionals: '21',
    wards: [
      { name: 'General Surgery Ward', occupancy: 76, beds: '19 / 25' },
      { name: 'Post-operative Unit', occupancy: 72, beds: '18 / 25' },
      { name: 'Surgical Day Unit', occupancy: 58, beds: '7 / 12' },
    ],
  },
}

type ServiceName = keyof typeof serviceData

// Ordem da cascata: ao mudar um campo, os seguintes são limpos
const FIELD_ORDER: Field[] = ['lhu', 'unit', 'building', 'floor', 'service']

const OPTIONS: Record<Field, string[]> = {
  lhu: ['Central LHU', 'North LHU'],
  unit: ['Hospital Unit', 'Community Care Unit'],
  building: ['Main Building', 'Outpatient Building'],
  floor: ['Floor 1', 'Floor 2', 'Floor 3'],
  service: Object.keys(serviceData),
}

const EMPTY_MAPPING: ServiceMapping = {
  lhu: '',
  unit: '',
  building: '',
  floor: '',
  service: '',
}

const selectClass =
  'rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-gray-100 disabled:text-gray-400'

interface ServiceProps {
  requiresMapping?: boolean
  scopedService?: ServiceName
}

const Service = ({ requiresMapping = true, scopedService = 'Cardiology' }: ServiceProps) => {
  const { t } = useTranslation()

  const [mapping, setMapping] = useState<ServiceMapping | null>(
    requiresMapping ? null : { ...EMPTY_MAPPING, service: scopedService },
  )
  const [draft, setDraft] = useState<ServiceMapping>(EMPTY_MAPPING)

  const updateDraft = (field: Field, value: string) => {
    const changedIndex = FIELD_ORDER.indexOf(field)
    setDraft((current) => {
      const next = { ...current, [field]: value }
      FIELD_ORDER.slice(changedIndex + 1).forEach((key) => {
        next[key] = ''
      })
      return next
    })
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMapping(draft)
  }

  // Formulário de seleção do serviço
  if (!mapping) {
    return (
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
        <section>
          <p className="text-sm font-medium text-blue-600">{t('service.eyebrow')}</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">{t('service.title')}</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-500">
            {t('service.body')}
          </p>
        </section>

        <form
          onSubmit={handleSubmit}
          className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm"
        >
          <div className="flex items-center justify-between gap-4 border-b border-gray-200 pb-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{t('service.form.title')}</h2>
              <p className="mt-1 text-sm text-gray-500">{t('service.form.body')}</p>
            </div>
            <span className="shrink-0 rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-600">
              {t('service.form.required')}
            </span>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
            {FIELD_ORDER.map((field, index) => {
              const previous = FIELD_ORDER[index - 1]
              const isLast = index === FIELD_ORDER.length - 1
              return (
                <label
                  key={field}
                  className={`flex flex-col gap-1.5 ${isLast ? 'md:col-span-2' : ''}`}
                >
                  <span className="text-sm font-medium text-gray-700">
                    {index + 1}. {t(`service.form.fields.${field}`)}
                  </span>
                  <select
                    required
                    disabled={previous ? !draft[previous] : false}
                    value={draft[field]}
                    onChange={(e) => updateDraft(field, e.target.value)}
                    className={selectClass}
                  >
                    <option value="">{t(`service.form.placeholders.${field}`)}</option>
                    {OPTIONS[field].map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              )
            })}
          </div>

          <div className="mt-6 flex justify-end border-t border-gray-200 pt-5">
            <button
              type="submit"
              disabled={!draft.service}
              className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
            >
              {t('service.form.submit')}
            </button>
          </div>
        </form>
      </div>
    )
  }

  // Overview do serviço escolhido
  const data = serviceData[mapping.service as ServiceName]

  const stats = [
    { label: t('service.stats.occupancy'), value: data.occupancy },
    { label: t('service.stats.occupiedBeds'), value: data.occupiedBeds },
    { label: t('service.stats.discharges'), value: data.discharges },
    { label: t('service.stats.admissions'), value: data.admissions },
    { label: t('service.stats.professionals'), value: data.professionals },
  ]

  const resources = [
    { label: t('service.resources.beds'), value: '48' },
    { label: t('service.resources.chairs'), value: '12' },
    { label: t('service.resources.rooms'), value: '3' },
    { label: t('service.resources.stations'), value: '16' },
  ]

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
        <div>
          <p className="text-sm font-medium text-blue-600">{t('service.selected')}</p>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900">
            {t('service.overview.title', { service: mapping.service })}
          </h1>
          <p className="mt-1.5 text-sm text-gray-500">{t('service.overview.body')}</p>
        </div>
        {requiresMapping && (
          <button
            type="button"
            onClick={() => setMapping(null)}
            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-50"
          >
            {t('service.change')}
          </button>
        )}
      </section>

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {stats.map(({ label, value }) => (
          <article key={label} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm text-gray-500">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
          </article>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <article className="rounded-2xl border border-gray-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">{t('service.areas.title')}</h2>
          <p className="mt-1 text-sm text-gray-400">{t('service.areas.body')}</p>

          <div className="mt-5 space-y-4">
            {data.wards.map((ward) => (
              <div key={ward.name}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-gray-700">{ward.name}</span>
                  <span className="text-sm font-medium text-gray-500">
                    {ward.occupancy}% · {ward.beds}
                  </span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-blue-500"
                    style={{ width: `${ward.occupancy}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-gray-200 bg-white p-6">
          <h2 className="text-base font-semibold text-slate-900">{t('service.resources.title')}</h2>

          <div className="mt-4 grid grid-cols-2 gap-3">
            {resources.map(({ label, value }) => (
              <div key={label} className="rounded-lg bg-gray-50 p-3">
                <p className="text-xs text-gray-400">{label}</p>
                <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-lg bg-blue-50 p-3">
            <p className="text-sm font-medium text-blue-600">
              {t('service.review.title', { count: 5 })}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {t('service.review.body', { maintenance: 3, cleaning: 2 })}
            </p>
          </div>
        </article>
      </section>
    </div>
  )
}

export default Service
