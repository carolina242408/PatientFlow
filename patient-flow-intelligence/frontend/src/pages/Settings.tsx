import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Card } from '@/components/Card'
import { Select, SelectOption } from '@/components/Select'
import { Button } from '@/components/Button'

type Theme = 'light' | 'dark'

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'pt-PT', label: 'Português' },
]

const THEMES: { value: Theme; descKey: string; iconClass: string }[] = [
  {
    value: 'light',
    descKey: 'settings.appearance.lightDesc',
    iconClass: 'theme-light-swatch border-amber-100 bg-amber-50',
  },
  {
    value: 'dark',
    descKey: 'settings.appearance.darkDesc',
    iconClass: 'border-slate-600 bg-slate-900',
  },
]

const Settings = () => {
  const { t, i18n } = useTranslation()

  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('theme') === 'dark' ? 'dark' : 'light'),
  )
  const savedTheme = useRef(theme)
  const [language, setLanguage] = useState(
    () => (i18n.resolvedLanguage?.startsWith('pt') ? 'pt-PT' : 'en'),
  )
  const [popup, setPopup] = useState<{ type: 'success' | 'error'; key: number } | null>(null)

  useEffect(
    () => () => {
      document.documentElement.classList.toggle('theme-dark', savedTheme.current === 'dark')
    },
    [],
  )

  useEffect(() => {
    if (!popup) return
    const timeoutId = window.setTimeout(() => setPopup(null), 4000)
    return () => window.clearTimeout(timeoutId)
  }, [popup])

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
        <div
          key={popup.key}
          role={popup.type === 'success' ? 'status' : 'alert'}
          aria-live={popup.type === 'success' ? 'polite' : 'assertive'}
          className={`operation-popup operation-popup-${popup.type}`}
        >
          <p className="text-xl font-semibold">{t(`settings.popup.${popup.type}.title`)}</p>
          <p className="mt-1 text-sm">{t(`settings.popup.${popup.type}.description`)}</p>
        </div>
      )}
    </Card>
  )
}

export default Settings