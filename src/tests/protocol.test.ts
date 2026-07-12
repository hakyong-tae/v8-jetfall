// src/tests/protocol.test.ts
import { describe, it, expect } from 'vitest'
import { MSG, isMsg, encodeInput, decodeInput, type InputMsg,
  encodeSnapshot, decodeSnapshot, type SnapshotSprite, type SnapshotMsg,
  encodeBullet, decodeBullet, type BulletMsg, type KillMsg, type FlagState } from '../net/protocol'

describe('protocol message kinds', () => {
  it('has stable string kinds for lobby/game events', () => {
    expect(MSG.INPUT).toBe('input')
    expect(MSG.SNAPSHOT).toBe('snap')
    expect(MSG.BULLET).toBe('bul')
    expect(MSG.KILL).toBe('kill')
    expect(MSG.START).toBe('start')
  })
  it('isMsg narrows a known kind', () => {
    expect(isMsg('input')).toBe(true)
    expect(isMsg('nope')).toBe(false)
  })
})

describe('INPUT binary round-trip', () => {
  const sample: InputMsg = {
    seq: 123456,
    left: true, right: false, up: true, down: false,
    fire: false, jetpack: true, throwNade: false, changeWeapon: true,
    throwWeapon: false, reload: true, prone: false, flagThrow: true,
    mouseAimX: -1234, mouseAimY: 5678,
  }
  it('encodes to a compact fixed-size buffer and decodes to the same fields', () => {
    const buf = encodeInput(sample)
    expect(buf.byteLength).toBe(10) // 4(seq) + 2(bits) + 2(mouseX) + 2(mouseY)
    expect(decodeInput(buf)).toEqual(sample)
  })
  it('all-false/zero input round-trips', () => {
    const zero: InputMsg = { seq: 0, left: false, right: false, up: false, down: false,
      fire: false, jetpack: false, throwNade: false, changeWeapon: false,
      throwWeapon: false, reload: false, prone: false, flagThrow: false,
      mouseAimX: 0, mouseAimY: 0 }
    expect(decodeInput(encodeInput(zero))).toEqual(zero)
  })
  it('seq wraps safely at Uint32 boundary', () => {
    const s: InputMsg = { ...sample, seq: 0xffffffff }
    expect(decodeInput(encodeInput(s)).seq).toBe(0xffffffff)
  })
})

function sampleSprite(num: number): SnapshotSprite {
  return {
    num, team: 1, direction: -1, deadMeat: false,
    health: 137, jetsCount: 42,
    legsAnimId: 3, legsFrame: 7, bodyAnimId: 9, bodyFrame: 12,
    lastInputSeq: 555,
    posX: 1234.5, posY: -678.25, velX: 2.5, velY: -0.125,
    kills: 2, deaths: 3,
    control: { left: true, right: false, up: false, down: true, fire: false, jetpack: true,
      throwNade: false, changeWeapon: false, throwWeapon: false, reload: false, prone: false,
      flagThrow: false, mouseAimX: 900, mouseAimY: -400 },
  }
}

describe('SNAPSHOT binary round-trip', () => {
  it('MSG.ASSIGN is registered', () => {
    expect(MSG.ASSIGN).toBe('assign')
    expect(isMsg(MSG.ASSIGN)).toBe(true)
  })
  it('round-trips an empty snapshot', () => {
    const msg: SnapshotMsg = { tick: 999, teamScore1: 0, teamScore2: 0, sprites: [] }
    const d = decodeSnapshot(encodeSnapshot(msg))
    expect(d.tick).toBe(999)
    expect(d.sprites).toEqual([])
    expect(d.flags).toEqual([])
  })
  it('round-trips N sprites (order preserved, floats within Float32 epsilon)', () => {
    const msg: SnapshotMsg = { tick: 42, teamScore1: 0, teamScore2: 0,
      sprites: [sampleSprite(1), sampleSprite(7), sampleSprite(32)] }
    const decoded = decodeSnapshot(encodeSnapshot(msg))
    expect(decoded.tick).toBe(42)
    expect(decoded.sprites.map((s) => s.num)).toEqual([1, 7, 32])
    expect(decoded.sprites[0].posX).toBeCloseTo(1234.5, 3)
    expect(decoded.sprites[0].control).toEqual(msg.sprites[0].control)
    expect(decoded.sprites[0].deadMeat).toBe(false)
  })
  it('8-sprite snapshot stays under 420 bytes (bandwidth bound, Phase C 37B/sprite)', () => {
    const msg: SnapshotMsg = { tick: 1, teamScore1: 0, teamScore2: 0,
      sprites: Array.from({ length: 8 }, (_, i) => sampleSprite(i + 1)) }
    const bytes = encodeSnapshot(msg).byteLength
    expect(bytes).toBeLessThanOrEqual(420)
    // 실측치: 헤더 8B + 8 × 37B/스프라이트 = 304B (CTF 깃발 없을 때). 30Hz ≈ 9KB/s.
  })
})

describe('BULLET binary round-trip', () => {
  const sample: BulletMsg = {
    seq: 77, owner: 3, weaponNum: 5, style: 2,
    hitMultiply: 1.25, seed: -12345,
    posX: 1000.5, posY: -200.25, velX: 12.5, velY: -3.75,
  }
  it('encodes to a compact fixed-size buffer and decodes to the same fields', () => {
    const buf = encodeBullet(sample)
    expect(buf.byteLength).toBe(31)
    const d = decodeBullet(buf)
    expect(d.seq).toBe(77); expect(d.owner).toBe(3); expect(d.weaponNum).toBe(5); expect(d.style).toBe(2)
    expect(d.seed).toBe(-12345)
    expect(d.hitMultiply).toBeCloseTo(1.25, 4)
    expect(d.posX).toBeCloseTo(1000.5, 3); expect(d.velY).toBeCloseTo(-3.75, 3)
  })
})

describe('SNAPSHOT extended with kills/deaths/teamScore/flags (Phase C)', () => {
  function sprite(num: number, kills: number, deaths: number): SnapshotSprite {
    return {
      num, team: 1, direction: 1, deadMeat: false, health: 100, jetsCount: 0,
      legsAnimId: 1, legsFrame: 1, bodyAnimId: 1, bodyFrame: 1, lastInputSeq: 0,
      posX: 0, posY: 0, velX: 0, velY: 0, kills, deaths,
      control: { left: false, right: false, up: false, down: false, fire: false, jetpack: false,
        throwNade: false, changeWeapon: false, throwWeapon: false, reload: false, prone: false,
        flagThrow: false, mouseAimX: 0, mouseAimY: 0 },
    }
  }
  it('round-trips kills/deaths per sprite and teamScore in the header', () => {
    const msg = { tick: 5, teamScore1: 3, teamScore2: 1, sprites: [sprite(1, 4, 2), sprite(2, 0, 5)] }
    const d = decodeSnapshot(encodeSnapshot(msg))
    expect(d.teamScore1).toBe(3); expect(d.teamScore2).toBe(1)
    expect(d.sprites[0].kills).toBe(4); expect(d.sprites[0].deaths).toBe(2)
    expect(d.sprites[1].kills).toBe(0); expect(d.sprites[1].deaths).toBe(5)
  })
  it('round-trips an optional flags[] block (CTF) — absent block encodes as 0 flags', () => {
    const noFlags = { tick: 1, teamScore1: 0, teamScore2: 0, sprites: [] }
    expect(decodeSnapshot(encodeSnapshot(noFlags)).flags).toEqual([])
    const withFlags = {
      tick: 1, teamScore1: 0, teamScore2: 0, sprites: [],
      flags: [
        { style: 1, thingNum: 3, holdingSprite: 0, posX: 500, posY: -100 },
        { style: 2, thingNum: 4, holdingSprite: 7, posX: -300, posY: 50 },
      ] as FlagState[],
    }
    const d = decodeSnapshot(encodeSnapshot(withFlags))
    expect(d.flags).toHaveLength(2)
    expect(d.flags![1].holdingSprite).toBe(7)
    expect(d.flags![1].posX).toBeCloseTo(-300, 2)
  })
  it('8-sprite CTF snapshot stays under 420 bytes (bandwidth bound, up from Phase B 320B)', () => {
    const msg = {
      tick: 1, teamScore1: 5, teamScore2: 3,
      sprites: Array.from({ length: 8 }, (_, i) => sprite(i + 1, 2, 1)),
      flags: [
        { style: 1, thingNum: 1, holdingSprite: 0, posX: 0, posY: 0 },
        { style: 2, thingNum: 2, holdingSprite: 0, posX: 0, posY: 0 },
      ] as FlagState[],
    }
    const bytes = encodeSnapshot(msg).byteLength
    expect(bytes).toBeLessThanOrEqual(420)
    // 실측: 헤더 8B + 8×37B(스프라이트) + 2×11B(깃발) = 8+296+22 = 326B. 30Hz ≈ 9.8KB/s.
  })
})

describe('KILL message shape (Phase C)', () => {
  it('is a plain JSON-friendly object (killer/victim/weaponNum)', () => {
    const km: KillMsg = { killer: 3, victim: 7, weaponNum: 5 }
    expect(km.killer).toBe(3)
    expect(km.victim).toBe(7)
    expect(km.weaponNum).toBe(5)
  })
})
