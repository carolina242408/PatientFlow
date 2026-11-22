import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Minus, Plus } from 'lucide-react'
import { Card } from '@/components/Card'
import { Select, SelectOption } from '@/components/Select'
import { Button } from '@/components/Button'
import { OperationPopup } from '@/components/OperationPopup'
import { useKeycloak } from '../auth/context'

const CRITICAL_THRESHOLD_KEY = 'patientflow.criticalThreshold'
const MIN_THRESHOLD = 1
const MAX_THRESHOLD = 100
const DEFAULT_THRESHOLD = 85

type Theme = 'light' | 'dark'

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'pt-PT', label: 'Português' },
]

const THEMES: { value: Theme; titleKey: string; descKey: string; iconClass: string }[] = [
  {
    value: 'light',
    titleKey: 'settings.appearance.light',
    descKey: 'settings.appearance.lightDesc',
    iconClass: 'theme-light-swatch border-amber-100 bg-amber-50',
  },
  {
    value: 'dark',
    titleKey: 'settings.appearance.dark',
    descKey: 'settings.appearance.darkDesc',
    iconClass: 'border-slate-600 bg-slate-900',
  },
]

const Settings = () => {
  const { t, i18n } = useTranslation()
  const { user } = useKeycloak()
  const isManager = user?.roles.includes('MANAGER_ROLE') === true

  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'),
  )
  const savedTheme = useRef(theme)
  const [language, setLanguage] = useState(
    () => (i18n.resolvedLanguage?.startsWith('pt') ? 'pt-PT' : 'en'),
  )
  const [criticalThreshold, setCriticalThreshold] = useState<number>(() => {
    const saved = localStorage.getItem(CRITICAL_THRESHOLD_KEY)
    if (saved === null) return DEFAULT_THRESHOLD
    const parsed = Number(saved)
    return Number.isFinite(parsed) && parsed >= MIN_THRESHOLD && parsed <= MAX_THRESHOLD
      ? parsed
      : DEFAULT_THRESHOLD
  })
  const thresholdRef = useRef(criticalThreshold)
  thresholdRef.current = criticalThreshold
  const holdTimeoutRef = useRef<number | null>(null)
  const holdIntervalRef = useRef<number | null>(null)
  const pointerHandledRef = useRef(false)
  const [popup, setPopup] = useState<{ type: 'success' | 'error'; key: number } | null>(null)

  const stopHold = () => {
    if (holdTimeoutRef.current !== null) {
      window.clearTimeout(holdTimeoutRef.current)
      holdTimeoutRef.current = null
    }
    if (holdIntervalRef.current !== null) {
      window.clearInterval(holdIntervalRef.current)
      holdIntervalRef.current = null
    }
  }

  useEffect(() => stopHold, [])

  const stepThreshold = (delta: number) => {
    const next = Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, thresholdRef.current + delta))
    if (next !== thresholdRef.current) {
      thresholdRef.current = next
      setCriticalThreshold(next)
    }
  }

  const startHold = (delta: number) => {
    stopHold()
    pointerHandledRef.current = true
    stepThreshold(delta)
    const startedAt = Date.now()
    holdTimeoutRef.current = window.setTimeout(() => {
      holdIntervalRef.current = window.setInterval(() => {
        const heldMs = Date.now() - startedAt
        stepThreshold(heldMs > 1200 ? delta * 2 : delta)
      }, 50)
    }, 250)
  }

  useEffect(
    () => () => {
      document.documentElement.classList.toggle('theme-dark', savedTheme.current === 'dark')
    },
    [],
  )

  const showPopup = (type: 'success' | 'error') => {
    setPopup((current) => ({ type, key: (current?.key ?? 0) + 1 }))
  }

  const handleThemePreview = (selectedTheme: Theme) => {
    setTheme(selectedTheme)
    document.documentElement.classList.toggle('theme-dark', selectedTheme === 'dark')
  }

  const handleSave = async () => {
    try {
      await i18n.changeLanguage(language)
      localStorage.setItem('theme', theme)
      savedTheme.current = theme
      if (isManager) {
        localStorage.setItem(CRITICAL_THRESHOLD_KEY, String(criticalThreshold))
      }
      showPopup('success')
    } catch (error) {
      console.error('Failed to save preferences', error)
      showPopup('error')
    }
  }

  return (
    <Card className="gap-0 rounded-2xl p-10 shadow-sm">
      {/* Header */}
      <header className="pb-8">
        <h1 className="text-2xl font-semibold text-slate-900">{t('settings.title')}</h1>
        <p className="mt-2 text-sm text-gray-500">{t('settings.body')}</p>
      </header>

      <div className="divide-y divide-gray-200 border-t border-gray-200">
        {/* Appearance */}
        <section className="py-8">
          <h2 className="text-lg font-semibold text-slate-900">
            {t('settings.appearance.title')}
          </h2>
          <p className="mt-1 text-sm text-gray-500">{t('settings.appearance.body')}</p>

          <div role="radiogroup" className="mt-5 grid grid-cols-1 gap-4 md:auto-rows-fr md:grid-cols-2">
            {THEMES.map((option) => {
              const selected = theme === option.value
              return (
                <Button
                  key={option.value}
                  type="button"
                  variant="ghost"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => handleThemePreview(option.value)}
                  className={`h-full w-full min-w-0 flex items-center justify-start gap-4 whitespace-normal rounded-xl border p-5 text-left transition-colors ${
                    selected
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-12 w-12 shrink-0 rounded-full border-[6px] ${option.iconClass}`}
                  />
                  <span className="flex min-w-0 flex-col gap-1 break-words">
                    <span className="text-base font-semibold text-slate-900">
                      {t(option.titleKey)}
                    </span>
                  </span>
                </Button>
              )
            })}
          </div>
        </section>

        {/* Language */}
        <section className="py-8">
          <h2 className="text-lg font-semibold text-slate-900">
            {t('settings.language.title')}
          </h2>
          <p className="mt-1 text-sm text-gray-500">{t('settings.language.body')}</p>

          <div className="mt-5 w-full max-w-md">
            <Select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="h-auto rounded-lg px-4 py-3 text-base text-slate-900 focus-visible:border-blue-600 focus-visible:ring-blue-100"
            >
              {LANGUAGES.map((lang) => (
                <SelectOption key={lang.code} value={lang.code}>
                  {lang.label}
                </SelectOption>
              ))}
            </Select>
          </div>
        </section>

        {/* Capacity alerts (MANAGER_ROLE only) */}
        {isManager && (
          <section className="py-8">
            <h2 className="text-lg font-semibold text-slate-900">
              {t('settings.capacityAlerts.title')}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              {t('settings.capacityAlerts.body')}
            </p>

            <div className="mt-5 flex w-full max-w-md items-center justify-between gap-4 rounded-xl border border-blue-100 bg-blue-50/40 px-5 py-4">
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {t('settings.capacityAlerts.thresholdLabel')}
                </p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {t('settings.capacityAlerts.thresholdHint')}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  aria-label={t('dashboard.decreaseThreshold')}
                  disabled={criticalThreshold <= MIN_THRESHOLD}
                  onPointerDown={(e) => {
                    if (e.button !== 0 && e.pointerType === 'mouse') return
                    startHold(-1)
                  }}
                  onPointerUp={stopHold}
                  onPointerLeave={stopHold}
                  onPointerCancel={stopHold}
                  onBlur={stopHold}
                  onClick={() => {
                    if (pointerHandledRef.current) {
                      pointerHandledRef.current = false
                      return
                    }
                    stepThreshold(-1)
                  }}
                  className="h-10 w-10 select-none rounded-lg border-gray-200 bg-white p-0 text-blue-600 hover:bg-blue-50"
                >
                  <Minus aria-hidden="true" className="h-4 w-4" />
                </Button>
                <span className="min-w-[3.25rem] text-center text-lg font-semibold tabular-nums text-blue-600">
                  {criticalThreshold}%
                </span>
                <Button
                  type="button"
                  variant="outline"
                  aria-label={t('dashboard.increaseThreshold')}
                  disabled={criticalThreshold >= MAX_THRESHOLD}
                  onPointerDown={(e) => {
                    if (e.button !== 0 && e.pointerType === 'mouse') return
                    startHold(1)
                  }}
                  onPointerUp={stopHold}
                  onPointerLeave={stopHold}
                  onPointerCancel={stopHold}
                  onBlur={stopHold}
                  onClick={() => {
                    if (pointerHandledRef.current) {
                      pointerHandledRef.current = false
                      return
                    }
                    stepThreshold(1)
                  }}
                  className="h-10 w-10 select-none rounded-lg border-gray-200 bg-white p-0 text-blue-600 hover:bg-blue-50"
                >
                  <Plus aria-hidden="true" className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </section>
        )}

        {/* Actions */}
        <div className="flex justify-end pt-8">
          <Button
            type="button"
            onClick={handleSave}
            className="h-auto rounded-lg bg-blue-600 px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-blue-700"
          >
            {t('settings.save')}
          </Button>
        </div>
      </div>
      {popup && (
        <OperationPopup
          key={popup.key}
          type={popup.type}
          title={t(`settings.popup.${popup.type}.title`)}
          description={t(`settings.popup.${popup.type}.description`)}
        />
      )}
    </Card>
  )
}

export default Settings