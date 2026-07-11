import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { TAnimation, loadAnimObjects } from '../core/anims'

const animsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets/anims')

function readLines(filename: string): string[] {
  const content = readFileSync(path.join(animsDir, filename), 'utf-8')
  return content.split(/\r\n|\r|\n/)
}

describe('TAnimation.loadFromFile', () => {
  it('loads stoi.poa (stand) with frames and positions', () => {
    const anim = new TAnimation()
    anim.loadFromFile(readLines('stoi.poa'))
    expect(anim.numFrames).toBeGreaterThan(0)
    expect(anim.frames[1].pos[1]).toBeDefined()
    expect(anim.frames[1].pos[1].x).not.toBe(0)
    // Anims.pas: CurrFrame := 1 at the end of LoadFromFile
    expect(anim.currFrame).toBe(1)
    // stoi.poa has 16 NEXTFRAME markers -> NumFrames starts at 1 and is incremented
    // once per NEXTFRAME line, so the file yields 17 frames.
    expect(anim.numFrames).toBe(17)
  })

  it('does not populate the unused Y column (Pascal only reads X and Z into Pos.X/Pos.Y)', () => {
    const anim = new TAnimation()
    anim.loadFromFile(readLines('stoi.poa'))
    // TVector3.z is never assigned by Anims.pas LoadFromFile (only .X and .Y are set)
    expect(anim.frames[1].pos[1].z).toBe(0)
  })
})

describe('TAnimation.doAnimation', () => {
  it('advances CurrFrame every Speed calls to DoAnimation and loops when Loop=true', () => {
    const anim = new TAnimation()
    anim.numFrames = 3
    anim.speed = 2
    anim.loop = true
    anim.currFrame = 1
    anim.count = 0

    anim.doAnimation() // count=1, no advance
    expect(anim.currFrame).toBe(1)
    anim.doAnimation() // count=2=speed -> advance to frame 2, count reset
    expect(anim.currFrame).toBe(2)
    expect(anim.count).toBe(0)

    anim.doAnimation()
    anim.doAnimation() // advance to frame 3
    expect(anim.currFrame).toBe(3)

    anim.doAnimation()
    anim.doAnimation() // advance past NumFrames(3) -> loop back to 1
    expect(anim.currFrame).toBe(1)
  })

  it('clamps at NumFrames when Loop=false', () => {
    const anim = new TAnimation()
    anim.numFrames = 2
    anim.speed = 1
    anim.loop = false
    anim.currFrame = 1
    anim.count = 0

    anim.doAnimation() // advance to 2
    expect(anim.currFrame).toBe(2)
    anim.doAnimation() // would advance to 3 > NumFrames(2) -> clamp to NumFrames
    expect(anim.currFrame).toBe(2)
  })
})

describe('loadAnimObjects', () => {
  // Anims.pas LoadAnimObjects (lines 147-360) registers exactly 44 animations (IDs 0..43,
  // Stand through Own). This test's `read` callback loads the real .poa fixtures from
  // public/assets/anims so registration is exercised against real data.
  const animations = loadAnimObjects((filename) => readLines(filename.replace(/^anims\//, '')))

  it('registers all 44 animations from Anims.pas LoadAnimObjects', () => {
    expect(Object.keys(animations).length).toBe(44)
  })

  it('stand loops (Anims.pas: Stand.Loop := True) with speed 3', () => {
    expect(animations.stand.loop).toBe(true)
    expect(animations.stand.speed).toBe(3)
    expect(animations.stand.id).toBe(0)
  })

  it('run loops (Anims.pas: Run.Loop := True) and has multiple frames', () => {
    expect(animations.run.loop).toBe(true)
    expect(animations.run.numFrames).toBeGreaterThan(1)
    expect(animations.run.id).toBe(1)
  })

  it('jump does not loop and uses default speed 1 (Anims.pas sets no Speed/Loop for Jump)', () => {
    expect(animations.jump.loop).toBe(false)
    expect(animations.jump.speed).toBe(1)
    expect(animations.jump.id).toBe(3)
  })

  it('spot-check speed values against Anims.pas registrations', () => {
    // Anims.pas: Barret.Speed := 9;
    expect(animations.barret.speed).toBe(9)
    // Anims.pas: Piss.Speed := 8;
    expect(animations.piss.speed).toBe(8)
    // Anims.pas: ClipOut.Speed := 3; ClipIn.Speed := 3;
    expect(animations.clipOut.speed).toBe(3)
    expect(animations.clipIn.speed).toBe(3)
  })

  it('own is the last registration (ID 43)', () => {
    expect(animations.own.id).toBe(43)
  })
})

describe('anims fixture sanity', () => {
  it('public/assets/anims contains at least the 44 .poa files referenced by LoadAnimObjects', () => {
    const files = readdirSync(animsDir).filter((f) => f.endsWith('.poa'))
    expect(files.length).toBeGreaterThanOrEqual(44)
  })
})
