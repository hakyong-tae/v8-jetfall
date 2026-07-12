// 1:1 포팅: soldat-ref/soldat/shared/AI.pas (1099 lines)
// 봇 두뇌. AI.pas는 IFDEF가 전혀 없으므로 전체를 무조건 번역한다 (계획서 T11).
//
// AI는 사람이 채우는 것과 똑같은 필드(TControl 불리언 + MouseAim)를 sprite.control에 써넣고,
// 그 뒤 기존 controlSprite 상태기계가 실행된다. 원본은 ControlSprite(Control.pas) 안에서
// {$IFDEF SERVER} ControlBot(SpriteC) (Control.pas:295-297)로 호출한다 — 로컬 입력 해석
// 블록 직후, 공통 전처리(FreeControls/MouseAim 갱신) 직전. 이 포트도 그 자리에 배선한다.
//
// 브레인 상태는 TSprite.brain: TBotData (Sprites.pas:74-93), 웨이포인트 그래프는 gs.botPath
// (waypoints.ts). 네트 전송(ServerSendStringMessage 봇챗)은 M3 스텁 — gs.botsChat(기본 false)
// 게이트로 비활성. Trace 디버그 로그는 규약대로 생략.
//
// random()은 시드 없음(스펙 4.2: 분포만 일치). pascalRound = Round(banker's가 아닌 Pascal 반올림).

import { type GameState, isTeamGame } from './state'
import { type TSprite, MAX_SPRITES, MAX_THINGS, FRAGGRENADE_EXPLOSION_RADIUS } from './sprites'
import { pascalRound, random } from './pascal'
import { vector2, cloneVec2, vec2Scale, vec2Add } from './vector'
import { type TVector2 } from './vector'
import { distance, distanceVec2 } from './calc'
import { MAX_BULLETS } from './sprites'
import { TWaypointAction, MAX_WAYPOINTS } from './waypoints'
import {
  guns,
  MINIGUN,
  BARRETT,
  RUGER77,
  BOW,
  BOW2,
  NOWEAPON,
  KNIFE,
  CHAINSAW,
  LAW,
  COLT,
  CLUSTERGRENADE,
  BULLET_STYLE_FRAGNADE,
} from './weapons'
import {
  SECOND,
  BONUS_FLAMEGOD,
  BONUS_NONE,
  HURT_HEALTH,
  GAMESTYLE_CTF,
  GAMESTYLE_RAMBO,
  GAMESTYLE_INF,
  GAMESTYLE_HTF,
  TEAM_NONE,
  TEAM_ALPHA,
  TEAM_BRAVO,
  WAYPOINTSEEKRADIUS,
  WAYPOINTTIMEOUT,
  WAYPOINT_TIMEOUT,
  OBJECT_ALPHA_FLAG,
  OBJECT_BRAVO_FLAG,
  OBJECT_POINTMATCH_FLAG,
  OBJECT_RAMBO_BOW,
  OBJECT_MEDICAL_KIT,
  OBJECT_GRENADE_KIT,
  OBJECT_FLAMER_KIT,
  OBJECT_PREDATOR_KIT,
  OBJECT_VEST_KIT,
  OBJECT_BERSERK_KIT,
  OBJECT_COMBAT_KNIFE,
  OBJECT_USSOCOM,
} from './constants'

// AI.pas:17-27 거리 브래킷 상수
export const DIST_AWAY = 731
export const DIST_TOO_FAR = 730
export const DIST_VERY_FAR = 500
export const DIST_FAR = 350
export const DIST_ROCK_THROW = 180
export const DIST_CLOSE = 95
export const DIST_VERY_CLOSE = 55
export const DIST_TOO_CLOSE = 35

export const DIST_COLLIDE = 20
export const DIST_STOP_PRONE = 25

// AI.pas:41-69 CheckDistance — 한 축의 거리를 브래킷으로 분류
export function checkDistance(posA: number, posB: number): number {
  let result = DIST_AWAY

  const dist = Math.abs(posA - posB)

  if (dist <= DIST_TOO_CLOSE) result = DIST_TOO_CLOSE
  else if (dist <= DIST_VERY_CLOSE) result = DIST_VERY_CLOSE
  else if (dist <= DIST_CLOSE) result = DIST_CLOSE
  else if (dist <= DIST_ROCK_THROW) result = DIST_ROCK_THROW
  else if (dist <= DIST_FAR) result = DIST_FAR
  else if (dist <= DIST_VERY_FAR) result = DIST_VERY_FAR
  else if (dist <= DIST_TOO_FAR) result = DIST_TOO_FAR

  return result
}

// AI.pas:71-456 SimpleDecision — 타깃과의 거리 브래킷별 이동/사격/엎드림 + 조준 리드
export function simpleDecision(gs: GameState, snum: number): void {
  const s = gs.sprite[snum]
  const control = s.control
  const brain = s.brain

  const m: TVector2 = gs.spriteParts.pos[snum]
  // t는 아래에서 리드 계산으로 덮어써지므로 복사본으로 시작.
  let t: TVector2 = cloneVec2(gs.spriteParts.pos[brain.targetNum])

  if (!brain.goThing) {
    control.right = false
    control.left = false
    if (t.x > m.x) control.right = true
    if (t.x < m.x) control.left = true
  }

  // X - Distance
  const distToTargetX = checkDistance(m.x, t.x)

  if (distToTargetX === DIST_TOO_CLOSE) {
    if (!brain.goThing) {
      control.right = false
      control.left = false
      if (t.x < m.x) control.right = true
      if (t.x > m.x) control.left = true
    }
    control.fire = true
  } else if (distToTargetX === DIST_VERY_CLOSE) {
    if (!brain.goThing) {
      control.right = false
      control.left = false
    }
    control.fire = true

    // if reloading
    if (s.weapon.ammoCount === 0) {
      if (!brain.goThing) {
        control.right = false
        control.left = false
        if (t.x < m.x) control.right = true
        if (t.x > m.x) control.left = true
      }
      control.fire = false
    }
  } else if (distToTargetX === DIST_CLOSE) {
    if (!brain.goThing) {
      control.right = false
      control.left = false
    }
    control.down = true
    control.fire = true

    // if reloading
    if (s.weapon.ammoCount === 0) {
      if (!brain.goThing) {
        control.right = false
        control.left = false
        if (t.x < m.x) control.right = true
        if (t.x > m.x) control.left = true
      }
      control.down = false
      control.fire = false
    }
  } else if (distToTargetX === DIST_ROCK_THROW) {
    control.down = true
    control.fire = true

    // if reloading
    if (s.weapon.ammoCount === 0) {
      if (!brain.goThing) {
        control.right = false
        control.left = false
        if (t.x < m.x) control.right = true
        if (t.x > m.x) control.left = true
      }
      control.down = false
      control.fire = false
    }
  } else if (distToTargetX === DIST_FAR) {
    control.fire = true

    if (brain.camper > 127) {
      if (!brain.goThing) {
        control.up = false
        control.down = true
      }
    }
  } else if (distToTargetX === DIST_VERY_FAR) {
    control.up = true
    if (random(2) === 0 || s.weapon.num === guns[MINIGUN].num) control.fire = true

    if (brain.camper > 0) {
      if (random(250) === 0) {
        if (s.bodyAnimation.id !== gs.anims.prone.id) control.prone = true
      }

      if (!brain.goThing) {
        control.right = false
        control.left = false
        control.up = false
        control.down = true
      }
    }
  } else if (distToTargetX === DIST_TOO_FAR) {
    if (random(4) === 0 || s.weapon.num === guns[MINIGUN].num) control.fire = true

    if (brain.camper > 0) {
      if (random(300) === 0) {
        if (s.bodyAnimation.id !== gs.anims.prone.id) control.prone = true
      }

      if (!brain.goThing) {
        control.right = false
        control.left = false
        control.up = false
        control.down = true
      }
    }
  }

  // move when other player camps
  if (!brain.goThing) {
    if (
      gs.sprite[brain.targetNum].brain.currentWaypoint > 0 &&
      gs.botPath.at(gs.sprite[brain.targetNum].brain.currentWaypoint).action !== TWaypointAction.None
    ) {
      control.right = false
      control.left = false
      if (t.x > m.x) control.right = true
      if (t.x < m.x) control.left = true
    }
  }

  // hide yourself behind collider
  if (gs.botsDifficulty < 101) {
    if (s.colliderDistance < 255) {
      control.down = true

      if (brain.camper > 0) {
        control.left = false
        control.right = false

        // shoot!
        if (random(4) === 0 || s.weapon.num === guns[MINIGUN].num) control.fire = true
      }

      if (s.bodyAnimation.id === gs.anims.handsUpAim.id) {
        if (s.bodyAnimation.currFrame !== 11) control.fire = false
      }
    }
  }

  // if target behind collider and bot doesn't escape
  if (gs.botsDifficulty < 201) {
    if (gs.sprite[brain.targetNum].colliderDistance < 255 && s.colliderDistance > 254) {
      if (brain.camper > 0) {
        if (t.x < m.x) control.right = true
        if (t.x > m.x) control.left = true
      }
    }
  }

  // go prone / Fists!
  if (
    (s.weapon.num === guns[NOWEAPON].num ||
      s.weapon.num === guns[KNIFE].num ||
      s.weapon.num === guns[CHAINSAW].num) &&
    ((gs.sprite[brain.targetNum].weapon.num !== guns[NOWEAPON].num &&
      gs.sprite[brain.targetNum].weapon.num !== guns[KNIFE].num &&
      gs.sprite[brain.targetNum].weapon.num !== guns[CHAINSAW].num) ||
      gs.spriteParts.pos[brain.targetNum].y > gs.spriteParts.pos[snum].y)
  ) {
    control.right = false
    control.left = false
    control.down = false
    control.fire = true
    if (t.x > m.x) control.right = true
    if (t.x < m.x) control.left = true
  }

  // Y - Distance
  const distToTargetY = checkDistance(m.y, t.y)

  if (!brain.goThing) {
    if (distToTargetY >= DIST_ROCK_THROW && m.y > t.y) control.jetpack = true
  }

  // Flame god see
  if (gs.sprite[brain.targetNum].bonusStyle === BONUS_FLAMEGOD) {
    control.right = false
    control.left = false
    if (t.x < m.x) control.right = true
    if (t.x > m.x) control.left = true
  }

  // Realistic Mode - Burst Fire
  if (gs.svRealisticmode) {
    if (s.weapon.num !== guns[MINIGUN].num) {
      if (s.burstCount > 3) {
        control.fire = false
        if (gs.mainTickCounter % SECOND === 0) s.burstCount = 0
      }
    }

    if (s.weapon.num === guns[MINIGUN].num) {
      if (s.burstCount > 30) {
        control.fire = false
        if (gs.mainTickCounter % SECOND === 0) s.burstCount = 0
      }
    }
  }

  if (s.stat > 0) {
    control.right = false
    control.left = false
    control.up = false
    control.down = false
    control.fire = true
  }

  // Grenade throw
  if (brain.grenadeFreq > -1) {
    let gr = brain.grenadeFreq
    if (s.weapon.ammoCount === 0 || s.weapon.fireIntervalCount > 125) gr = Math.trunc(gr / 2)
    if (
      brain.currentWaypoint > 0 &&
      gs.botPath.at(brain.currentWaypoint).action !== TWaypointAction.None
    )
      gr = Math.trunc(gr / 2)
    if (gs.botsDifficulty < 100) gr = Math.trunc(gr / 2)

    if (gs.botsDifficulty < 201) {
      if (
        random(gr) === 0 &&
        distToTargetX < DIST_FAR &&
        s.tertiaryWeapon.ammoCount > 0 &&
        ((distToTargetY < DIST_VERY_CLOSE && m.y > t.y) || m.y < t.y)
      )
        control.throwNade = true
    }
  }

  // Knife Throw
  if (
    s.ceaseFireCounter < 30 &&
    s.weapon.num === guns[KNIFE].num &&
    brain.favWeapon === guns[KNIFE].num
  ) {
    control.fire = false
    control.throwWeapon = true
  }

  // 조준 리드: t += Velocity[target] * 10
  const tv = vec2Scale(gs.spriteParts.velocity[brain.targetNum], 10)
  t = vec2Add(t, tv)

  control.mouseAimX = pascalRound(t.x)
  // weapon.speed=0 가드는 원본에 없으므로 넣지 않는다 (실제 봇은 target 교전 시 speed>0 무기 보유).
  if (distToTargetX < DIST_FAR)
    control.mouseAimY = pascalRound(
      t.y - (0.5 * distToTargetX) / s.weapon.speed - brain.accuracy + random(brain.accuracy),
    )
  else
    control.mouseAimY = pascalRound(
      t.y - (1.75 * distToTargetX) / s.weapon.speed - brain.accuracy + random(brain.accuracy),
    )

  if (s.stat > 0)
    control.mouseAimY = pascalRound(
      t.y - (0.5 * distToTargetX) / 30 - brain.accuracy + random(brain.accuracy),
    )

  // impossible
  if (gs.botsDifficulty < 60) {
    if (
      gs.sprite[brain.targetNum].weapon.num === guns[BARRETT].num ||
      gs.sprite[brain.targetNum].weapon.num === guns[RUGER77].num
    ) {
      const dist = pascalRound(Math.sqrt((m.x - t.x) ** 2 + (m.y - t.y) ** 2))
      control.mouseAimX = pascalRound(t.x)
      control.mouseAimY = pascalRound(t.y)

      const iterations = pascalRound((dist / gs.sprite[brain.targetNum].weapon.speed) * 1.0)
      for (let i = 1; i <= iterations; i++) {
        control.mouseAimX =
          control.mouseAimX + pascalRound(gs.spriteParts.velocity[brain.targetNum].x)
        control.mouseAimY =
          control.mouseAimY + pascalRound(gs.spriteParts.velocity[brain.targetNum].y)
      }

      if (s.weapon.fireIntervalCount < 3) {
        s.freeControls()
        control.fire = true
        control.down = true

        if (
          s.bodyAnimation.id !== gs.anims.stand.id &&
          s.bodyAnimation.id !== gs.anims.recoil.id &&
          s.bodyAnimation.id !== gs.anims.prone.id &&
          s.bodyAnimation.id !== gs.anims.shotgun.id &&
          s.bodyAnimation.id !== gs.anims.barret.id &&
          s.bodyAnimation.id !== gs.anims.smallRecoil.id &&
          s.bodyAnimation.id !== gs.anims.aimRecoil.id &&
          s.bodyAnimation.id !== gs.anims.handsUpRecoil.id &&
          s.bodyAnimation.id !== gs.anims.aim.id &&
          s.bodyAnimation.id !== gs.anims.handsUpAim.id
        )
          control.fire = false
      }
    }
  }

  if (gs.svRealisticmode) control.mouseAimY = control.mouseAimY - s.burstCount * 3
}

// AI.pas:458-516 GoToThing — 씽(깃발/키트/활)을 향해 이동
export function goToThing(gs: GameState, snum: number, tnum: number): void {
  const s = gs.sprite[snum]
  const control = s.control
  const thing = gs.thing[tnum]

  const m: TVector2 = gs.spriteParts.pos[snum]
  let t: TVector2 = cloneVec2(thing.skeleton.pos[2])

  if (thing.skeleton.pos[2].x > thing.skeleton.pos[1].x && m.x < thing.skeleton.pos[2].x)
    t = cloneVec2(thing.skeleton.pos[2])
  if (thing.skeleton.pos[2].x > thing.skeleton.pos[1].x && m.x > thing.skeleton.pos[1].x)
    t = cloneVec2(thing.skeleton.pos[1])
  if (thing.skeleton.pos[2].x < thing.skeleton.pos[1].x && m.x < thing.skeleton.pos[1].x)
    t = cloneVec2(thing.skeleton.pos[1])
  if (thing.skeleton.pos[2].x < thing.skeleton.pos[1].x && m.x > thing.skeleton.pos[2].x)
    t = cloneVec2(thing.skeleton.pos[2])

  if (thing.holdingSprite > 0) t.y = t.y + 5

  if (t.x >= m.x) control.right = true
  if (t.x < m.x) control.left = true

  if (thing.holdingSprite > 0 && gs.teamFlag[s.player!.team] > TEAM_NONE) {
    if (
      s.player!.team === gs.sprite[thing.holdingSprite].player!.team &&
      !thing.inBase
    ) {
      // X - Distance
      const distToTargetX = checkDistance(m.x, t.x)

      if (distToTargetX === DIST_TOO_CLOSE || distToTargetX === DIST_VERY_CLOSE) {
        control.right = false
        control.left = false
        control.down = true
      }

      if (gs.sprite[thing.holdingSprite].control.jetpack) control.jetpack = true
      else control.jetpack = false
    }
  }

  // Y - Distance
  const distToTargetY = checkDistance(m.y, t.y)
  if (distToTargetY >= DIST_VERY_CLOSE && m.y > t.y) control.jetpack = true
}

// AI.pas:518-1097 ControlBot — 봇 두뇌 메인 루프. sprite.control을 채운다.
export function controlBot(gs: GameState, spriteC: TSprite): void {
  const brain = spriteC.brain

  if (spriteC.player!.controlMethod !== 2 /* BOT */ || spriteC.deadMeat || spriteC.dummy) return
  // (원본의 // if (MainTickCounter mod (SECOND * 2) = 0) then 주석 게이트는 실제로 비활성 — 매틱 실행)

  let b: TVector2 = vector2(0, 0)
  let lookPoint: TVector2 = vector2(0, 0)
  let startPoint: TVector2 = vector2(0, 0)
  let k: number
  let i: number
  let seeClosest: boolean
  let seeThing: boolean
  let runAway: boolean
  let d: number
  let d2: number
  let dt: number

  const tempb = spriteC.control.throwNade

  spriteC.freeControls()

  if (spriteC.bodyAnimation.id === gs.anims.throw.id) spriteC.control.throwNade = tempb
  else spriteC.control.throwNade = false

  lookPoint = vector2(spriteC.skeleton.pos[12].x, spriteC.skeleton.pos[12].y - 2)

  // >see?
  seeClosest = false
  d = 999999
  d2 = 0.0
  for (i = 1; i <= MAX_SPRITES; i++) {
    if (
      gs.sprite[i].active &&
      i !== spriteC.num &&
      gs.sprite[i].player!.name !== brain.friend &&
      (gs.sprite[i].alpha === 255 || gs.sprite[i].holdedThing > 0) &&
      gs.sprite[i].isNotSpectator()
    ) {
      if (
        !gs.sprite[i].deadMeat ||
        (gs.sprite[i].deadMeat && brain.deadKill === 1 && gs.sprite[i].deadTime < 180)
      ) {
        startPoint = cloneVec2(gs.sprite[i].skeleton.pos[12])
        // check if ray startpoint is not in map
        if (gs.map.collisionTest(startPoint).hit) startPoint.y = startPoint.y + 6

        // 원본은 `if not RayCast(..., D2, 651)` 단일 호출로 hit과 out-param D2를 함께 얻는다.
        const rc = gs.map.rayCast(lookPoint, startPoint, 651)
        d2 = rc.distance
        if (!rc.hit) {
          if (gs.svGamemode === GAMESTYLE_RAMBO) {
            if (
              gs.sprite[i].weapon.num === guns[BOW].num ||
              gs.sprite[i].weapon.num === guns[BOW2].num
            ) {
              brain.targetNum = i
              seeClosest = true
              break
            }
          }

          if (d > d2) {
            brain.targetNum = i

            dt = d

            if (!gs.sprite[i].deadMeat) d = d2
            seeClosest = true

            // stop throwing grenades and weapons if it's dead
            if (gs.sprite[i].deadMeat) {
              spriteC.control.throwNade = false
              spriteC.control.throwWeapon = false
            }

            if (
              gs.svGamemode === GAMESTYLE_RAMBO &&
              spriteC.weapon.num !== guns[BOW].num &&
              spriteC.weapon.num !== guns[BOW2].num
            ) {
              seeClosest = false
              d = dt
            }
            if (isTeamGame(gs) && spriteC.isInSameTeam(gs.sprite[i])) {
              seeClosest = false
              // d := dt (원본 주석처리 — 보존)
            }
          }
        } // if see
      }
    }
  }
  // <see?

  if (brain.targetNum > 0) {
    if (
      gs.sprite[brain.targetNum].weapon.num === guns[BOW].num ||
      gs.sprite[brain.targetNum].weapon.num === guns[BOW2].num
    )
      brain.pissedOff = 0
  }

  if (brain.pissedOff === spriteC.num) brain.pissedOff = 0

  if (brain.pissedOff > 0) {
    if (
      isTeamGame(gs) &&
      !gs.svFriendlyfire &&
      gs.sprite[brain.pissedOff].isInSameTeam(spriteC)
    )
      brain.pissedOff = 0
  }

  if (brain.targetNum > 0) {
    if (
      isTeamGame(gs) &&
      gs.svFriendlyfire &&
      gs.sprite[brain.targetNum].isNotInSameTeam(spriteC)
    )
      brain.pissedOff = 0
  }

  if (brain.pissedOff > 0) {
    lookPoint = vector2(spriteC.skeleton.pos[12].x, spriteC.skeleton.pos[12].y - 2)
    startPoint = cloneVec2(gs.sprite[brain.pissedOff].skeleton.pos[12])
    if (!gs.map.rayCast(lookPoint, startPoint, 651).hit) {
      brain.targetNum = brain.pissedOff
      seeClosest = true
    } else brain.pissedOff = 0
  }

  // have flag and not hurt, runaway!!!
  runAway = false
  if (seeClosest) {
    if (spriteC.holdedThing > 0) {
      if (
        gs.thing[spriteC.holdedThing].style === OBJECT_ALPHA_FLAG ||
        gs.thing[spriteC.holdedThing].style === OBJECT_BRAVO_FLAG
      ) {
        if (gs.sprite[brain.targetNum].holdedThing === 0) {
          seeClosest = false
          runAway = true
        }
      }
    }
  }

  // GO WITH WAYPOINTS
  if (!seeClosest) {
    // it doesn't see any target
    if (!brain.goThing) {
      if (spriteC.stat === 0) {
        if (brain.currentWaypoint === 0) i = 350
        else i = WAYPOINTSEEKRADIUS // Radius of waypoint seeking

        k = gs.botPath.findClosest(
          gs.spriteParts.pos[spriteC.num].x,
          gs.spriteParts.pos[spriteC.num].y,
          i,
          brain.currentWaypoint,
        )

        brain.oldWaypoint = brain.currentWaypoint

        // FIXME set an initial waypoint (원본 주석 보존): 이전엔 OOB read였다.
        if (brain.nextWaypoint === 0) brain.nextWaypoint = 1
        brain.pathNum = gs.botPath.at(brain.nextWaypoint).pathNum

        // pathnum for CTF
        if (gs.svGamemode === GAMESTYLE_CTF) {
          brain.pathNum = spriteC.player!.team

          // i have the flag!
          if (spriteC.holdedThing > 0) {
            if (
              gs.thing[spriteC.holdedThing].style === OBJECT_ALPHA_FLAG ||
              gs.thing[spriteC.holdedThing].style === OBJECT_BRAVO_FLAG
            ) {
              if (spriteC.player!.team === TEAM_ALPHA) brain.pathNum = 2
              if (spriteC.player!.team === TEAM_BRAVO) brain.pathNum = 1
            }
          }
        }

        // pathnum for HTF
        if (gs.svGamemode === GAMESTYLE_HTF) {
          brain.pathNum = spriteC.player!.team

          if (spriteC.holdedThing > 0) {
            if (gs.thing[spriteC.holdedThing].style === OBJECT_POINTMATCH_FLAG) {
              if (spriteC.player!.team === TEAM_ALPHA) brain.pathNum = 2
              if (spriteC.player!.team === TEAM_BRAVO) brain.pathNum = 1
            }
          }
        }

        // pathnum for Infiltration
        if (gs.svGamemode === GAMESTYLE_INF) {
          if (spriteC.player!.team === TEAM_ALPHA) brain.pathNum = 1
          if (spriteC.player!.team === TEAM_BRAVO) brain.pathNum = 2

          if (!gs.thing[gs.teamFlag[2]].inBase) {
            if (spriteC.player!.team === TEAM_BRAVO) brain.pathNum = 2
          }

          if (spriteC.holdedThing > 0) {
            if (
              gs.thing[spriteC.holdedThing].style === OBJECT_ALPHA_FLAG ||
              gs.thing[spriteC.holdedThing].style === OBJECT_BRAVO_FLAG
            ) {
              if (spriteC.player!.team === TEAM_ALPHA) brain.pathNum = 2
              if (spriteC.player!.team === TEAM_BRAVO) brain.pathNum = 1
            }
          }
        }

        if (brain.currentWaypoint === 0 || k > 0) {
          if (brain.pathNum === gs.botPath.at(k).pathNum || brain.currentWaypoint === 0) {
            brain.currentWaypoint = k
          }
        }

        if (brain.currentWaypoint > 0 && brain.currentWaypoint < MAX_WAYPOINTS) {
          if (brain.oldWaypoint !== brain.currentWaypoint) {
            k = random(gs.botPath.at(brain.currentWaypoint).connectionsNum) + 1
            if (
              k > 0 &&
              k < MAX_WAYPOINTS &&
              gs.botPath.at(brain.currentWaypoint).connections[k] > 0 &&
              gs.botPath.at(brain.currentWaypoint).connections[k] < MAX_WAYPOINTS
            ) {
              brain.nextWaypoint = gs.botPath.at(brain.currentWaypoint).connections[k]

              // face target
              spriteC.control.mouseAimX = pascalRound(gs.botPath.at(brain.nextWaypoint).x)
              spriteC.control.mouseAimY = pascalRound(gs.botPath.at(brain.nextWaypoint).y)
            }
          }

          // apply waypoint movements to sprite
          spriteC.control.left = gs.botPath.at(brain.nextWaypoint).left
          spriteC.control.right = gs.botPath.at(brain.nextWaypoint).right
          spriteC.control.up = gs.botPath.at(brain.nextWaypoint).up
          spriteC.control.down = gs.botPath.at(brain.nextWaypoint).down
          spriteC.control.jetpack = gs.botPath.at(brain.nextWaypoint).jetpack

          // Special waypoint
          if (
            (gs.svGamemode === GAMESTYLE_INF &&
              spriteC.player!.team === TEAM_BRAVO &&
              gs.thing[gs.teamFlag[2]].inBase &&
              spriteC.holdedThing === 0) ||
            (gs.svGamemode === GAMESTYLE_CTF && spriteC.holdedThing === 0) ||
            (gs.svGamemode !== GAMESTYLE_INF &&
              gs.svGamemode !== GAMESTYLE_CTF &&
              gs.svGamemode !== GAMESTYLE_HTF)
          ) {
            // not infiltration escape path
            const wpAction = gs.botPath.at(brain.currentWaypoint).action
            if (
              wpAction === TWaypointAction.StopAndCamp ||
              (wpAction === TWaypointAction.Wait1Second && brain.onePlaceCount < 60) ||
              (wpAction === TWaypointAction.Wait5Seconds && brain.onePlaceCount < 300) ||
              (wpAction === TWaypointAction.Wait10Seconds && brain.onePlaceCount < 600) ||
              (wpAction === TWaypointAction.Wait15Seconds && brain.onePlaceCount < 900) ||
              (wpAction === TWaypointAction.Wait20Seconds && brain.onePlaceCount < 1200)
            ) {
              spriteC.control.left = false
              spriteC.control.right = false
              spriteC.control.up = false
              spriteC.control.down = false
              spriteC.control.jetpack = false

              if (spriteC.stat === 0) {
                if (brain.camper > 0) {
                  if (brain.onePlaceCount > 180) spriteC.control.down = true
                }
              }
            }
          }

          // fire at guy that is shooting me while running away
          if (runAway) {
            if (brain.pissedOff > 0) {
              spriteC.control.mouseAimX = pascalRound(gs.spriteParts.pos[brain.pissedOff].x)
              spriteC.control.mouseAimY = pascalRound(
                gs.spriteParts.pos[brain.pissedOff].y -
                  (1.75 * 100) / spriteC.weapon.speed -
                  brain.accuracy +
                  random(brain.accuracy),
              )
              spriteC.control.fire = true
            }
          }

          if (brain.lastWaypoint === brain.currentWaypoint) brain.waypointTime++
          else brain.waypointTime = 0
          brain.lastWaypoint = brain.currentWaypoint

          // check if standing in place because stuck or sth
          if (brain.currentWaypoint > 0) {
            if (gs.botPath.at(brain.currentWaypoint).action === TWaypointAction.None) {
              if ((spriteC.control.left || spriteC.control.right) && !spriteC.control.down) {
                if (
                  distanceVec2(
                    gs.spriteParts.pos[spriteC.num],
                    gs.spriteParts.oldPos[spriteC.num],
                  ) < 3
                ) {
                  brain.onePlaceCount++
                } else brain.onePlaceCount = 0
              } else brain.onePlaceCount = 0
            } else brain.onePlaceCount++
          }

          if (gs.botPath.at(brain.currentWaypoint).action === TWaypointAction.None) {
            if (brain.onePlaceCount > 90) {
              if (spriteC.control.left && spriteC.control.right) spriteC.control.right = false
              spriteC.control.up = true
            }
          }

          // change weapon back
          if (gs.botsDifficulty < 201) {
            if (
              (spriteC.weapon.num === guns[COLT].num ||
                spriteC.weapon.num === guns[NOWEAPON].num ||
                spriteC.weapon.num === guns[KNIFE].num ||
                spriteC.weapon.num === guns[CHAINSAW].num ||
                spriteC.weapon.num === guns[LAW].num) &&
              spriteC.secondaryWeapon.num !== guns[NOWEAPON].num
            )
              spriteC.control.changeWeapon = true
          }

          // reload if low ammo
          if (gs.botsDifficulty < 201) {
            if (spriteC.weapon.ammoCount < 4 && spriteC.weapon.ammo > 3)
              spriteC.control.reload = true
          }

          // get up if prone
          if (random(150) === 0) {
            if (
              spriteC.bodyAnimation.id === gs.anims.prone.id ||
              spriteC.bodyAnimation.id === gs.anims.proneMove.id
            )
              spriteC.control.prone = true
          }
        } // SpriteC.CurrentWaypoint>0
      } // gothing
    }
  } else {
    if (
      brain.currentWaypoint !== 0 &&
      gs.botPath.at(brain.currentWaypoint).action === TWaypointAction.None
    )
      brain.currentWaypoint = 0

    simpleDecision(gs, spriteC.num)

    // Camp
    if (
      brain.currentWaypoint > 0 &&
      ((gs.svGamemode === GAMESTYLE_INF && spriteC.player!.team === TEAM_BRAVO) ||
        (gs.svGamemode === GAMESTYLE_CTF && spriteC.holdedThing === 0) ||
        (gs.svGamemode !== GAMESTYLE_INF && gs.svGamemode !== GAMESTYLE_CTF))
    ) {
      // not infiltration escape path
      if (gs.botPath.at(brain.currentWaypoint).action === TWaypointAction.StopAndCamp) {
        spriteC.control.left = false
        spriteC.control.right = false
        spriteC.control.up = false
        spriteC.control.down = false
        spriteC.control.jetpack = false
      }
    }

    if (gs.botsChat) {
      // 봇챗 ServerSendStringMessage — M3 NET 스텁. gs.botsChat=false 기본이라 비활성.
      // TODO(M3) NET: ServerSendStringMessage(ChatSeeEnemy / 'Die <name>!')
    }

    brain.waypointTime = 0
  }

  seeThing = false
  lookPoint = vector2(spriteC.skeleton.pos[12].x, spriteC.skeleton.pos[12].y - 4)
  // look for flag or bow
  for (i = 1; i <= MAX_THINGS; i++) {
    if (
      !seeThing &&
      gs.thing[i].active &&
      gs.thing[i].holdingSprite !== spriteC.num &&
      (gs.thing[i].style === OBJECT_ALPHA_FLAG ||
        gs.thing[i].style === OBJECT_BRAVO_FLAG ||
        gs.thing[i].style === OBJECT_POINTMATCH_FLAG ||
        gs.thing[i].style === OBJECT_RAMBO_BOW ||
        gs.thing[i].style === OBJECT_FLAMER_KIT ||
        gs.thing[i].style === OBJECT_PREDATOR_KIT ||
        gs.thing[i].style === OBJECT_VEST_KIT ||
        gs.thing[i].style === OBJECT_BERSERK_KIT ||
        gs.thing[i].style === OBJECT_COMBAT_KNIFE ||
        (gs.thing[i].style === OBJECT_MEDICAL_KIT && spriteC.health < gs.startHealth) ||
        (gs.thing[i].style === OBJECT_GRENADE_KIT &&
          spriteC.tertiaryWeapon.ammoCount < gs.svMaxgrenades &&
          (spriteC.tertiaryWeapon.num !== guns[CLUSTERGRENADE].num ||
            spriteC.tertiaryWeapon.ammoCount === 0)))
    ) {
      startPoint = vector2(gs.thing[i].skeleton.pos[2].x, gs.thing[i].skeleton.pos[2].y - 5)

      const rc = gs.map.rayCast(lookPoint, startPoint, 651)
      d2 = rc.distance
      if (!rc.hit) {
        if (d2 < DIST_FAR) {
          // i see the flag! or bow or sth
          seeThing = true

          // dont take it if is my flag in base
          if (
            (gs.svGamemode === GAMESTYLE_CTF || gs.svGamemode === GAMESTYLE_INF) &&
            gs.thing[i].style === spriteC.player!.team &&
            gs.thing[i].inBase
          ) {
            seeThing = false
            if (spriteC.holdedThing > 0 && i !== spriteC.holdedThing) {
              if (gs.thing[spriteC.holdedThing].holdingSprite === spriteC.num) seeThing = true
            }
          }
          // dont follow this flag if my flag is not inbase
          if (
            (gs.svGamemode === GAMESTYLE_CTF || gs.svGamemode === GAMESTYLE_INF) &&
            gs.thing[i].style !== spriteC.player!.team &&
            !gs.thing[gs.teamFlag[spriteC.player!.team]].inBase
          )
            seeThing = false
          // dont take it if is flag in base
          if (
            (gs.svGamemode === GAMESTYLE_CTF || gs.svGamemode === GAMESTYLE_INF) &&
            gs.thing[i].style !== spriteC.player!.team &&
            gs.thing[i].style < OBJECT_USSOCOM &&
            gs.thing[i].inBase &&
            d2 > DIST_CLOSE
          )
            seeThing = false
          // or better take it if hurt and medikit is close
          if (
            gs.thing[i].style === OBJECT_MEDICAL_KIT &&
            spriteC.health < HURT_HEALTH &&
            d2 < DIST_VERY_CLOSE
          )
            seeThing = true
          // dont take it when running away with flag
          if (
            (gs.thing[i].style === OBJECT_MEDICAL_KIT ||
              gs.thing[i].style === OBJECT_GRENADE_KIT ||
              gs.thing[i].style === OBJECT_FLAMER_KIT ||
              gs.thing[i].style === OBJECT_PREDATOR_KIT ||
              gs.thing[i].style === OBJECT_BERSERK_KIT) &&
            runAway
          )
            seeThing = false
          if (
            (gs.thing[i].style === OBJECT_FLAMER_KIT ||
              gs.thing[i].style === OBJECT_PREDATOR_KIT ||
              gs.thing[i].style === OBJECT_BERSERK_KIT) &&
            spriteC.bonusStyle > BONUS_NONE
          )
            seeThing = false
          if (gs.thing[i].style === OBJECT_COMBAT_KNIFE) seeThing = true

          // throw away weapon
          if (d2 < 30 && gs.thing[i].style === OBJECT_RAMBO_BOW) spriteC.control.throwWeapon = true

          if (seeThing) {
            if (gs.thing[i].holdingSprite === 0) gs.thing[i].interest--

            if (gs.thing[i].interest > 0) {
              // 봇챗 'Flag!' — M3 NET 스텁 (gs.botsChat 게이트).
              brain.goThing = true
              goToThing(gs, spriteC.num, i)
            } else brain.goThing = false

            // Pickup knife!
            if (
              gs.thing[i].style === OBJECT_COMBAT_KNIFE &&
              spriteC.weapon.num === guns[NOWEAPON].num &&
              brain.favWeapon === guns[KNIFE].num
            ) {
              spriteC.control.fire = false
              brain.targetNum = 0
              brain.goThing = true
              goToThing(gs, spriteC.num, i)
            }
          }
        }
      }
    }
  }
  // <see flag?

  if (!seeThing) brain.goThing = false

  // Runaway from grenade!
  if (gs.botsDifficulty < 201) {
    for (i = 1; i <= MAX_BULLETS; i++) {
      if (
        gs.bullet[i].active &&
        gs.bullet[i].style === BULLET_STYLE_FRAGNADE &&
        distance(
          gs.bulletParts.pos[i].x,
          gs.bulletParts.pos[i].y,
          gs.spriteParts.pos[spriteC.num].x,
          gs.spriteParts.pos[spriteC.num].y,
        ) <
          FRAGGRENADE_EXPLOSION_RADIUS * 1.4
      ) {
        if (gs.bulletParts.pos[i].x > gs.spriteParts.pos[spriteC.num].x) {
          spriteC.control.left = true
          spriteC.control.right = false
        } else {
          spriteC.control.right = true
          spriteC.control.left = false
        }
      }
    }
  }

  // release grenade
  if (spriteC.bodyAnimation.id === gs.anims.throw.id && spriteC.bodyAnimation.currFrame > 35)
    spriteC.control.throwNade = false

  brain.waypointTimeoutCounter--
  if (brain.waypointTimeoutCounter < 0) {
    brain.currentWaypoint = brain.oldWaypoint
    brain.waypointTimeoutCounter = WAYPOINTTIMEOUT
    spriteC.freeControls()
    spriteC.control.up = true
  }

  // waypoint is shit
  if (brain.waypointTime > WAYPOINT_TIMEOUT) {
    spriteC.freeControls()
    brain.currentWaypoint = 0
    brain.goThing = false
    brain.waypointTime = 0
  }

  // fall damage save
  d = gs.spriteParts.velocity[spriteC.num].y
  if (d > 3.35) brain.fallSave = 1
  if (d < 1.35) brain.fallSave = 0
  if (brain.fallSave > 0) spriteC.control.jetpack = true

  // Bot Chat (SortedPlayers ChatWinning) — M3 NET 스텁 (gs.botsChat 게이트).

  if (random(190) === 0) brain.pissedOff = 0

  if (spriteC.stat > 0) {
    brain.onePlaceCount++
    if (
      (brain.onePlaceCount > 120 && brain.onePlaceCount < 220) ||
      (brain.onePlaceCount > 350 && brain.onePlaceCount < 620) ||
      (brain.onePlaceCount > 700 && brain.onePlaceCount < 740) ||
      (brain.onePlaceCount > 900 && brain.onePlaceCount < 1100) ||
      (brain.onePlaceCount > 1300 && brain.onePlaceCount < 1500)
    ) {
      spriteC.control.fire = true
      if (random(2) === 0) spriteC.control.mouseAimY = spriteC.control.mouseAimY + random(4)
      else spriteC.control.mouseAimY = spriteC.control.mouseAimY - random(4)
    }

    if (brain.onePlaceCount > 1500) brain.onePlaceCount = 0
  }
}
