import { type FormEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Dashboard from './Dashboard'

// Dados de exemplo: substitui por dados do backend quando existirem
const UNITS_BY_LHU: Record<string, string[]> = {
  'Central LHU': ['Hospital Unit', 'Community Care Unit'],
  'North LHU': ['Hospital Unit', 'Community Care Unit'],
}

interface UnitProps {
  requiresMapping?: boolean
}

const Unit = ({ requiresMapping = true }: UnitProps) => {
  const { t } = useTranslation()

  const [mapping, setMapping] = useState<{ lhu: string; unit: string } | null>(
    requiresMapping ? null : { lhu: '', unit: 'Hospital Unit' },
  )
  const [lhu, setLhu] = useState('')
  const [unit, setUnit] = useState('')

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setMapping({ lhu, unit })
  }

  // Dashboard da unidade escolhida
  if (mapping) {
    return (
      <div className="flex flex-col gap-4">
        {requiresMapping && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setMapping(null)}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-50"
            >
              {t('unit.change')}
            </button>
          </div>
        )}
        <Dashboard scope="Unit" />
      </div>
    )
  }

  // Formulário de seleção da unidade
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <section>
        <p className="text-sm font-medium text-blue-600">{t('unit.eyebrow')}</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">{t('unit.title')}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-gray-500">{t('unit.body')}</p>
      </section>

      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm"
      >
        <h2 className="text-lg font-semibold text-slate-900">{t('unit.form.title')}</h2>
        <p className="mt-1 text-sm text-gray-500">{t('unit.form.body')}</p>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-gray-700">{t('unit.form.lhu')}</span>
            <select
              required
              value={lhu}
              onChange={(e) => {
                setLhu(e.target.value)
                setUnit('')
              }}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
            >
              <option value="">{t('unit.form.selectLhu')}</option>
              {Object.keys(UNITS_BY_LHU).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-gray-700">{t('unit.form.unit')}</span>
            <select
              required
              disabled={!lhu}
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:bg-gray-100 disabled:text-gray-400"
            >
              <option value="">{t('unit.form.selectUnit')}</option>
              {(UNITS_BY_LHU[lhu] ?? []).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-6 flex justify-end border-t border-gray-200 pt-5">
          <button
            type="submit"
            disabled={!unit}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {t('unit.form.submit')}
          </button>
        </div>
      </form>
    </div>
  )
}

export default Unit