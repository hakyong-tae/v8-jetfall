// src/tests/host-boot.test.ts — `npm run host`가 실제로 기동해 틱을 도는지 자식프로세스로 검증.
// 실 배포(agent8/ws 외부노출) 없이도 검증 가능하도록 --transport loopback-selftest 스텁 사용.
import { describe, it, expect, beforeAll } from 'vitest'
import { spawn, execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(__dirname, '../..')
const bundlePath = path.resolve(repoRoot, 'dist-server/host.mjs')

describe('dedicated Node host boots headless (M3-D completion criterion)', () => {
  // 번들이 없으면 이 테스트가 스스로 빌드 — 실행 방식(bare `npm test`/단일파일)에 무관하게 그린 유지.
  beforeAll(() => {
    if (!existsSync(bundlePath)) execSync('npm run build:host', { cwd: repoRoot, stdio: 'ignore' })
  }, 60000)

  it('ticks and logs snapshot broadcasts for a few seconds, then exits cleanly on SIGINT', async () => {
    expect(existsSync(bundlePath)).toBe(true)

    const child = spawn('node', [bundlePath, '--room', 'boottest', '--transport', 'loopback-selftest', '--players', 'alice'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (d) => { out += String(d) })
    child.stderr.on('data', (d) => { out += String(d) })

    await new Promise((r) => setTimeout(r, 3000)) // 3초 구동 — 60Hz*3s=180틱, 스냅샷 30Hz 다수 관측 기대
    expect(out).toContain('[host] assets loaded')
    expect(out).toContain('spawned 1 player')
    expect(out).toContain('snapshot broadcast observed')
    expect(out).not.toMatch(/fatal|Error/i)

    const exitPromise = new Promise<number | null>((resolve) => child.on('exit', resolve))
    child.kill('SIGINT')
    const code = await exitPromise
    expect(code).toBe(0)
  }, 15000)
})
