// 1:1 포팅: soldat-ref/soldat/shared/Anims.pas (403 lines)
// Animation Unit — skeleton pose animations (.poa files), stepped by DoAnimation and
// consumed by the physics skeleton (Parts.ts ParticleSystem) to pull the ragdoll body along.
import { TVector3 } from './vector'

export const MAX_POS_INDEX = 20
export const MAX_FRAMES_INDEX = 40

// Anims.pas: const SCALE = 3; — a local constant, not shared with Constants.pas, but happens
// to have the same numeric value as constants.ts SCALE. Kept as its own local constant here
// to mirror the Pascal unit boundary exactly (a change to Constants.SCALE must not silently
// change animation loading).
const SCALE = 3

// Pascal: TFrame = record Pos: array[1..MAX_POS_INDEX] of TVector3; end;
// 1-indexed to match Pascal array bounds (index 0 unused, like ParticleSystem in parts.ts).
export interface TFrame {
  pos: TVector3[]
}

function makeFrame(): TFrame {
  return {
    pos: Array.from({ length: MAX_POS_INDEX + 1 }, () => ({ x: 0, y: 0, z: 0 })),
  }
}

// Pascal: TAnimation = object ... end;
export class TAnimation {
  id = 0
  // 1-indexed to match Pascal array[1..MAX_FRAMES_INDEX] of TFrame
  frames: TFrame[]
  numFrames = 1
  speed = 1
  count = 0
  currFrame = 1
  loop = false

  constructor() {
    this.frames = Array.from({ length: MAX_FRAMES_INDEX + 1 }, () => makeFrame())
  }

  // Anims.pas: procedure TAnimation.DoAnimation
  doAnimation(): void {
    this.count++
    if (this.count === this.speed) {
      this.count = 0
      this.currFrame++
      if (this.currFrame > this.numFrames) {
        if (this.loop) this.currFrame = 1
        else this.currFrame = this.numFrames
      }
    }
  }

  // Anims.pas: procedure TAnimation.LoadFromFile(Filename: string)
  // Filename: string → replaced with pre-loaded `lines` (PhysFS file IO not available in this
  // port), same pattern as ParticleSystem.loadPOObject in parts.ts.
  loadFromFile(lines: string[]): void {
    let cursor = 0
    const readLn = (): string => {
      const line = cursor < lines.length ? lines[cursor] : ''
      cursor++
      return line.trim()
    }

    this.numFrames = 1

    // default settings
    this.loop = false
    this.speed = 1
    this.count = 0

    let r1 = readLn()
    while (r1 !== 'ENDFILE') {
      if (r1 === 'NEXTFRAME') {
        if (this.numFrames === MAX_FRAMES_INDEX) {
          // Anims.pas: Debug('Corrupted frame index: ' + Filename); Break;
          break
        }
        this.numFrames++
      } else {
        const r2 = readLn() // X
        readLn() // Y — read but never used (Anims.pas only assigns Pos.X/Pos.Y from r2/r4)
        const r4 = readLn() // Z

        const parsed = parseInt(r1, 10)
        const p = Number.isNaN(parsed) ? 0 : parsed // StrToIntDef(r1, 0)
        if (p >= 1 && p <= MAX_POS_INDEX) {
          // TODO: check if this is correct (preserved verbatim from Anims.pas comment)
          this.frames[this.numFrames].pos[p].x = (-SCALE * parseFloat(r2)) / 1.1
          this.frames[this.numFrames].pos[p].y = -SCALE * parseFloat(r4)
        }
        // else: Anims.pas: Debug('Corrupted Index (' + r1 + '): ' + Filename) — omitted, no
        // logging sink wired up in this port.
      }

      r1 = readLn()
    }

    this.currFrame = 1
  }

  // Anims.pas: function TAnimation.CheckSum: Integer
  checkSum(): number {
    let chk = 0.5
    for (let i = 1; i <= this.numFrames; i++) {
      for (let j = 1; j <= 20; j++) {
        chk += this.frames[i].pos[j].x
        chk += this.frames[i].pos[j].y
        chk += this.frames[i].pos[j].z
      }
    }
    return Math.trunc(chk)
  }
}

interface AnimRegistration {
  key: string
  id: number
  filename: string
  loop?: boolean
  speed?: number
}

// Anims.pas LoadAnimObjects (lines 147-360): registers 44 global TAnimation variables
// (Stand through Own, IDs 0..43). Order, filenames, IDs, Loop and Speed values below are
// translated verbatim from the Pascal registration sequence. The remaining part of
// LoadAnimObjects (SpriteParts/GostekSkeleton/BoxSkeleton/BulletParts/SparkParts/
// FlagSkeleton/ParaSkeleton/StatSkeleton/RifleSkeleton* ParticleSystem setup) is out of
// scope for this unit — that belongs to whichever module owns skeleton/particle-system
// wiring (parts.ts / sprites.ts).
const REGISTRATIONS: AnimRegistration[] = [
  { key: 'stand', id: 0, filename: 'stoi.poa', loop: true, speed: 3 },
  { key: 'run', id: 1, filename: 'biega.poa', loop: true },
  { key: 'runBack', id: 2, filename: 'biegatyl.poa', loop: true },
  { key: 'jump', id: 3, filename: 'skok.poa' },
  { key: 'jumpSide', id: 4, filename: 'skokwbok.poa' },
  { key: 'fall', id: 5, filename: 'spada.poa' },
  { key: 'crouch', id: 6, filename: 'kuca.poa' },
  { key: 'crouchRun', id: 7, filename: 'kucaidzie.poa', loop: true, speed: 2 },
  { key: 'reload', id: 8, filename: 'laduje.poa', speed: 2 },
  { key: 'throw', id: 9, filename: 'rzuca.poa', speed: 1 },
  { key: 'recoil', id: 10, filename: 'odrzut.poa' },
  { key: 'smallRecoil', id: 11, filename: 'odrzut2.poa' },
  { key: 'shotgun', id: 12, filename: 'shotgun.poa' },
  { key: 'clipOut', id: 13, filename: 'clipout.poa', speed: 3 },
  { key: 'clipIn', id: 14, filename: 'clipin.poa', speed: 3 },
  { key: 'slideBack', id: 15, filename: 'slideback.poa', speed: 2, loop: true },
  { key: 'change', id: 16, filename: 'change.poa', loop: false },
  { key: 'throwWeapon', id: 17, filename: 'wyrzuca.poa', loop: false },
  { key: 'weaponNone', id: 18, filename: 'bezbroni.poa', speed: 3 },
  { key: 'punch', id: 19, filename: 'bije.poa', loop: false },
  { key: 'reloadBow', id: 20, filename: 'strzala.poa' },
  { key: 'barret', id: 21, filename: 'barret.poa', speed: 9 },
  { key: 'roll', id: 22, filename: 'skokdolobrot.poa', speed: 1 },
  { key: 'rollBack', id: 23, filename: 'skokdolobrottyl.poa', speed: 1 },
  { key: 'crouchRunBack', id: 24, filename: 'kucaidzietyl.poa', loop: true, speed: 2 },
  { key: 'cigar', id: 25, filename: 'cigar.poa', speed: 3 },
  { key: 'match', id: 26, filename: 'match.poa', speed: 3 },
  { key: 'smoke', id: 27, filename: 'smoke.poa', speed: 4 },
  { key: 'wipe', id: 28, filename: 'wipe.poa', speed: 4 },
  { key: 'groin', id: 29, filename: 'krocze.poa', speed: 2 },
  { key: 'piss', id: 30, filename: 'szcza.poa', speed: 8 },
  { key: 'mercy', id: 31, filename: 'samo.poa', speed: 3 },
  { key: 'mercy2', id: 32, filename: 'samo2.poa', speed: 3 },
  { key: 'takeOff', id: 33, filename: 'takeoff.poa', speed: 2 },
  { key: 'prone', id: 34, filename: 'lezy.poa', speed: 1 },
  { key: 'victory', id: 35, filename: 'cieszy.poa', speed: 3 },
  { key: 'aim', id: 36, filename: 'celuje.poa', speed: 2 },
  { key: 'handsUpAim', id: 37, filename: 'gora.poa', speed: 2 },
  { key: 'proneMove', id: 38, filename: 'lezyidzie.poa', loop: true, speed: 2 },
  { key: 'getUp', id: 39, filename: 'wstaje.poa', speed: 1 },
  { key: 'aimRecoil', id: 40, filename: 'celujeodrzut.poa', speed: 1 },
  { key: 'handsUpRecoil', id: 41, filename: 'goraodrzut.poa', speed: 1 },
  { key: 'melee', id: 42, filename: 'kolba.poa', speed: 1 },
  { key: 'own', id: 43, filename: 'rucha.poa', speed: 3 },
]

// Anims.pas: procedure LoadAnimObjects(ModDir: string)
// `read` replaces PhysFS file IO: given 'anims/<file>.poa' it must return the file's lines
// (same pattern as loadPOObject's `lines: string[]` parameter in parts.ts).
export function loadAnimObjects(read: (filename: string) => string[]): Record<string, TAnimation> {
  const animations: Record<string, TAnimation> = {}

  for (const reg of REGISTRATIONS) {
    const anim = new TAnimation()
    anim.loadFromFile(read(`anims/${reg.filename}`))
    anim.id = reg.id
    if (reg.loop !== undefined) anim.loop = reg.loop
    if (reg.speed !== undefined) anim.speed = reg.speed
    animations[reg.key] = anim
  }

  return animations
}
