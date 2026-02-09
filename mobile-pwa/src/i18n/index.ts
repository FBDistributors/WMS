import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import commonUz from './uz/common.json'
import authUz from './uz/auth.json'
import adminUz from './uz/admin.json'
import pickingUz from './uz/picking.json'
import productsUz from './uz/products.json'
import ordersUz from './uz/orders.json'
import usersUz from './uz/users.json'

import commonEn from './en/common.json'
import authEn from './en/auth.json'
import adminEn from './en/admin.json'
import pickingEn from './en/picking.json'
import productsEn from './en/products.json'
import ordersEn from './en/orders.json'
import usersEn from './en/users.json'

import commonRu from './ru/common.json'
import authRu from './ru/auth.json'
import adminRu from './ru/admin.json'
import pickingRu from './ru/picking.json'
import productsRu from './ru/products.json'
import ordersRu from './ru/orders.json'
import usersRu from './ru/users.json'

const SUPPORTED_LANGS = ['uz', 'en', 'ru'] as const
const STORAGE_KEY = 'wms_lang'

const storedLanguage = (() => {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(STORAGE_KEY)
})()

i18n.use(initReactI18next).init({
  resources: {
    uz: {
      common: commonUz,
      auth: authUz,
      admin: adminUz,
      picking: pickingUz,
      products: productsUz,
      orders: ordersUz,
      users: usersUz,
    },
    en: {
      common: commonEn,
      auth: authEn,
      admin: adminEn,
      picking: pickingEn,
      products: productsEn,
      orders: ordersEn,
      users: usersEn,
    },
    ru: {
      common: commonRu,
      auth: authRu,
      admin: adminRu,
      picking: pickingRu,
      products: productsRu,
      orders: ordersRu,
      users: usersRu,
    },
  },
  lng: SUPPORTED_LANGS.includes(storedLanguage as (typeof SUPPORTED_LANGS)[number])
    ? (storedLanguage as string)
    : 'uz',
  fallbackLng: 'en',
  supportedLngs: SUPPORTED_LANGS,
  defaultNS: 'common',
  ns: ['common', 'auth', 'admin', 'picking', 'products', 'orders', 'users'],
  interpolation: {
    escapeValue: false,
  },
})

i18n.on('languageChanged', (lng) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, lng)
})

export const supportedLanguages = SUPPORTED_LANGS
export default i18n
