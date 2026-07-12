// src/tests/host-boot.test.ts — `npm run host`가 실제로 기동해 틱을 도는지 자식프로세스로 검증.
// 실 배포(agent8/ws 외부노출) 없이도 검증 가능하도록 --transport loopback-selftest 스텁 사용.
import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const bundlePath = path.resolve(__dirname, '../../dist-server/host.mjs')

describe('dedicated Node host boots headless (M3-D completion criterion)', () => {
  it('ticks and logs snapshot broadcasts for a few seconds, then exits cleanly on SIGINT', async () => {
    expect(existsSync(bundlePath)).toBe(true) // `npm run build:host`를 이 테스트 전에 실행해둘 것(CI 순서)

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
