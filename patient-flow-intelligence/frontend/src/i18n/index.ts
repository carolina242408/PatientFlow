import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from './en.json'
import ptPT from './pt-PT.json'

export const LANGUAGES = ['pt-PT', 'en'] as const
const STORAGE_KEY = 'locale'

let stored: string | null = null
try {
  stored = localStorage.getItem(STORAGE_KEY)
} catch {
  /* storage indisponível */
}

void i18n.use(initReactI18next).init({
  resources: { 'pt-PT': { translation: ptPT }, en: { translation: en } },
  lng: stored ?? 'pt-PT',
  fallbackLng: 'pt-PT',
  interpolation: { escapeValue: false },
})

i18n.on('languageChanged', (lng) => {
  try {
    localStorage.setItem(STORAGE_KEY, lng)
  } catch {
    /* ignorar */
  }
})

export default i18n
