import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

export default defineConfig({
  preset: minimal2023Preset,
  images: ['public/logo-icon.png'],
  overrideManifestIcons: true,
  assets: {
    maskable: {
      sizes: [512],
      resizeOptions: { fit: 'contain', background: '#1e40af' },
    },
    apple: {
      sizes: [180],
      resizeOptions: { fit: 'contain', background: '#1e40af' },
    },
  },
})
