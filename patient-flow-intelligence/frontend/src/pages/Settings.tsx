import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

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
    iconClass: 'border-[6px] border-amber-100 bg-amber-50',
  },
  {
    value: 'dark',
    titleKey: 'settings.appearance.dark',
    descKey: 'settings.appearance.darkDesc',
    iconClass: 'border-[6px] border-slate-600 bg-slate-900',
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
    <div className="rounded-2xl border border-gray-200 bg-white p-10 shadow-sm">
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

          <div role="radiogroup" className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            {THEMES.map((option) => {
              const selected = theme === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => handleThemePreview(option.value)}
                  className={`flex items-center gap-4 rounded-xl border p-5 text-left transition-colors ${
                    selected
                      ? 'border-blue-600 bg-blue-50'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`h-12 w-12 shrink-0 rounded-full ${option.iconClass}`}
                  />
                  <span className="flex flex-col">
                    <span className="text-base font-semibold text-slate-900">
                      {t(option.titleKey)}
                    </span>
                    <span className="text-sm text-gray-500">{t(option.descKey)}</span>
                  </span>
                </button>
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

          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="mt-5 w-full max-w-md rounded-lg border border-gray-200 bg-white px-4 py-3 text-base text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-100"
          >
            {LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.label}
              </option>
            ))}
          </select>
        </section>

        {/* Actions */}
        <div className="flex justify-end pt-8">
          <button
            type="button"
            onClick={handleSave}
            className="rounded-lg bg-blue-600 px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-blue-700"
          >
            {t('settings.save')}
          </button>
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
    </div>
  )
}

export default Settings