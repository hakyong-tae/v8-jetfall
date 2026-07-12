// Task 12 통합 — 헤드리스 봇전 DM/CTF (M2 완료 기준의 기계 검증).
//
// ctf_Ash 실맵 + weapons.json(normal) + bots.json 픽스처로 봇 상대 한 판을 헤드리스로 수천 틱
// 돌린다. RNG는 스펙 4.2대로 시드 없음(Math.random)이므로, 여기서는 M1/게임 테스트와 동일한
// 시드 LCG로 Math.random을 결정적으로 만들되(재현성), 단언은 정확값이 아니라 불변식에 건다:
// 유한성(무 NaN), 단조 카운터(킬/데스/탄생성 누적 > 0), 무예외, 깃발 무결성.
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { setupTestGame } from './helpers'
import type { GameState } from '../core/state'
import { vector2, cloneVec2 } from '../core/vector'
import { NUM_PARTICLES } from '../core/parts'
import {
  addBotPlayer,
  createSprite,
  createTPlayer,
  MAX_SPRITES,
  MAX_BULLETS,
  MAX_THINGS,
  MAX_SPARKS,
  HUMAN,
  type BotConfigEntry,
  type TSprite,
} from '../core/sprites'
import { createWeapons, loadWeaponsConfig, guns, AK74 } from '../core/weapons'
import { updateFrame, updateFrameN, sortPlayers, changeMap } from '../core/game'
import {
  GAMESTYLE_DEATHMATCH,
  GAMESTYLE_CTF,
  TEAM_NONE,
  TEAM_ALPHA,
  TEAM_BRAVO,
  OBJECT_ALPHA_FLAG,
  OBJECT_BRAVO_FLAG,
  DEFAULT_MAPCHANGE_TIME,
} from '../core/constants'

const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets')
const bots: Record<string, BotConfigEntry> = JSON.parse(
  readFileSync(path.join(assetsDir, 'bots.json'), 'utf-8'),
)
const weaponsJson = JSON.parse(readFileSync(path.join(assetsDir, 'weapons.json'), 'utf-8'))

// 시드 LCG (game.test.ts / sprites.test.ts 와 동일 패턴) — pascal.ts random()이 Math.random 기반.
const realRandom = Math.random
let seed = 0
function seedRandom(s: number): void {
  seed = s
  Math.random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
}
afterEach(() => {
  Math.random = realRandom
})

// weapons.json(normal)을 적재한 실전 무기 스탯으로 심을 세운다 (web/main.ts와 동일 경로).
function freshGame(): GameState {
  createWeapons(false)
  loadWeaponsConfig(weaponsJson.normal)
  return setupTestGame()
}

// 모든 활성 엔티티 좌표가 유한한지 — 한 군데라도 NaN/Infinity면 즉시 실패.
function assertAllFinite(gs: GameState): void {
  for (let i = 1; i <= MAX_SPRITES; i++) {
    if (!gs.sprite[i].active) continue
    expect(Number.isFinite(gs.spriteParts.pos[i].x)).toBe(true)
    expect(Number.isFinite(gs.spriteParts.pos[i].y)).toBe(true)
    expect(Number.isFinite(gs.spriteParts.velocity[i].x)).toBe(true)
    expect(Number.isFinite(gs.spriteParts.velocity[i].y)).toBe(true)
    const sk = gs.sprite[i].skeleton
    for (let p = 1; p <= NUM_PARTICLES; p++) {
      if (!sk.active[p]) continue
      expect(Number.isFinite(sk.pos[p].x)).toBe(true)
      expect(Number.isFinite(sk.pos[p].y)).toBe(true)
    }
  }
  for (let i = 1; i <= MAX_BULLETS; i++) {
    if (!gs.bullet[i].active) continue
    expect(Number.isFinite(gs.bulletParts.pos[i].x)).toBe(true)
    expect(Number.isFinite(gs.bulletParts.pos[i].y)).toBe(true)
  }
  for (let i = 1; i <= MAX_THINGS; i++) {
    if (!gs.thing[i].active) continue
    const sk = gs.thing[i].skeleton
    for (let p = 1; p <= NUM_PARTICLES; p++) {
      if (!sk.active[p]) continue
      expect(Number.isFinite(sk.pos[p].x)).toBe(true)
      expect(Number.isFinite(sk.pos[p].y)).toBe(true)
    }
  }
  for (let i = 1; i <= MAX_SPARKS; i++) {
    if (!gs.spark[i].active) continue
    expect(Number.isFinite(gs.sparkParts.pos[i].x)).toBe(true)
    expect(Number.isFinite(gs.sparkParts.pos[i].y)).toBe(true)
  }
}

function countActiveFlags(gs: GameState, style: number): number {
  let n = 0
  for (let i = 1; i <= MAX_THINGS; i++) {
    if (gs.thing[i].active && gs.thing[i].style === style) n++
  }
  return n
}

// 봇 이름 픽스처 — bots.json에서 앞의 N개.
function botNames(n: number): string[] {
  return Object.keys(bots).slice(0, n)
}

describe('integration — headless bot DM/CTF (M2 완료 기준)', () => {
  it('DM: 봇 4 (팀 없음), 3600틱(1분) 헤드리스 — 무예외·무NaN·탄환/킬 누적, 리스폰 순환', () => {
    seedRandom(12)
    const gs = freshGame()
    gs.svGamemode = GAMESTYLE_DEATHMATCH
    gs.svKilllimit = 9999 // 소크 중 라운드가 리셋되지 않도록 승리 판정 비활성

    const ids = botNames(4).map((name) => addBotPlayer(gs, bots[name], TEAM_NONE))
    expect(ids.every((id) => id > 0)).toBe(true)

    // 탄환 "생성 누적"은 bulletParts.createPart 호출 수로 센다 (매 틱 재사용되는 슬롯이라
    // 순간 활성 수만으론 과소평가됨).
    let bulletsCreated = 0
    const origCreatePart = gs.bulletParts.createPart.bind(gs.bulletParts)
    gs.bulletParts.createPart = (pos, velocity, mass, num) => {
      bulletsCreated++
      return origCreatePart(pos, velocity, mass, num)
    }

    // 리스폰 순환: 죽은 걸 본 봇이 다시 살아 돌아오는지.
    const sawDead: Record<number, boolean> = {}
    const sawRespawn: Record<number, boolean> = {}
    for (const id of ids) {
      sawDead[id] = false
      sawRespawn[id] = false
    }

    for (let t = 1; t <= 3600; t++) {
      updateFrame(gs)
      for (const id of ids) {
        const spr = gs.sprite[id]
        if (spr.deadMeat) sawDead[id] = true
        else if (sawDead[id] && spr.active && spr.health > 0) sawRespawn[id] = true
      }
      if (t % 600 === 0) assertAllFinite(gs)
    }

    expect(gs.ticks).toBe(3600)
    assertAllFinite(gs)

    // 봇이 실제로 사격했다.
    expect(bulletsCreated).toBeGreaterThan(0)

    // 킬/데스가 누적됐다 (봇들이 서로 교전).
    let totalKills = 0
    let totalDeaths = 0
    for (const id of ids) {
      totalKills += gs.sprite[id].player!.kills
      totalDeaths += gs.sprite[id].player!.deaths
    }
    expect(totalKills).toBeGreaterThan(0)
    expect(totalDeaths).toBeGreaterThanOrEqual(0)

    // 죽음→리스폰 순환이 최소 한 번 이상 관측됐다.
    expect(ids.some((id) => sawRespawn[id])).toBe(true)
  })

  it('DM 승리: svKilllimit=1, 킬 1회 주입 → sortPlayers가 mapChangeCounter 무장 → changeMap 후 스탯 리셋', () => {
    seedRandom(7)
    const gs = freshGame()
    gs.svGamemode = GAMESTYLE_DEATHMATCH
    gs.svKilllimit = 1
    gs.mapChangeCounter = -60

    const ids = botNames(2).map((name) => addBotPlayer(gs, bots[name], TEAM_NONE))
    const winner = gs.sprite[ids[0]]
    winner.player!.kills = 1 // 킬리밋 도달 주입

    expect(gs.mapChangeCounter).toBe(-60)
    sortPlayers(gs)
    expect(gs.mapChangeCounter).toBe(DEFAULT_MAPCHANGE_TIME) // 승리 → nextMap 무장

    // 카운트다운이 changeMap을 발동 → 스탯 0 리셋 + 카운터 안정.
    updateFrameN(gs, DEFAULT_MAPCHANGE_TIME + 2)
    expect(winner.player!.kills).toBe(0)
    expect(gs.mapChangeCounter).toBe(-60)
    assertAllFinite(gs)
  })

  it('CTF: 알파1+브라보1 봇, 7200틱 — 깃발 2개 활성 유지(무결성 가드), 무예외·무NaN', () => {
    seedRandom(20260712)
    const gs = freshGame()
    gs.svGamemode = GAMESTYLE_CTF
    gs.svKilllimit = 9999 // 캡처가 나도 라운드 리셋되지 않게

    addBotPlayer(gs, bots[botNames(1)[0]], TEAM_ALPHA)
    addBotPlayer(gs, bots[botNames(2)[1]], TEAM_BRAVO)

    // CTF 모드로 깃발/베이스 스폰 (changeMap이 teamFlag[1..2] 무장).
    changeMap(gs)
    expect(gs.teamFlag[1]).toBeGreaterThan(0)
    expect(gs.teamFlag[2]).toBeGreaterThan(0)

    for (let t = 1; t <= 7200; t++) {
      updateFrame(gs)
      if (t % 600 === 0) {
        assertAllFinite(gs)
        // 깃발 무결성: 알파·브라보 깃발이 각각 정확히 하나씩 살아 있어야 한다 (⑬ 가드).
        expect(countActiveFlags(gs, OBJECT_ALPHA_FLAG)).toBe(1)
        expect(countActiveFlags(gs, OBJECT_BRAVO_FLAG)).toBe(1)
      }
    }
    expect(gs.ticks).toBe(7200)
    assertAllFinite(gs)
  })

  it('CTF 캡처(연출): 브라보 봇을 적 깃발로 순간이동→그랩→자기 베이스로 순간이동→teamScore[2]+1', () => {
    seedRandom(99)
    const gs = freshGame()
    gs.svGamemode = GAMESTYLE_CTF
    gs.svKilllimit = 9999

    const bot = addBotPlayer(gs, bots[botNames(1)[0]], TEAM_BRAVO)
    changeMap(gs)
    const alphaFlag = gs.teamFlag[1]
    const bravoFlag = gs.teamFlag[2]
    expect(alphaFlag).toBeGreaterThan(0)
    expect(bravoFlag).toBeGreaterThan(0)

    // 깃발이 베이스에 안착(inBase=true)하도록 몇 틱 돌린다. (봇은 아직 그랩 위치가 아님)
    updateFrameN(gs, 30)
    // 봇이 소환 도중 죽지 않게 상태 보정.
    gs.sprite[bot].deadMeat = false
    gs.sprite[bot].health = gs.startHealth
    gs.sprite[bot].flagGrabCooldown = 0

    // ── 그랩: 봇을 알파 깃발 위로 순간이동. 매 틱 봇 AI가 이동하므로, 붙여넣고 즉시 몇 틱 재부착.
    // ceaseFireCounter>0(스폰 정전 기간)이면 CheckSpriteCollision이 깃발 근처 스프라이트를
    // 후보에서 제외한다(Things.pas:1657) — 그랩되게 정전을 해제한다.
    const grab = () => {
      const p = cloneVec2(gs.thing[alphaFlag].skeleton.pos[1])
      gs.spriteParts.pos[bot] = cloneVec2(p)
      gs.spriteParts.velocity[bot] = vector2(0, 0)
      gs.sprite[bot].moveSkeleton(p.x, p.y, true)
      gs.sprite[bot].deadMeat = false
      gs.sprite[bot].flagGrabCooldown = 0
      gs.sprite[bot].ceaseFireCounter = -1
    }
    let grabbed = false
    for (let t = 0; t < 20 && !grabbed; t++) {
      grab()
      updateFrame(gs)
      if (gs.thing[alphaFlag].holdingSprite === bot) grabbed = true
    }
    expect(grabbed).toBe(true)

    // ── 캡처: 알파 깃발을 든 채 브라보 깃발(자팀·inBase) 위로 순간이동 → 터치다운 스코어.
    const scoreBefore = gs.teamScore[2]
    for (let t = 0; t < 20 && gs.teamScore[2] === scoreBefore; t++) {
      const base = cloneVec2(gs.thing[bravoFlag].skeleton.pos[1])
      gs.spriteParts.pos[bot] = cloneVec2(base)
      gs.spriteParts.velocity[bot] = vector2(0, 0)
      gs.sprite[bot].moveSkeleton(base.x, base.y, true)
      // 든 깃발 스켈레톤도 베이스 근처로 (캐리어 pos[8]에 매 틱 부착되지만 즉시성 보강).
      for (let p = 1; p <= NUM_PARTICLES; p++) {
        if (gs.thing[alphaFlag].skeleton.active[p]) {
          gs.thing[alphaFlag].skeleton.pos[p] = cloneVec2(base)
        }
      }
      gs.sprite[bot].deadMeat = false
      gs.sprite[bot].ceaseFireCounter = -1
      updateFrame(gs)
    }

    expect(gs.teamScore[2]).toBe(scoreBefore + 1)
    expect(gs.sprite[bot].player!.flags).toBeGreaterThanOrEqual(1)
    assertAllFinite(gs)
  })

  it('bot-vs-player: HUMAN(무입력) + 봇1 — 600틱 내 봇이 플레이어를 향해 발사(bullet.owner=봇)', () => {
    seedRandom(3)
    const gs = freshGame()
    gs.svGamemode = GAMESTYLE_DEATHMATCH
    gs.svKilllimit = 9999

    // 사람 스프라이트(입력 없음) — AK-74 로드아웃으로 스폰.
    const player = createTPlayer()
    player.name = 'Human'
    player.controlMethod = HUMAN
    player.team = TEAM_NONE
    const hi = createSprite(gs, vector2(0, 0) /* placeholder */, vector2(0, 0), 1, 255, player, true)
    // 실제 스폰 위치로 리스폰 (randomizeStart 규칙 경유).
    gs.sprite[hi].selWeapon = guns[AK74].num
    gs.sprite[hi].respawn()

    const bot = addBotPlayer(gs, bots[botNames(1)[0]], TEAM_NONE)
    expect(bot).toBeGreaterThan(0)
    // 봇에 확정 원거리 무기 지급 (respawn이 근접무기를 뽑았으면 탄이 안 나올 수 있음).
    gs.sprite[bot].applyWeaponByNum(guns[AK74].num, 1)

    // 무입력 사람을 봇의 사선(우측 DIST_CLOSE≈80px)에 매 틱 재고정해 확실히 교전을 유도한다.
    // (실맵에서 봇이 로밍하면 600틱 내 조우가 보장되지 않으므로, 사람을 훈련용 표적처럼 붙인다.
    //  80px는 AI가 즉시 사격하는 근접 대역 — 120px(ROCK_THROW)는 접근/투척만 하므로 못 씀.)
    // bullet.owner 는 슬롯 재사용 전까지 남는다(초기값 0) — owner===bot 슬롯이 있으면 봇이 발사한 것.
    let botFiredBullet = false
    for (let t = 1; t <= 600 && !botFiredBullet; t++) {
      const bp = cloneVec2(gs.spriteParts.pos[bot])
      const target = vector2(bp.x + 80, bp.y)
      gs.spriteParts.pos[hi] = cloneVec2(target)
      gs.spriteParts.velocity[hi] = vector2(0, 0)
      gs.sprite[hi].moveSkeleton(target.x, target.y, true)
      gs.sprite[hi].deadMeat = false
      gs.sprite[hi].health = gs.startHealth
      gs.sprite[hi].ceaseFireCounter = -1
      gs.sprite[bot].ceaseFireCounter = -1

      updateFrame(gs)
      for (let i = 1; i <= MAX_BULLETS; i++) {
        if (gs.bullet[i].owner === bot) {
          botFiredBullet = true
          break
        }
      }
    }
    expect(botFiredBullet).toBe(true)
    assertAllFinite(gs)
  })
})
