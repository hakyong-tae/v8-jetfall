import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ParticleSystem } from '../core/parts'
import { vector2 } from '../core/vector'

describe('ParticleSystem.verlet', () => {
  it('free fall with vDamping=1 (pure Verlet): pos = 2*pos - old + g*dt²', () => {
    const ps = new ParticleSystem()
    ps.timeStep = 1; ps.gravity = 1; ps.vDamping = 1; ps.eDamping = 1
    ps.createPart(vector2(100, 100), vector2(0, 0), 1, 1)
    ps.doVerletTimeStep()
    expect(ps.pos[1]).toEqual({ x: 100, y: 101 })
    ps.doVerletTimeStep()
    expect(ps.pos[1]).toEqual({ x: 100, y: 103 })
    ps.doVerletTimeStep()
    expect(ps.pos[1]).toEqual({ x: 100, y: 106 })
  })
  it('constraint pulls two particles toward rest length', () => {
    const ps = new ParticleSystem()
    ps.timeStep = 1; ps.gravity = 0; ps.vDamping = 1; ps.eDamping = 1
    ps.createPart(vector2(0, 0), vector2(0, 0), 1, 1)
    ps.createPart(vector2(10, 0), vector2(0, 0), 1, 2)
    ps.makeConstraint(1, 2, 5)
    ps.satisfyConstraints()
    expect(ps.pos[1].x).toBeCloseTo(2.5)
    expect(ps.pos[2].x).toBeCloseTo(7.5)
  })
  it('euler step: vel += F/m*dt², pos += vel, vel *= eDamping', () => {
    const ps = new ParticleSystem()
    ps.timeStep = 1; ps.gravity = 1; ps.vDamping = 1; ps.eDamping = 0.99
    ps.createPart(vector2(0, 0), vector2(2, 0), 1, 1)
    ps.doEulerTimeStep()
    expect(ps.pos[1]).toEqual({ x: 2, y: 1 })
    expect(ps.velocity[1].x).toBeCloseTo(2 * 0.99)
    expect(ps.velocity[1].y).toBeCloseTo(1 * 0.99)
  })
})

describe('ParticleSystem.loadPOObject', () => {
  it('loads the real gostek.po fixture', () => {
    const poPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../public/assets/anims/gostek.po',
    )
    const content = readFileSync(poPath, 'utf-8')
    const lines = content.split(/\r\n|\r|\n/)
    const ps = new ParticleSystem()
    ps.loadPOObject(lines, 1)
    expect(ps.partCount).toBeGreaterThan(0)
    expect(ps.constraintCount).toBeGreaterThan(0)
    expect(ps.active[1]).toBe(true)
  })
})
