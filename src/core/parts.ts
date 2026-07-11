// 1:1 포팅: soldat-ref/soldat/shared/Parts.pas
// PARTS ver. 1.0.7 — PARTICLE & CONSTRAINT PHYSICS MODULE (Verlet + Euler integrators)
import { TVector2, vector2, cloneVec2, vec2Add, vec2Subtract, vec2Scale, vec2Dot } from './vector'

export const NUM_PARTICLES = 560
// RKV in the original Pascal source is declared but never referenced by any procedure — preserved as a
// faithfully-unused constant for parity with Parts.pas.
export const RKV = 0.98

export interface Constraint { active: boolean; partA: number; partB: number; restLength: number }

export class ParticleSystem {
  active: boolean[]
  pos: TVector2[]
  velocity: TVector2[]
  oldPos: TVector2[]
  forces: TVector2[]
  oneOverMass: number[]
  timeStep = 0
  gravity = 0
  vDamping = 0
  eDamping = 0
  constraintCount = 0
  partCount = 0
  constraints: Constraint[]

  constructor() {
    // 1-based arrays: index 0 unused, allocate NUM_PARTICLES+1 slots
    this.active = new Array(NUM_PARTICLES + 1).fill(false)
    this.pos = Array.from({ length: NUM_PARTICLES + 1 }, () => vector2(0, 0))
    this.velocity = Array.from({ length: NUM_PARTICLES + 1 }, () => vector2(0, 0))
    this.oldPos = Array.from({ length: NUM_PARTICLES + 1 }, () => vector2(0, 0))
    this.forces = Array.from({ length: NUM_PARTICLES + 1 }, () => vector2(0, 0))
    this.oneOverMass = new Array(NUM_PARTICLES + 1).fill(0)
    this.constraints = Array.from({ length: NUM_PARTICLES + 1 }, () => ({
      active: false,
      partA: 0,
      partB: 0,
      restLength: 0,
    }))
  }

  doVerletTimeStep(): void {
    for (let i = 1; i <= NUM_PARTICLES; i++) {
      if (this.active[i]) this.verlet(i)
    }
    this.satisfyConstraints()
  }

  doVerletTimeStepFor(i: number, j: number): void {
    this.verlet(i)
    this.satisfyConstraintsFor(j)
  }

  doEulerTimeStepFor(i: number): void {
    this.euler(i)
  }

  doEulerTimeStep(): void {
    for (let i = 1; i <= NUM_PARTICLES; i++) {
      if (this.active[i]) this.euler(i)
    }
  }

  private euler(i: number): void {
    // Accumulate Forces
    this.forces[i].y = this.forces[i].y + this.gravity
    const tempPos = cloneVec2(this.pos[i])

    let s = vec2Scale(this.forces[i], this.oneOverMass[i])
    s = vec2Scale(s, this.timeStep * this.timeStep)

    this.velocity[i] = vec2Add(this.velocity[i], s)
    this.pos[i] = vec2Add(this.pos[i], this.velocity[i])
    this.velocity[i] = vec2Scale(this.velocity[i], this.eDamping)
    this.oldPos[i] = tempPos

    this.forces[i].x = 0
    this.forces[i].y = 0
  }

  private verlet(i: number): void {
    // Accumulate Forces
    this.forces[i].y = this.forces[i].y + this.gravity
    const tempPos = cloneVec2(this.pos[i])

    // Pos[I]:= 2 * Pos[I] - OldPos[I] + Forces[I]{ / Mass} * TimeStep * TimeStep;  {Verlet integration}
    const s1a = vec2Scale(this.pos[i], 1.0 + this.vDamping)
    const s2a = vec2Scale(this.oldPos[i], this.vDamping)

    const d = vec2Subtract(s1a, s2a)
    const s1b = vec2Scale(this.forces[i], this.oneOverMass[i])
    const s2b = vec2Scale(s1b, this.timeStep * this.timeStep)

    this.pos[i] = vec2Add(d, s2b)
    this.oldPos[i] = tempPos

    this.forces[i].x = 0
    this.forces[i].y = 0
  }

  satisfyConstraints(): void {
    if (this.constraintCount > 0) {
      for (let i = 1; i <= this.constraintCount; i++) {
        const c = this.constraints[i]
        if (c.active) {
          let diff = 0
          const delta = vec2Subtract(this.pos[c.partB], this.pos[c.partA])
          const deltaLength = Math.sqrt(vec2Dot(delta, delta))
          if (deltaLength !== 0) diff = (deltaLength - c.restLength) / deltaLength
          if (this.oneOverMass[c.partA] > 0) {
            const d = vec2Scale(delta, 0.5 * diff)
            this.pos[c.partA] = vec2Add(this.pos[c.partA], d)
          }
          if (this.oneOverMass[c.partB] > 0) {
            const d = vec2Scale(delta, 0.5 * diff)
            this.pos[c.partB] = vec2Subtract(this.pos[c.partB], d)
          }
        }
      }
    }
  }

  private satisfyConstraintsFor(i: number): void {
    const c = this.constraints[i]
    let diff = 0
    const delta = vec2Subtract(this.pos[c.partB], this.pos[c.partA])
    const deltaLength = Math.sqrt(vec2Dot(delta, delta))
    if (deltaLength !== 0) diff = (deltaLength - c.restLength) / deltaLength
    if (this.oneOverMass[c.partA] > 0) {
      const d = vec2Scale(delta, 0.5 * diff)
      this.pos[c.partA] = vec2Add(this.pos[c.partA], d)
    }
    if (this.oneOverMass[c.partB] > 0) {
      const d = vec2Scale(delta, 0.5 * diff)
      this.pos[c.partB] = vec2Subtract(this.pos[c.partB], d)
    }
  }

  createPart(start: TVector2, vel: TVector2, mass: number, num: number): void {
    // Num is now the active Part
    this.active[num] = true
    this.pos[num] = cloneVec2(start)
    this.velocity[num] = cloneVec2(vel)

    this.oldPos[num] = cloneVec2(start)
    this.oneOverMass[num] = 1 / mass
  }

  makeConstraint(pa: number, pb: number, rest: number): void {
    this.constraintCount++
    const c = this.constraints[this.constraintCount]
    c.active = true
    c.partA = pa
    c.partB = pb
    c.restLength = rest
  }

  clone(other: ParticleSystem): void {
    this.constraintCount = other.constraintCount
    this.partCount = other.partCount

    for (let i = 1; i <= this.partCount; i++) {
      this.active[i] = other.active[i]
      this.pos[i] = cloneVec2(other.pos[i])
      this.velocity[i] = cloneVec2(other.velocity[i])
      this.oldPos[i] = cloneVec2(other.oldPos[i])
      this.oneOverMass[i] = other.oneOverMass[i]
    }

    for (let i = 1; i <= this.constraintCount; i++) {
      const otherConstraint = other.constraints[i]
      const c = this.constraints[i]
      c.active = otherConstraint.active
      c.partA = otherConstraint.partA
      c.partB = otherConstraint.partB
      c.restLength = otherConstraint.restLength
    }
  }

  // Filename: string → replaced with pre-loaded `lines` (PhysFS file IO not available in this port).
  // Parsing logic (repeat-until loops, name/X/Y/Z sequence, P-prefixed constraint indices) is preserved
  // exactly from Parts.pas — only the line source changed.
  loadPOObject(lines: string[], scale: number): void {
    let cursor = 0
    const readLn = (): string => {
      const line = cursor < lines.length ? lines[cursor] : ''
      cursor++
      // PhysFS_ReadLN only strips the line terminator; trim defensively in case the
      // caller split on '\n' alone and left a trailing '\r' (CRLF source files).
      return line.trim()
    }

    const v: TVector2 = vector2(0, 0)
    let i = 0
    this.constraintCount = 0

    let nm: string

    do {
      nm = readLn() // name
      if (nm !== 'CONSTRAINTS') {
        const x = readLn() // X
        readLn() // Y (unused)
        const z = readLn() // Z

        // make object
        const p = vector2(
          (-parseFloat(x) * scale) / 1.2,
          -parseFloat(z) * scale,
        )

        i++
        this.createPart(p, v, 1, i)
      }
    } while (nm !== 'CONSTRAINTS')

    this.partCount = i

    let a: string
    do {
      // CONSTRAINTS
      a = readLn() // Part A
      if (a === 'ENDFILE') break

      let b = readLn() // Part B

      a = a.slice(1)
      b = b.slice(1)
      const pa = parseInt(a, 10)
      const pb = parseInt(b, 10)

      const delta = vec2Subtract(this.pos[pa], this.pos[pb])
      this.makeConstraint(pa, pb, Math.sqrt(vec2Dot(delta, delta)))
    } while (a !== 'ENDFILE')
  }

  stopAllParts(): void {
    for (let i = 1; i <= NUM_PARTICLES; i++) {
      if (this.active[i]) {
        this.velocity[i].x = 0
        this.velocity[i].y = 0
        this.oldPos[i] = cloneVec2(this.pos[i])
      }
    }
  }

  destroy(): void {
    for (let i = 1; i <= NUM_PARTICLES; i++) {
      this.active[i] = false
      this.pos[i].x = 0
      this.pos[i].y = 0
      this.oldPos[i] = cloneVec2(this.pos[i])
      this.velocity[i].x = 0
      this.velocity[i].y = 0
      this.forces[i].x = 0
      this.forces[i].y = 0
    }
    this.constraintCount = 0
  }
}
