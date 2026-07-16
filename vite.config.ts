import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: 'public',
  server: { port: 3024 },
  preview: { port: 3024 },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 5000,
  },
})
