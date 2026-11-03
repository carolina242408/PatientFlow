import { useTranslation } from 'react-i18next'
import type { ViewProps } from '../types'

const BedView = ({ node }: ViewProps) => {
  const { t, i18n } = useTranslation()
  const lang = i18n.resolvedLanguage

  // A cama é criada a partir dos dados operacionais carregados para o quarto.
  const resource = node.resources?.[0]
  const patient = resource?.occupant

  const bedCharacteristics = {
    id: resource?.id ?? '—',
    type: '—',
    location: node.name || '—',
    status: resource?.status ?? 'available',
    equipment: '—',
    connectivity: '—',
    lastMaintenance: '—',
    lastSanitization: '—',
  }

  const isOccupied = resource?.status === 'occupied' && Boolean(patient)
  const formatDate = (value?: string) => {
    if (!value) return '—'
    const date = new Date(value)
    return Number.isNaN(date.getTime())
      ? '—'
      : new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(date)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 1. RESOURCE INFORMATION CARD */}
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
        <header className="flex items-start justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              {t('space.bedView.resourceInformation', 'Resource Information')}
            </p>
            <h2 className="mt-1 text-2xl font-bold text-slate-900">
              {t('space.bedView.bedCharacteristics', 'Bed characteristics')}
            </h2>
          </div>
          <span
            className={`rounded-full px-4 py-1.5 text-xs font-semibold capitalize ${
              isOccupied
                ? 'border border-purple-200 bg-purple-50 text-purple-700'
                : 'border border-emerald-200 bg-emerald-50 text-emerald-700'
            }`}
          >
            {t(`space.status.${bedCharacteristics.status}`, bedCharacteristics.status)}
          </span>
        </header>

        <div className="mt-6 grid grid-cols-2 gap-y-6 gap-x-8 md:grid-cols-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {t('space.bedView.resourceId', 'Resource ID')}
            </p>
            <p className="mt-1.5 text-sm font-semibold text-slate-800">
              {bedCharacteristics.id}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {t('space.bedView.bedType', 'Bed Type')}
            </p>
            <p className="mt-1.5 text-sm font-semibold text-slate-800">
              {bedCharacteristics.type}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {t('space.bedView.location', 'Location')}
            </p>
            <p className="mt-1.5 text-sm font-semibold text-slate-800">
              {bedCharacteristics.location}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {t('space.bedView.currentStatus', 'Current Status')}
            </p>
            <p className="mt-1.5 text-sm font-semibold text-slate-800 capitalize">
              {bedCharacteristics.status}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {t('space.bedView.equipment', 'Equipment')}
            </p>
            <p className="mt-1.5 text-sm font-semibold text-slate-800">
              {bedCharacteristics.equipment}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {t('space.bedView.connectivity', 'Connectivity')}
            </p>
            <p className="mt-1.5 text-sm font-semibold text-slate-800">
              {bedCharacteristics.connectivity}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {t('space.bedView.lastMaintenance', 'Last Maintenance')}
            </p>
            <p className="mt-1.5 text-sm font-semibold text-slate-800">
              {bedCharacteristics.lastMaintenance}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
              {t('space.bedView.lastSanitization', 'Last Sanitization')}
            </p>
            <p className="mt-1.5 text-sm font-semibold text-slate-800">
              {bedCharacteristics.lastSanitization}
            </p>
          </div>
        </div>
      </section>

      {isOccupied && (
        <>
          {/* 2. ELECTRONIC HEALTH RECORD CARD */}
          <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <header className="flex items-start justify-between border-b border-gray-100 pb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-blue-600">
                  {t('space.bedView.electronicHealthRecord', 'Electronic Health Record')}
                </p>
                <h2 className="mt-1 text-2xl font-bold text-slate-900">
                  {patient?.name}
                </h2>
              </div>
              <span className="rounded-full bg-emerald-50 px-3.5 py-1 text-xs font-medium text-emerald-700">
                {t('space.bedView.activeAdmission', 'Active admission')}
              </span>
            </header>

            <div className="mt-6">
              <h3 className="text-base font-bold text-slate-900">
                {t('space.bedView.patientAndAdmission', 'Patient and admission')}
              </h3>

              <div className="mt-5 grid grid-cols-1 gap-y-6 gap-x-12 md:grid-cols-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {t('space.bedView.patientId', 'Patient ID')}
                  </p>
                  <p className="mt-1.5 text-sm font-semibold text-slate-800">
                    {patient?.id ?? '—'}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {t('space.bedView.ageAndCondition', 'Age and condition')}
                  </p>
                  <p className="mt-1.5 text-sm font-semibold text-slate-800">
                    {patient?.age === undefined ? '—' : `${patient.age}y`} · {patient?.diagnosis || '—'}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {t('space.bedView.primaryDiagnosis', 'Primary diagnosis')}
                  </p>
                  <p className="mt-1.5 text-sm font-semibold text-slate-800">
                    {patient?.diagnosis || '—'}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {t('space.bedView.attendingPhysician', 'Attending physician')}
                  </p>
                  <p className="mt-1.5 text-sm font-semibold text-slate-800">
                    —
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {t('space.bedView.admission', 'Admission')}
                  </p>
                  <p className="mt-1.5 text-sm font-semibold text-slate-800">
                    {patient?.admitted ? `Admitted ${formatDate(patient.admitted)}` : '—'}
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {t('space.bedView.allergies', 'Allergies')}
                  </p>
                  <p className="mt-1.5 text-sm font-semibold text-slate-800">
                    —
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {t('space.bedView.bloodGroup', 'Blood group')}
                  </p>
                  <p className="mt-1.5 text-sm font-semibold text-slate-800">
                    —
                  </p>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    {t('space.bedView.carePlan', 'Care plan')}
                  </p>
                  <p className="mt-1.5 text-sm font-semibold text-slate-800">
                    —
                  </p>
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  )
}

export default BedView