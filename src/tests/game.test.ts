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
import { updateFrame, updateFrameN, sortPlayers, changeMap, nextMap } from '../core/game'
import {
  TEAM_ALPHA,
  TEAM_BRAVO,
  DEFAULT_MAPCHANGE_TIME,
  GAMESTYLE_DEATHMATCH,
  GAMESTYLE_CTF,
  OBJECT_ALPHA_FLAG,
} from '../core/constants'

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

// Task 10 시나리오 — 틱 오더(ServerLoop.pas) + DM/CTF 승리 판정 + ChangeMap 라운드 리셋.
describe('updateFrame 틱 오더 + DM/CTF 룰 (ServerLoop.pas / Game.pas)', () => {
  let gs: GameState

  beforeEach(() => {
    seedRandom(20260712)
    gs = setupTestGame()
    gs.mapChangeCounter = -60
  })

  afterEach(() => {
    Math.random = realRandom
  })

  it('틱 오더: spriteEuler→spriteUpdate→bullet→bulletPartsEuler→spark→thing (ServerLoop 292-311 + 클라 76-82 스파크 삽입)', () => {
    const spr = spawn(gs)
    // 활성 슬롯 하나씩 켜서 각 단계가 발동하게 한다. update는 순서 기록용 스텁으로 교체
    // (실제 로직은 여기선 불필요 — 호출 순서만 검증).
    gs.bullet[1].active = true
    gs.spark[1].active = true
    gs.thing[1].active = true

    const order: string[] = []
    const rec = (label: string) => {
      if (!order.includes(label)) order.push(label)
    }

    const origEuler = gs.spriteParts.doEulerTimeStepFor.bind(gs.spriteParts)
    gs.spriteParts.doEulerTimeStepFor = (j: number) => {
      rec('spriteEuler')
      origEuler(j)
    }
    spr.update = () => rec('spriteUpdate')
    gs.bullet[1].update = () => rec('bullet')
    gs.bulletParts.doEulerTimeStep = () => rec('bulletPartsEuler')
    gs.spark[1].update = () => rec('spark')
    gs.thing[1].update = () => rec('thing')

    updateFrame(gs)

    expect(order).toEqual([
      'spriteEuler',
      'spriteUpdate',
      'bullet',
      'bulletPartsEuler',
      'spark',
      'thing',
    ])
    // ① OldSpritePos 시프트가 euler/update 앞에서 돌았는지: [0]이 스폰 위치를 담았다.
    expect(gs.oldSpritePos[spr.num][0].x).toBeCloseTo(gs.spriteParts.pos[spr.num].x)
  })

  it('DM 킬리밋: kills>=svKilllimit 이면 sortPlayers가 mapChangeCounter를 무장 (Game.pas:793-810)', () => {
    gs.svGamemode = GAMESTYLE_DEATHMATCH
    gs.mapChangeCounter = -60
    const spr = spawn(gs)
    spr.player!.kills = gs.svKilllimit // 10

    expect(gs.mapChangeCounter).toBe(-60)
    sortPlayers(gs)
    expect(gs.mapChangeCounter).toBe(DEFAULT_MAPCHANGE_TIME) // nextMap 무장 (320)
    expect(gs.timeLimitCounter).toBe(0)
  })

  it('DM 킬리밋 미달: kills<svKilllimit 이면 mapChangeCounter 그대로', () => {
    gs.svGamemode = GAMESTYLE_DEATHMATCH
    gs.mapChangeCounter = -60
    const spr = spawn(gs)
    spr.player!.kills = gs.svKilllimit - 1

    sortPlayers(gs)
    expect(gs.mapChangeCounter).toBe(-60)
  })

  it('CTF 팀 승리: teamScore>=svKilllimit 이면 mapChangeCounter 무장 (Game.pas:872-883)', () => {
    gs.svGamemode = GAMESTYLE_CTF // 팀전 → DM 킬리밋 분기 건너뜀
    gs.mapChangeCounter = -60
    gs.teamScore[1] = gs.svKilllimit

    sortPlayers(gs)
    expect(gs.mapChangeCounter).toBe(DEFAULT_MAPCHANGE_TIME)
  })

  it('sortPlayers 정렬: Flags>Kills>Deaths (Game.pas:813-847)', () => {
    // 킬리밋을 크게 올려 승리 판정이 개입하지 않게 한다.
    gs.svKilllimit = 999
    gs.svGamemode = GAMESTYLE_DEATHMATCH
    const a = spawn(gs)
    const b = spawn(gs)
    const c = spawn(gs)
    a.player!.kills = 5
    a.player!.flags = 0
    b.player!.kills = 2
    b.player!.flags = 3 // 캡이 최우선 → 1등
    c.player!.kills = 5
    c.player!.deaths = 1
    a.player!.deaths = 4 // 같은 kills면 deaths 적은 c가 위

    sortPlayers(gs)
    expect(gs.playersNum).toBe(3)
    expect(gs.sortedPlayers[1].playerNum).toBe(b.num) // flags 3
    expect(gs.sortedPlayers[2].playerNum).toBe(c.num) // kills 5, deaths 1
    expect(gs.sortedPlayers[3].playerNum).toBe(a.num) // kills 5, deaths 4
  })

  it('changeMap 라운드 리셋: kills/deaths/flags/teamScore 0, 탄/씽 소거, CTF 깃발 재스폰, 카운터 리셋 (Game.pas:512-745)', () => {
    gs.svGamemode = GAMESTYLE_CTF
    const alpha = spawn(gs, TEAM_ALPHA)
    const bravo = spawn(gs, TEAM_BRAVO)
    alpha.player!.kills = 7
    alpha.player!.deaths = 3
    alpha.player!.flags = 2
    gs.teamScore[1] = 5
    gs.teamScore[2] = 4
    gs.timeLimitCounter = 123

    // 활성 탄/씽 하나씩 — 소거되는지 확인
    gs.bullet[1].active = true
    gs.thing[5].active = true
    gs.thing[5].style = 99

    changeMap(gs)

    // 스탯 0
    expect(alpha.player!.kills).toBe(0)
    expect(alpha.player!.deaths).toBe(0)
    expect(alpha.player!.flags).toBe(0)
    expect(bravo.player!.kills).toBe(0)
    // 팀 점수 0
    expect(gs.teamScore[1]).toBe(0)
    expect(gs.teamScore[2]).toBe(0)
    // 탄 소거
    expect(gs.bullet[1].active).toBe(false)
    // CTF 깃발 재스폰 (ctf_Ash에 team 5/6 스폰 존재)
    expect(gs.teamFlag[1]).toBeGreaterThan(0)
    expect(gs.teamFlag[2]).toBeGreaterThan(0)
    expect(gs.thing[gs.teamFlag[1]].active).toBe(true)
    expect(gs.thing[gs.teamFlag[1]].style).toBe(OBJECT_ALPHA_FLAG)
    // 카운터 리셋
    expect(gs.mapChangeCounter).toBe(-60)
    expect(gs.timeLimitCounter).toBe(gs.svTimelimit)
  })

  it('nextMap 축약: timeLimitCounter=0, mapChangeCounter 무장 → 카운트다운이 changeMap 발동', () => {
    gs.svGamemode = GAMESTYLE_CTF
    spawn(gs, TEAM_ALPHA)
    nextMap(gs)
    expect(gs.mapChangeCounter).toBe(DEFAULT_MAPCHANGE_TIME)
    expect(gs.timeLimitCounter).toBe(0)

    // 카운트다운을 돌려 changeMap이 발동하면 mapChangeCounter가 -60으로 안정되고 timeLimitCounter가
    // svTimelimit으로 리셋된다 (리셋 후 몇 틱은 ⑪에서 다시 감소하므로 근사치로 확인).
    updateFrameN(gs, DEFAULT_MAPCHANGE_TIME + 2)
    expect(gs.mapChangeCounter).toBe(-60)
    expect(gs.timeLimitCounter).toBeGreaterThan(gs.svTimelimit - 5)
  })
})
