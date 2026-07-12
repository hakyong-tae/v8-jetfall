// src/tests/node-transport.test.ts
import { describe, it, expect } from 'vitest'
import { resolveHostTransport, type Agent8Attempt } from '../../server/node-transport'

describe('resolveHostTransport (D-phase decision gate)', () => {
  it('uses the agent8-in-node transport when the injected attempt resolves online', async () => {
    const fakeAttempt: Agent8Attempt = async () => ({ status: 'online', account: 'host' } as any)
    const result = await resolveHostTransport({ attemptAgent8: fakeAttempt, wsPort: 0 })
    expect(result.mode).toBe('agent8')
  })

  it('falls back to own-ws when the injected attempt rejects (package missing / connect failed)', async () => {
    const fakeAttempt: Agent8Attempt = async () => { throw new Error('Cannot find package @agent8/gameserver') }
    const result = await resolveHostTransport({ attemptAgent8: fakeAttempt, wsPort: 0 })
    expect(result.mode).toBe('own-ws')
    await result.close()
  })

  it('falls back to own-ws when the attempt times out', async () => {
    const hangingAttempt: Agent8Attempt = () => new Promise(() => {}) // never resolves
    const result = await resolveHostTransport({ attemptAgent8: hangingAttempt, wsPort: 0, timeoutMs: 50 })
    expect(result.mode).toBe('own-ws')
    await result.close()
  })
})
