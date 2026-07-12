import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: 'public',
  server: { port: 3024 },
  preview: { port: 3024 },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 5000,
    // @agent8/gameserver는 배포시에만 설치되는 선택적 의존성 — 미설치 빌드에서 external 처리.
    rollupOptions: { external: ['@agent8/gameserver'] },
  },
})
