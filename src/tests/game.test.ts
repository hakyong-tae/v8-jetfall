// Task 11 시나리오 테스트 — TSprite.update() (Sprites.pas:438-1422 이동부) + game.ts 60Hz 틱
// (ServerLoop.pas AppOnIdle/UpdateFrame 서버 순서).
//
// control.test.ts 와 달리 여기서는 물리 흉내를 내지 않는다 — updateFrame(gs)가 진짜 틱
// (OldSpritePos 시프트 → Euler 적분 → Sprite.Update)을 돌리고, 테스트는 행동 불변식만 본다.
// 수치 정밀 검증(원본 대조)은 T13.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestGame } from './helpers'
import type { GameState } from '../core/state'
import { vector2 } from '../core/vector'
import { pascalRound } from '../core/pascal'
import { createSprite, createTPlayer, TSprite, randomizeStart } from '../core/sprites'
import { updateFrame, updateFrameN } from '../core/game'
import { TEAM_ALPHA } from '../core/constants'

// 스폰 위치(randomizeStart)와 이동 로직의 Random() 호출을 결정적으로 만들기 위해 Math.random을
// 시드 LCG로 대체한다 (pascal.ts random()이 Math.random 기반).
const realRandom = Math.random
let seed = 0
function seedRandom(s: number): void {
  seed = s
  Math.random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
}

function spawn(gs: GameState, team = TEAM_ALPHA): TSprite {
  const player = createTPlayer()
  player.name = 'Test'
  player.team = team
  const r = randomizeStart(gs, team)
  const i = createSprite(gs, r.start, vector2(0, 0), 1, 255, player, true)
  const spr = gs.sprite[i]
  // M1 스텁 총 보정 (control.test.ts spawnAt과 동일한 이유): all-zero 총은 AmmoCount=0이라
  // Update의 리로드/잼 블록(Sprites.pas:900-1083)이 매 틱 발동해 ClipOut/Change 애니메이션에
  // 갇힌다. 실제 게임의 idle 총 상태(Weapons.pas:1324 기준)를 흉내.
  spr.weapon.ammo = 1
  spr.weapon.ammoCount = 1
  spr.weapon.reloadTime = 60
  spr.weapon.reloadTimeCount = 60
  spr.weapon.clipOutTime = 48
  spr.weapon.clipInTime = 12
  // CeaseFire 대기(스폰 후 DEFAULT_CEASEFIRE_TIME 틱) 생략 — 이동 테스트에 불필요
  spr.ceaseFireCounter = 0
  // 조준: 오른쪽 (direction = 1). controlSprite가 매 틱 mouseAim을 velocity만큼 끌고 가므로
  // (Control.pas:305-306) 초기값만 주면 이동을 따라온다.
  spr.control.mouseAimX = pascalRound(gs.spriteParts.pos[i].x + 100)
  spr.control.mouseAimY = pascalRound(gs.spriteParts.pos[i].y)
  return spr
}

function assertNoNaN(gs: GameState, spr: TSprite): void {
  const num = spr.num
  expect(Number.isFinite(gs.spriteParts.pos[num].x)).toBe(true)
  expect(Number.isFinite(gs.spriteParts.pos[num].y)).toBe(true)
  expect(Number.isFinite(gs.spriteParts.velocity[num].x)).toBe(true)
  expect(Number.isFinite(gs.spriteParts.velocity[num].y)).toBe(true)
  expect(Number.isFinite(gs.spriteParts.forces[num].x)).toBe(true)
  expect(Number.isFinite(gs.spriteParts.forces[num].y)).toBe(true)
  for (let i = 1; i <= 20; i++) {
    if (spr.skeleton.active[i]) {
      expect(Number.isFinite(spr.skeleton.pos[i].x)).toBe(true)
      expect(Number.isFinite(spr.skeleton.pos[i].y)).toBe(true)
    }
  }
}

describe('updateFrame — 60Hz tick (ServerLoop.pas) + TSprite.update (Sprites.pas:438-1422)', () => {
  let gs: GameState

  beforeEach(() => {
    seedRandom(20260712)
    gs = setupTestGame()
    // 게임 진행 상태: ChangeMap이 끝난 뒤 서버는 MapChangeCounter = -60 로 유지된다
    // (ServerLoop.pas:374 는 -60 미만으로 내려가지 않음). UpdateFrame의 스프라이트 블록은
    // MapChangeCounter < 0 일 때만 돈다.
    gs.mapChangeCounter = -60
  })

  afterEach(() => {
    Math.random = realRandom
  })

  it('counters: updateFrameN(n)이 ticks/mainTickCounter를 n 증가시킨다', () => {
    updateFrameN(gs, 37)
    expect(gs.ticks).toBe(37)
    expect(gs.mainTickCounter).toBe(37)
  })

  it('idle 120+ ticks: 스폰 후 지형 위에 onGround로 정착, y 안정화, NaN 없음', () => {
    const spr = spawn(gs)
    updateFrameN(gs, 120)
    const ySettled = gs.spriteParts.pos[spr.num].y
    updateFrameN(gs, 60)
    expect(spr.onGround).toBe(true)
    expect(spr.onGroundPermanent).toBe(true)
    // 정착 후 y는 더 이상 흐르지 않는다 (수직 낙하/침투 없음)
    expect(Math.abs(gs.spriteParts.pos[spr.num].y - ySettled)).toBeLessThan(1)
    assertNoNaN(gs, spr)
  })

  it('control.right 유지: x가 구간 내내 증가하고 legs가 run 계열 애니메이션', () => {
    // 기본 시드(20260712)의 알파 스폰은 오른쪽 ~25px에 벽이 있다(ctf_Ash 스폰별 지형 편차).
    // 달리기 검증에는 오른쪽이 트인 스폰이 나오는 시드를 쓴다 (사전 프로브: dx≈+251/120틱).
    seedRandom(42)
    const spr = spawn(gs)
    updateFrameN(gs, 120) // 정착
    const x0 = gs.spriteParts.pos[spr.num].x
    spr.control.right = true

    const samples: number[] = [x0]
    for (let t = 1; t <= 120; t++) {
      updateFrame(gs)
      if (t % 20 === 0) samples.push(gs.spriteParts.pos[spr.num].x)
    }
    for (let k = 1; k < samples.length; k++) {
      expect(samples[k]).toBeGreaterThan(samples[k - 1])
    }
    // 벽 없는 구간에서 실제 달리기 속도(~2px/틱)가 나와야 한다 — 미세 전진(슬라이딩)이면 실패
    expect(gs.spriteParts.pos[spr.num].x - x0).toBeGreaterThan(100)
    // 오른쪽을 보며(direction=1) 오른쪽으로 달리므로 Run (등지고 달리면 RunBack)
    expect([gs.anims.run.id, gs.anims.runBack.id]).toContain(spr.legsAnimation.id)
    assertNoNaN(gs, spr)
  })

  it('control.up 점프: 위로 떠올랐다가(중간에 onGround=false) 착지해 onGround=true', () => {
    const spr = spawn(gs)
    updateFrameN(gs, 120) // 정착
    const groundY = gs.spriteParts.pos[spr.num].y

    spr.control.up = true
    let minY = Infinity
    let sawAirborne = false
    for (let t = 0; t < 90; t++) {
      if (t === 20) spr.control.up = false
      updateFrame(gs)
      minY = Math.min(minY, gs.spriteParts.pos[spr.num].y)
      if (!spr.onGround) sawAirborne = true
    }
    expect(minY).toBeLessThan(groundY - 4) // y축은 아래가 + — 점프로 위(-)로 이동
    expect(sawAirborne).toBe(true)

    updateFrameN(gs, 120) // 낙하+착지
    expect(spr.onGround).toBe(true)
    assertNoNaN(gs, spr)
  })

  it('control.jetpack: 상승하며 jetsCount 감소, 소진되면 0에서 멈추고 낙하 시작', () => {
    const spr = spawn(gs)
    updateFrameN(gs, 120) // 정착
    const groundY = gs.spriteParts.pos[spr.num].y

    spr.jetsCount = 40 // 소진 테스트용 소량
    spr.control.jetpack = true

    updateFrameN(gs, 30)
    expect(spr.jetsCount).toBeLessThan(40)
    expect(gs.spriteParts.pos[spr.num].y).toBeLessThan(groundY - 5) // 상승

    // 소진까지 유지 — jetpack을 계속 누르는 동안은 회복도 없다 (Sprites.pas:1140)
    updateFrameN(gs, 60)
    expect(spr.jetsCount).toBe(0)
    const yAtExhaust = gs.spriteParts.pos[spr.num].y

    updateFrameN(gs, 45) // 추력 없음 → 낙하
    expect(spr.jetsCount).toBe(0)
    expect(gs.spriteParts.pos[spr.num].y).toBeGreaterThan(yAtExhaust)
    assertNoNaN(gs, spr)
  })

  it('jetsCount는 jetpack을 떼면 회복된다 (onGround 매 틱 / 공중 2틱마다)', () => {
    const spr = spawn(gs)
    updateFrameN(gs, 120)
    spr.jetsCount = 0
    updateFrameN(gs, 30)
    expect(spr.jetsCount).toBeGreaterThan(0)
    expect(spr.jetsCount).toBeLessThanOrEqual(gs.map.startJet)
  })

  it('600틱 소크: 10틱마다 랜덤 키 플립 — NaN 없음, 맵 밖으로 이탈하지 않음', () => {
    const spr = spawn(gs)
    const bystander = spawn(gs) // 다중 스프라이트 루프도 함께 돌린다 (idle)
    const bound = gs.map.sectorsNum * gs.map.sectorsDivision

    let flip = 987654321
    const nextBit = (): boolean => {
      flip = (flip * 1103515245 + 12345) % 2147483648
      return flip / 2147483648 < 0.35
    }

    for (let t = 0; t < 600; t++) {
      if (t % 10 === 0) {
        spr.control.left = nextBit()
        spr.control.right = nextBit()
        spr.control.up = nextBit()
        spr.control.down = nextBit()
        spr.control.jetpack = nextBit()
        spr.control.prone = nextBit()
        spr.control.fire = nextBit()
        spr.control.mouseAimX = pascalRound(
          gs.spriteParts.pos[spr.num].x + (nextBit() ? -200 : 200),
        )
        spr.control.mouseAimY = pascalRound(
          gs.spriteParts.pos[spr.num].y + (nextBit() ? -150 : 50),
        )
      }
      updateFrame(gs)
      assertNoNaN(gs, spr)
      assertNoNaN(gs, bystander)
      // CheckOutOfBounds 봉투: bound-50을 넘으면 리스폰되므로, 틱 사이 최대 이동량(MAX_VELOCITY)을
      // 감안해도 |pos| 는 bound 안쪽이어야 한다
      expect(Math.abs(gs.spriteParts.pos[spr.num].x)).toBeLessThanOrEqual(bound)
      expect(Math.abs(gs.spriteParts.pos[spr.num].y)).toBeLessThanOrEqual(bound)
    }
    expect(gs.ticks).toBe(600)
  })
})
