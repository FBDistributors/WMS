import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import commonUz from './uz/common.json'
import authUz from './uz/auth.json'
import adminUz from './uz/admin.json'
import pickingUz from './uz/picking.json'
import productsUz from './uz/products.json'
import ordersUz from './uz/orders.json'
import locationsUz from './uz/locations.json'
import receivingUz from './uz/receiving.json'
import inventoryUz from './uz/inventory.json'
import brandsUz from './uz/brands.json'
import usersUz from './uz/users.json'

import commonEn from './en/common.json'
import authEn from './en/auth.json'
import adminEn from './en/admin.json'
import pickingEn from './en/picking.json'
import productsEn from './en/products.json'
import ordersEn from './en/orders.json'
import locationsEn from './en/locations.json'
import receivingEn from './en/receiving.json'
import inventoryEn from './en/inventory.json'
import brandsEn from './en/brands.json'
import usersEn from './en/users.json'

import commonRu from './ru/common.json'
import authRu from './ru/auth.json'
import adminRu from './ru/admin.json'
import pickingRu from './ru/picking.json'
import productsRu from './ru/products.json'
import ordersRu from './ru/orders.json'
import locationsRu from './ru/locations.json'
import receivingRu from './ru/receiving.json'
import inventoryRu from './ru/inventory.json'
import brandsRu from './ru/brands.json'
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
      locations: locationsUz,
      receiving: receivingUz,
      inventory: inventoryUz,
      brands: brandsUz,
      users: usersUz,
    },
    en: {
      common: commonEn,
      auth: authEn,
      admin: adminEn,
      picking: pickingEn,
      products: productsEn,
      orders: ordersEn,
      locations: locationsEn,
      receiving: receivingEn,
      inventory: inventoryEn,
      brands: brandsEn,
      users: usersEn,
    },
    ru: {
      common: commonRu,
      auth: authRu,
      admin: adminRu,
      picking: pickingRu,
      products: productsRu,
      orders: ordersRu,
      locations: locationsRu,
      receiving: receivingRu,
      inventory: inventoryRu,
      brands: brandsRu,
      users: usersRu,
    },
  },
  lng: SUPPORTED_LANGS.includes(storedLanguage as (typeof SUPPORTED_LANGS)[number])
    ? (storedLanguage as string)
    : 'uz',
  fallbackLng: 'en',
  supportedLngs: SUPPORTED_LANGS,
  defaultNS: 'common',
    ns: ['common', 'auth', 'admin', 'picking', 'products', 'orders', 'locations', 'receiving', 'inventory', 'brands', 'users'],
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
