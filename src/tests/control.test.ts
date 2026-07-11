// Task 10 시나리오 테스트 — controlSprite (Control.pas:68-2159) 이동 상태기계.
// 수치 정밀 검증(원본 대조)은 T13에서 — 여기서는 행동/상태 불변식만 확인한다.
//
// controlSprite는 forces/velocity/애니메이션만 쓴다 (적분·onGround 판정은 Task 11 Update 소관).
// 따라서 테스트는 onGround/direction을 직접 세팅하고, 틱 사이에 doAnimation()으로 프레임을
// 진행시키고, forces를 매 틱 0으로 리셋한다(물리 루프가 소비하는 것을 흉내).
import { describe, it, expect, beforeEach } from 'vitest'
import { setupTestGame } from './helpers'
import type { GameState } from '../core/state'
import { vector2 } from '../core/vector'
import { createSprite, createTPlayer, TSprite, randomizeStart } from '../core/sprites'
import { POS_STAND, POS_CROUCH, POS_PRONE } from '../core/sprites'
import {
  controlSprite,
  areConflictingKeysPressed,
  checkSpriteLineOfSightVisibility,
} from '../core/control'
import {
  TEAM_ALPHA,
  RUNSPEED,
  RUNSPEEDUP,
  FLYSPEED,
  JUMPSPEED,
  JETSPEED,
  CROUCHRUNSPEED,
} from '../core/constants'

function spawnAt(gs: GameState, team = TEAM_ALPHA): TSprite {
  const player = createTPlayer()
  player.name = 'Test'
  player.team = team
  const r = randomizeStart(gs, team)
  const i = createSprite(gs, r.start, vector2(0, 0), 1, 255, player, true)
  const spr = gs.sprite[i]
  // 이동 로직이 읽는 상태를 결정적으로 세팅
  spr.direction = 1
  spr.onGround = true
  spr.ceaseFireCounter = 0 // KOLBA/FIRE 게이트 무력화 (fire 미사용 테스트 기준)
  // M1 스텁 총(all-zero)은 idle 상태가 퇴화한다(ReloadTimeCount=ClipOutTime=0이 매 틱 참).
  // 실제 게임의 idle 총 상태를 흉내: Weapons.pas:1324 `ReloadTimeCount := ReloadTime`,
  // ClipOutTime = Trunc(ReloadTime*0.8) (클립 장전 총 기준).
  spr.weapon.ammo = 1
  spr.weapon.ammoCount = 1
  spr.weapon.reloadTime = 60
  spr.weapon.reloadTimeCount = 60
  spr.weapon.clipOutTime = 48
  spr.weapon.clipInTime = 12
  gs.spriteParts.forces[i] = vector2(0, 0)
  gs.spriteParts.velocity[i] = vector2(0, 0)
  return spr
}

// 한 틱: forces 리셋(물리 소비 흉내) → controlSprite → 애니메이션 프레임 진행
function tick(gs: GameState, spr: TSprite): void {
  gs.spriteParts.forces[spr.num] = vector2(0, 0)
  controlSprite(gs, spr)
  spr.legsAnimation.doAnimation()
  spr.bodyAnimation.doAnimation()
  gs.mainTickCounter++
}

describe('controlSprite — run (Control.pas:1916-1968)', () => {
  let gs: GameState
  beforeEach(() => {
    gs = setupTestGame()
  })

  it('right key held on ground: +X run force, -Y RUNSPEEDUP, legs go Run', () => {
    const spr = spawnAt(gs)
    spr.control.right = true

    for (let t = 0; t < 60; t++) {
      tick(gs, spr)
      expect(gs.spriteParts.forces[spr.num].x).toBe(RUNSPEED)
      expect(gs.spriteParts.forces[spr.num].y).toBe(-RUNSPEEDUP)
    }
    expect(spr.legsAnimation.id).toBe(gs.anims.run.id)
  })

  it('right key held while facing left (direction=-1): legs go RunBack', () => {
    const spr = spawnAt(gs)
    spr.direction = -1
    spr.control.right = true
    tick(gs, spr)
    expect(spr.legsAnimation.id).toBe(gs.anims.runBack.id)
    expect(gs.spriteParts.forces[spr.num].x).toBe(RUNSPEED)
  })

  it('left key held on ground: -X run force, legs Run when facing left', () => {
    const spr = spawnAt(gs)
    spr.direction = -1
    spr.control.left = true
    tick(gs, spr)
    expect(spr.legsAnimation.id).toBe(gs.anims.run.id)
    expect(gs.spriteParts.forces[spr.num].x).toBe(-RUNSPEED)
    expect(gs.spriteParts.forces[spr.num].y).toBe(-RUNSPEEDUP)
  })

  it('right key in the air: FLYSPEED force only', () => {
    const spr = spawnAt(gs)
    spr.onGround = false
    spr.control.right = true
    tick(gs, spr)
    expect(gs.spriteParts.forces[spr.num].x).toBe(FLYSPEED)
    expect(gs.spriteParts.forces[spr.num].y).toBe(0)
  })
})

describe('controlSprite — jump (Control.pas:1872-1898)', () => {
  let gs: GameState
  beforeEach(() => {
    gs = setupTestGame()
  })

  it('up key on ground: legs go Jump immediately, -JUMPSPEED applied during frames 9..14', () => {
    const spr = spawnAt(gs)
    spr.control.up = true

    tick(gs, spr)
    expect(spr.legsAnimation.id).toBe(gs.anims.jump.id)

    let sawJumpForce = false
    for (let t = 0; t < 30; t++) {
      // 힘이 적용된 "그 프레임"을 검사해야 하므로 doAnimation 전에 확인 (tick() 미사용)
      gs.spriteParts.forces[spr.num] = vector2(0, 0)
      controlSprite(gs, spr)
      if (gs.spriteParts.forces[spr.num].y === -JUMPSPEED) {
        expect(spr.legsAnimation.currFrame).toBeGreaterThan(8)
        expect(spr.legsAnimation.currFrame).toBeLessThan(15)
        sawJumpForce = true
      }
      spr.legsAnimation.doAnimation()
      spr.bodyAnimation.doAnimation()
    }
    expect(sawJumpForce).toBe(true)
  })

  it('up+right on ground: legs go JumpSide, diagonal force during frames 4..10', () => {
    const spr = spawnAt(gs)
    spr.control.up = true
    spr.control.right = true

    tick(gs, spr)
    expect(spr.legsAnimation.id).toBe(gs.anims.jumpSide.id)

    let sawDiag = false
    for (let t = 0; t < 30; t++) {
      tick(gs, spr)
      if (gs.spriteParts.forces[spr.num].x > 0 && gs.spriteParts.forces[spr.num].y < 0) {
        sawDiag = true
      }
    }
    expect(sawDiag).toBe(true)
  })
})

describe('controlSprite — jets (Control.pas:313-388)', () => {
  let gs: GameState
  beforeEach(() => {
    gs = setupTestGame()
  })

  it('jetpack in the air with fuel: upward force, jetsCount decreases, legs Fall', () => {
    const spr = spawnAt(gs)
    spr.onGround = false
    spr.jetsCount = 10
    spr.control.jetpack = true

    tick(gs, spr)
    // GRAV(0.06) > 0.05 → JETSPEED 사용
    expect(gs.spriteParts.forces[spr.num].y).toBe(-JETSPEED)
    expect(spr.jetsCount).toBe(9)
    expect(spr.legsAnimation.id).toBe(gs.anims.fall.id)
  })

  it('jetpack on the ground: -2.5*JETSPEED launch force', () => {
    const spr = spawnAt(gs)
    spr.jetsCount = 10
    spr.control.jetpack = true

    tick(gs, spr)
    expect(gs.spriteParts.forces[spr.num].y).toBe(-2.5 * JETSPEED)
    expect(spr.jetsCount).toBe(9)
  })

  it('jets exhausted: no upward force, count stays 0', () => {
    const spr = spawnAt(gs)
    spr.onGround = false
    spr.jetsCount = 0
    spr.control.jetpack = true

    tick(gs, spr)
    expect(gs.spriteParts.forces[spr.num].y).toBe(0)
    expect(spr.jetsCount).toBe(0)
  })

  it('backflip: jetpack while sidejumping against facing direction → RollBack (Control.pas:313-322)', () => {
    const spr = spawnAt(gs)
    spr.legsApplyAnimation(gs.anims.jumpSide, 1)
    spr.direction = -1
    spr.control.right = true
    spr.control.jetpack = true

    controlSprite(gs, spr)
    expect(spr.legsAnimation.id).toBe(gs.anims.rollBack.id)
    expect(spr.bodyAnimation.id).toBe(gs.anims.rollBack.id)
  })
})

describe('controlSprite — crouch / prone / roll (Control.pas:825-918, 1591-1914)', () => {
  let gs: GameState
  beforeEach(() => {
    gs = setupTestGame()
  })

  it('down on ground: legs Crouch, position POS_CROUCH', () => {
    const spr = spawnAt(gs)
    spr.control.down = true
    tick(gs, spr)
    expect(spr.legsAnimation.id).toBe(gs.anims.crouch.id)
    expect(spr.position).toBe(POS_CROUCH)
  })

  it('down+right from standing: CrouchRun with CROUCHRUNSPEED force', () => {
    const spr = spawnAt(gs)
    spr.control.down = true
    spr.control.right = true
    tick(gs, spr)
    expect(spr.legsAnimation.id).toBe(gs.anims.crouchRun.id)
    expect(gs.spriteParts.forces[spr.num].x).toBe(CROUCHRUNSPEED)
    expect(spr.position).toBe(POS_CROUCH)
  })

  it('down+right while running: converts to Roll with 2*CROUCHRUNSPEED force', () => {
    const spr = spawnAt(gs)
    spr.control.right = true
    tick(gs, spr) // legs → Run
    expect(spr.legsAnimation.id).toBe(gs.anims.run.id)

    spr.control.down = true
    gs.spriteParts.forces[spr.num] = vector2(0, 0)
    controlSprite(gs, spr)
    expect(spr.legsAnimation.id).toBe(gs.anims.roll.id)
    expect(spr.bodyAnimation.id).toBe(gs.anims.roll.id)
    expect(gs.spriteParts.forces[spr.num].x).toBe(2 * CROUCHRUNSPEED)
  })

  it('prone key: legs+body Prone, position POS_PRONE, key consumed, oldDirection saved', () => {
    const spr = spawnAt(gs)
    spr.control.prone = true
    tick(gs, spr)
    expect(spr.legsAnimation.id).toBe(gs.anims.prone.id)
    expect(spr.bodyAnimation.id).toBe(gs.anims.prone.id)
    expect(spr.position).toBe(POS_PRONE)
    expect(spr.control.prone).toBe(false)
    expect(spr.oldDirection).toBe(spr.direction)
  })

  it('prone key again when lying (frame > 23): GetUp from frame 9', () => {
    const spr = spawnAt(gs)
    spr.control.prone = true
    tick(gs, spr) // 엎드림
    spr.legsAnimation.currFrame = 25 // 엎드리기 애니메이션 완료 근처로 점프

    spr.control.prone = true
    controlSprite(gs, spr)
    expect(spr.legsAnimation.id).toBe(gs.anims.getUp.id)
    expect(spr.legsAnimation.currFrame).toBe(9)
    expect(spr.control.prone).toBe(false)
  })

  it('prone move: left/right while lying applies PRONESPEED-family force and ProneMove anim', () => {
    const spr = spawnAt(gs)
    spr.control.prone = true
    tick(gs, spr)
    spr.legsAnimation.currFrame = 26 // Prone 유지 프레임

    spr.control.right = true
    gs.spriteParts.forces[spr.num] = vector2(0, 0)
    controlSprite(gs, spr)
    expect(spr.legsAnimation.id).toBe(gs.anims.proneMove.id)
    expect(gs.spriteParts.forces[spr.num].x).toBeGreaterThan(0)
    expect(spr.position).toBe(POS_PRONE)
  })
})

describe('controlSprite — idle / no keys (Control.pas:1969-1983)', () => {
  let gs: GameState
  beforeEach(() => {
    gs = setupTestGame()
  })

  it('no keys on ground: returns to Stand, position POS_STAND', () => {
    const spr = spawnAt(gs)
    spr.control.right = true
    tick(gs, spr) // 달리기 시작
    spr.control.right = false
    tick(gs, spr)
    expect(spr.legsAnimation.id).toBe(gs.anims.stand.id)
    expect(spr.position).toBe(POS_STAND)
  })

  it('no keys in the air: legs Fall', () => {
    const spr = spawnAt(gs)
    spr.onGround = false
    tick(gs, spr)
    expect(spr.legsAnimation.id).toBe(gs.anims.fall.id)
  })
})

describe('controlSprite — key conflict resolution (Control.pas:61-66, 139-201)', () => {
  let gs: GameState
  beforeEach(() => {
    gs = setupTestGame()
  })

  it('areConflictingKeysPressed: true only when 2+ of nade/change/throw/reload held', () => {
    const spr = spawnAt(gs)
    expect(areConflictingKeysPressed(spr)).toBe(false)
    spr.control.reload = true
    expect(areConflictingKeysPressed(spr)).toBe(false)
    spr.control.throwNade = true
    expect(areConflictingKeysPressed(spr)).toBe(true)
  })

  it('nade+reload pressed together: reload deactivated first (least preference)', () => {
    const spr = spawnAt(gs)
    spr.control.throwNade = true
    spr.control.reload = true
    controlSprite(gs, spr)
    expect(spr.control.reload).toBe(false)
    expect(areConflictingKeysPressed(spr)).toBe(false)
  })

  it('left+right pressed while not jumping: newly pressed direction wins', () => {
    const spr = spawnAt(gs)
    spr.control.right = true
    tick(gs, spr) // wasRunningLeft=false 기록

    spr.control.left = true // 이제 양쪽 다 눌림 → 새 방향(왼쪽) 우선
    controlSprite(gs, spr)
    expect(spr.control.left).toBe(true)
    expect(spr.control.right).toBe(false)
  })

  it('left+right while jumping: keeps the old direction', () => {
    const spr = spawnAt(gs)
    spr.control.right = true
    spr.control.up = true
    tick(gs, spr) // wasJumping=true, wasRunningLeft=false 기록

    spr.control.left = true
    controlSprite(gs, spr)
    expect(spr.control.right).toBe(true)
    expect(spr.control.left).toBe(false)
  })
})

describe('controlSprite — misc invariants', () => {
  let gs: GameState
  beforeEach(() => {
    gs = setupTestGame()
  })

  it('dead meat: controls are freed every tick (Control.pas:299-300)', () => {
    const spr = spawnAt(gs)
    spr.deadMeat = true
    spr.control.right = true
    controlSprite(gs, spr)
    expect(spr.control.right).toBe(false)
    expect(gs.spriteParts.forces[spr.num].x).toBe(0)
  })

  it('mouse aim advances with sprite velocity (Control.pas:306-307)', () => {
    const spr = spawnAt(gs)
    spr.control.mouseAimX = 100
    spr.control.mouseAimY = 50
    gs.spriteParts.velocity[spr.num] = vector2(2, -3)
    controlSprite(gs, spr)
    expect(spr.control.mouseAimX).toBe(102)
    expect(spr.control.mouseAimY).toBe(47)
  })

  it('anti-speedhack: velocity divided when legs anim speed > 1 (Control.pas:1362-1388)', () => {
    const spr = spawnAt(gs)
    spr.control.right = true
    tick(gs, spr) // legs Run
    spr.legsAnimation.speed = 2
    gs.spriteParts.velocity[spr.num] = vector2(4, 0)
    controlSprite(gs, spr)
    expect(gs.spriteParts.velocity[spr.num].x).toBe(2)
  })

  it('checkSpriteLineOfSightVisibility: sees a nearby sprite it aims at', () => {
    const looker = spawnAt(gs)
    const target = spawnAt(gs)
    // 타깃을 바라보는 위치·조준으로 세팅
    const lp = gs.spriteParts.pos[looker.num]
    target.moveSkeleton(lp.x + 40, lp.y, true)
    looker.control.mouseAimX = Math.round(lp.x + 40)
    looker.control.mouseAimY = Math.round(lp.y)
    expect(checkSpriteLineOfSightVisibility(gs, looker, target)).toBe(true)
    // 반대편을 조준하면 시야각(180도) 밖
    looker.control.mouseAimX = Math.round(lp.x - 40)
    expect(checkSpriteLineOfSightVisibility(gs, looker, target)).toBe(false)
  })
})
