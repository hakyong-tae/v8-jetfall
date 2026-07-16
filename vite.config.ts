import { defineConfig, defaultExclude } from 'vitest/config'

export default defineConfig({
  publicDir: 'public',
  server: { port: 3024 },
  preview: { port: 3024 },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 5000,
  },
  // server/test/*는 Verse8 플랫폼(agent8 $global/$room 런타임)이 자체 실행하는 테스트라
  // 우리 vitest에서 제외한다(넷코드 유닛은 src/tests/*가 커버).
  test: { exclude: [...defaultExclude, 'server/**'] },
})
