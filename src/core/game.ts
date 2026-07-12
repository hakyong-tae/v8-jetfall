// 1:1 포팅: soldat-ref/soldat/server/ServerLoop.pas (687 lines) — 60Hz 메인 틱.
// 이 포트는 권위 로컬 심 = SERVER 변형이므로 클라 UpdateFrame.pas가 아니라 ServerLoop.pas의
// 틱 순서를 채택한다.
//
// 구조 접기: 원본 AppOnIdle(23-268)은 Number27Timing으로 경과 시간에서 틱 수를 구해
// `for MainControl := 1 to (Ticktime - ticktimeLast)` 루프를 돌며 [카운터 증가 → UpdateFrame →
// 네트워크 송신] 을 수행한다. 이 포트는 호출자(웹 rAF 고정스텝 루프/테스트)가 60Hz로
// updateFrame(gs)을 직접 호출하므로, AppOnIdle의 틱당 전문(카운터 증가, ServerLoop.pas:41-49)을
// updateFrame 앞부분에 접어 넣었다. 네트워크 수신/송신·킥/밴·로비·데모 블록은 전부 미채택(주석).
//
// 클라 UpdateFrame.pas(client/UpdateFrame.pas)와의 순서 차이 (서버 채택 근거 기록):
//  * OldSpritePos 이력 시프트: 서버는 루프 선두에서 "산(alive) 스프라이트"에 대해 수행
//    (ServerLoop.pas:282-290), 클라는 TSprite.Update 내부 {$IFNDEF SERVER} Ping Impr 블록에서
//    수행 → 서버 방식 채택 (Update 쪽 클라 블록은 미채택, 죽은 스프라이트 분기는 공통이라 Update에 있음).
//  * Euler 적분 게이트: 서버는 무조건(스펙테이터만 제외), 클라는 ClientStopMovingCounter > 0
//    조건부 (UpdateFrame.pas:54-58).
//  * Sparks 루프(UpdateFrame.pas:76-82)는 클라 전용 — 서버 순서에 없다. 서버 순서는
//    bullets → BulletParts euler → things (→ bonuses).
//  * 카메라/커서/스크린샷/날씨 이펙트(클라 후반부) — 서버에 없음, 렌더 레이어(web/) 소관.
//  * TimeLeft 콘솔 출력 단위: 서버는 MINUTE/SECOND 상수, 클라는 3600/60 하드코딩 — 어차피
//    TODO(M2) (TimeLimitCounter/NextMap 미포팅).
import { MAX_SPRITES, MAX_BULLETS, MAX_THINGS, MAX_SPARKS, BOT } from './sprites'
import { type GameState, isTeamGame } from './state'
import { cloneVec2, vector2 } from './vector'
import { createThing, randomizeStart } from './things'
import { guns, NOWEAPON, PRIMARY_WEAPONS, SECONDARY_WEAPONS } from './weapons'
import { MAX_SPAWNPOINTS } from './polymap'
import {
  ILUMINATESPEED,
  MAX_OLDPOS,
  DEFAULT_MAPCHANGE_TIME,
  SECOND,
  BONUS_NONE,
  TEAM_ALPHA,
  TEAM_DELTA,
  GAMESTYLE_CTF,
  GAMESTYLE_INF,
  GAMESTYLE_POINTMATCH,
  GAMESTYLE_HTF,
  OBJECT_ALPHA_FLAG,
  OBJECT_BRAVO_FLAG,
  OBJECT_STATIONARY_GUN,
} from './constants'

// ServerLoop.pas:41-49(AppOnIdle 틱 전문) + 270-685(UpdateFrame) — 1틱 진행.
export function updateFrame(gs: GameState): void {
  // ── AppOnIdle 틱 전문 (ServerLoop.pas:41-49)
  gs.ticks = gs.ticks + 1

  gs.serverTickCounter++
  // Update main tick counter
  gs.mainTickCounter = gs.mainTickCounter + 1
  if (gs.mainTickCounter === 2147483640) gs.mainTickCounter = 0

  // TODO(M3): FloodNum/PingWarnings/FloodWarnings/KnifeWarnings 리셋, cvar 동기화, 네트워크
  //   스냅샷 송신, NoClientUpdateTime 증가/킥 (ServerLoop.pas:58-83, 94-264) — 전부 네트워크
  //   계열. NoClientUpdateTime은 GameState에 있으나 로컬 심에선 항상 0 유지.

  // ── UpdateFrame (ServerLoop.pas:270-685)
  // M := Default(TVector2) — 람보 활/깃발 스폰용 임시 벡터, TODO(M2) 블록에서만 사용

  if (gs.mapChangeCounter < 0) {
    // (282-290) 산 스프라이트의 OldSpritePos 이력 시프트 (Ping Impr — 죽은 스프라이트는
    // TSprite.Update의 dead 분기가 자체 수행)
    for (let j = 1; j <= MAX_SPRITES; j++) {
      if (gs.sprite[j].active && !gs.sprite[j].deadMeat) {
        if (gs.sprite[j].isNotSpectator()) {
          for (let i = MAX_OLDPOS; i >= 1; i--) {
            gs.oldSpritePos[j][i] = cloneVec2(gs.oldSpritePos[j][i - 1])
          }

          gs.oldSpritePos[j][0] = cloneVec2(gs.spriteParts.pos[j])
        }
      }
    }

    for (let j = 1; j <= MAX_SPRITES; j++) {
      if (gs.sprite[j].active) {
        if (gs.sprite[j].isNotSpectator()) {
          gs.spriteParts.doEulerTimeStepFor(j) // integrate sprite particles
        }
      }
    }

    for (let j = 1; j <= MAX_SPRITES; j++) {
      if (gs.sprite[j].active) {
        gs.sprite[j].update() // update sprite
      }
    }

    // ④ Bullets update (302-304)
    for (let j = 1; j <= MAX_BULLETS; j++) {
      if (gs.bullet[j].active) {
        gs.bullet[j].update()
        // 클라 UpdateFrame.pas:70-71 `if Bullet[j].PingAdd > 0 then Dec(..,4)` — 서버 순서엔
        // 없는 클라 전용 Ping 보정이라 미채택.
      }
    }

    // ⑤ BulletParts.DoEulerTimeStep (306)
    gs.bulletParts.doEulerTimeStep()

    // ⑥ Sparks update — 서버 UpdateFrame엔 없다(원본 Spark[]가 {$IFNDEF SERVER}). 규약 12에
    // 따라 core에 스파크를 채택했으므로, 클라 UpdateFrame.pas:76-82 위치(BulletParts euler 뒤 /
    // Things 앞)를 그대로 삽입한다. SparksCount는 매 프레임 0으로 리셋 후 활성 스파크마다 +1.
    gs.sparksCount = 0
    for (let j = 1; j <= MAX_SPARKS; j++) {
      if (gs.spark[j].active) {
        gs.spark[j].update(gs)
        gs.sparksCount++
      }
    }

    // ⑦ Things update (309-311)
    for (let j = 1; j <= MAX_THINGS; j++) {
      if (gs.thing[j].active) {
        gs.thing[j].update()
      }
    }

    // ⑧ Bonuses spawn (313-359) — sv_bonus_frequency 기본 0이라 사실상 비활성. 게이트 구조만
    // 남긴다.
    if (!gs.svSurvivalmode && !gs.svRealisticmode) {
      if (gs.svBonusFrequency > 0) {
        // TODO(M2후속): berserk/flamer/predator/vest/cluster 킷 확률 스폰 (SpawnThings 미포팅).
        //   BonusFreq 테이블(sv_bonus_frequency 1..5) + MainTickCounter mod 게이트 + Random 판정
        //   (ServerLoop.pas:314-359). CTF/INF/HTF는 CLUSTERBONUS_RANDOM * 0.75.
      }
    }
  }

  // bullet timer (363-370)
  if (gs.bulletTimeTimer > -1) gs.bulletTimeTimer--

  if (gs.bulletTimeTimer === 0) {
    // TODO(M2): ToggleBulletTime(False) — Game.pas 불릿타임 토글 미포팅
    gs.bulletTimeTimer = -1
  } else if (gs.bulletTimeTimer < 1) {
    // ⑨ MapChange counter update (374-377) — 카운트다운이 0 밑으로 떨어지면 ChangeMap 발동
    // (라운드/맵 리셋). NextMap이 mapChangeCounter를 MapChangeTime(=320)으로 무장하면 여기서
    // 매 틱 감소하다 -1에 닿는 순간 ChangeMap이 돈다. 평시엔 -60에서 안정(감소 안 함).
    if (gs.mapChangeCounter > -60 && gs.mapChangeCounter < 99999999) {
      gs.mapChangeCounter = gs.mapChangeCounter - 1
    }
    if (gs.mapChangeCounter < 0 && gs.mapChangeCounter > -59) {
      changeMap(gs)
    }

    // TODO(M3): 게임 스탯 저장(380-393), 안티 매스플래그(396-423), sv_healthcooldown
    //   HasPack 리셋(425-429), 안티 채팅플러드(431-441), 방화벽 IP(443-456), 로비(458-462),
    //   밴 타이머(464-470), PlayTime 집계(472-475), 빈 서버 맵체인지(478-481) — 서버 관리 계열

    gs.sinusCounter = gs.sinusCounter + ILUMINATESPEED

    // Wave respawn count (487-489)
    gs.waveRespawnCounter = gs.waveRespawnCounter - 1
    if (gs.waveRespawnCounter < 1) gs.waveRespawnCounter = gs.waveRespawnTime

    // TODO(M3): VoteCooldown 감소 (491-493)

    // ⑪ Time Limit decrease (496-501) — 시간 제한이 1에 닿으면 NextMap(같은 맵 재시작으로 축약).
    if (gs.mapChangeCounter < 99999999) {
      if (gs.timeLimitCounter > 0) gs.timeLimitCounter = gs.timeLimitCounter - 1
    }
    if (gs.timeLimitCounter === 1) nextMap(gs)
    // TimeLeftMin/Sec 콘솔 출력(503-518)은 web/HUD 소관 — 생략.

    // TODO(M3): TimerVote / MainConsole 스크롤 (523-531)
    // TODO(M2후속): if not sv_advancemode then WeaponSel 전부 1 리셋 (533-536) — advancemode 기본
    //   off라 정상 상태는 이미 전부 1 (state.ts weaponSel 초기값 주석).
  } // bullettime off

  // ⑫ INF 블루팀 틱 점수(542-555)·HTF 틱 점수(558-583) — TODO(M2후속). SortPlayers는 이제
  //   배선됐지만, PlayersTeamNum 게이트와 HoldedThing/HTFTime 상태 상당수가 아직 미포팅이라
  //   전체 스코어링은 후속으로 미룬다.
  // TODO(M2후속): 람보 활 재스폰 (586-609) — RAMBO 모드 전용, BOW Gun 의존.

  // ⑬ 중복 깃발 정리 + 깃발 재생성 (612-678). 매 2초, 깃발이 2개 이상이면 하나 파괴,
  //   0개면 재스폰. teamFlag 무결성 가드.
  if (gs.svGamemode === GAMESTYLE_CTF || gs.svGamemode === GAMESTYLE_INF) {
    if (gs.mainTickCounter % (SECOND * 2) === 0) {
      // 알파(빨강) 깃발
      let count = 0
      for (let j = 1; j <= MAX_THINGS; j++) {
        if (gs.thing[j].active && gs.thing[j].style === OBJECT_ALPHA_FLAG) count++
      }
      if (count > 1) {
        for (let j = MAX_THINGS; j >= 1; j--) {
          if (gs.thing[j].active && gs.thing[j].style === OBJECT_ALPHA_FLAG) {
            gs.thing[j].kill()
            break
          }
        }
      }
      if (count === 0) {
        const rs = randomizeStart(gs, 5)
        if (rs.result) gs.teamFlag[1] = createThing(gs, rs.start, 255, OBJECT_ALPHA_FLAG, 255)
      }

      // 브라보(파랑) 깃발
      count = 0
      for (let j = 1; j <= MAX_THINGS; j++) {
        if (gs.thing[j].active && gs.thing[j].style === OBJECT_BRAVO_FLAG) count++
      }
      if (count > 1) {
        for (let j = MAX_THINGS; j >= 1; j--) {
          if (gs.thing[j].active && gs.thing[j].style === OBJECT_BRAVO_FLAG) {
            gs.thing[j].kill()
            break
          }
        }
      }
      if (count === 0) {
        const rs = randomizeStart(gs, 6)
        if (rs.result) gs.teamFlag[2] = createThing(gs, rs.start, 255, OBJECT_BRAVO_FLAG, 255)
      }
    }
  }

  // POINTMATCH/HTF 노란 깃발 무결성 가드(656-678) — 해당 모드 미주력이라 TODO(M2후속) 스텁.

  // TODO(M3): 데모 자동 녹화 (680-684)

  // 클라 UpdateFrame.pas:202-203 — bink 누적치 감쇠. 원본 서버 순서엔 없는 클라 전용 틱이지만,
  // Fire(T7)가 채택한 hitSprayCounter(state.ts 필드 주석 참조)의 유일한 감쇠 경로라 함께 채택
  // (없으면 bink가 무한 누적되어 발사 부정확도가 MAX_INACCURACY에 고정된다).
  if (gs.hitSprayCounter > 0) gs.hitSprayCounter--
}

// 테스트/시뮬 편의: n틱 진행.
export function updateFrameN(gs: GameState, n: number): void {
  for (let i = 0; i < n; i++) {
    updateFrame(gs)
  }
}

// Server.pas:1283 NextMap — 원본은 MapsList/MapIndex를 돌려 다음 맵을 PrepareMapChange한다.
// 이 포트는 맵 로테이션을 M4로 미루므로 "같은 맵 재시작"으로 축약한다: PrepareMapChange의
// 핵심(TimeLimitCounter=0으로 시간제한이 맵을 먼저 바꾸지 않게 하고, MapChangeCounter를
// MapChangeTime으로 무장 → updateFrame의 카운트다운이 ChangeMap을 발동)만 수행한다.
// MapChangeTime은 Game.pas:77 `MapChangeTime: Integer = DEFAULT_MAPCHANGE_TIME`(가변 전역이지만
// 실질 상수 320)이라 상수를 직접 쓴다.
export function nextMap(gs: GameState): void {
  gs.timeLimitCounter = 0
  gs.mapChangeCounter = DEFAULT_MAPCHANGE_TIME
  // TODO(M3) NET: ServerMapChange(ALL_PLAYERS)
  // TODO(M4): 실제 맵 로테이션 (MapsList/MapIndex/PrepareMapChange의 GetMapInfo·LoadMap).
}

// Game.pas:747-910 SortPlayers — 프래그/캡 정렬(표시 순서) + 킬리밋 승리 판정. 이 포트는
// 서버-권위이므로 {$IFDEF SERVER} 분기를 채택하되, 원본 NextMap 대신 축약된 nextMap(gs)로
// mapChangeCounter를 무장한다(라운드 종료 → 같은 맵 재시작). 클라 전용 카메라 추적·
// SortedTeamScore(색) 블록은 생략.
export function sortPlayers(gs: GameState): void {
  gs.playersNum = 0
  gs.botsNum = 0
  gs.spectatorsNum = 0
  for (let i = 1; i <= 4; i++) gs.playersTeamNum[i] = 0

  for (let i = 1; i <= MAX_SPRITES; i++) {
    gs.sortedPlayers[i].kills = 0
    gs.sortedPlayers[i].deaths = 0
    gs.sortedPlayers[i].flags = 0
    gs.sortedPlayers[i].playerNum = 0
  }

  for (let i = 1; i <= MAX_SPRITES; i++) {
    if (gs.sprite[i].active && !gs.sprite[i].player!.demoPlayer) {
      gs.playersNum++
      if (gs.sprite[i].player!.controlMethod === BOT) gs.botsNum++

      if (gs.sprite[i].isSpectator()) gs.spectatorsNum++

      if (gs.sprite[i].isNotSolo() && gs.sprite[i].isNotSpectator()) {
        gs.playersTeamNum[gs.sprite[i].player!.team]++
      }

      if (gs.sprite[i].isNotSpectator()) {
        gs.sortedPlayers[gs.playersNum].kills = gs.sprite[i].player!.kills
        gs.sortedPlayers[gs.playersNum].deaths = gs.sprite[i].player!.deaths
        gs.sortedPlayers[gs.playersNum].flags = gs.sprite[i].player!.flags
        gs.sortedPlayers[gs.playersNum].playerNum = i
      } else {
        gs.sortedPlayers[gs.playersNum].kills = 0
        gs.sortedPlayers[gs.playersNum].deaths = Number.MAX_SAFE_INTEGER // High(Integer)
        gs.sortedPlayers[gs.playersNum].flags = 0
        gs.sortedPlayers[gs.playersNum].playerNum = i
      }

      // Kill Limit (DM류 — 팀전 아님) — 원본 {$IFDEF SERVER} NextMap → 축약 nextMap.
      if (gs.mapChangeCounter < 1) {
        if (!isTeamGame(gs)) {
          if (gs.sprite[i].player!.kills >= gs.svKilllimit) {
            nextMap(gs)
          }
        }
      }
    }
  }

  // caps(Flags) 우선 정렬 (813-821)
  if (gs.playersNum > 0) {
    for (let i = 1; i <= gs.playersNum; i++) {
      for (let j = i + 1; j <= gs.playersNum; j++) {
        if (gs.sortedPlayers[j].flags > gs.sortedPlayers[i].flags) {
          const temp = gs.sortedPlayers[i]
          gs.sortedPlayers[i] = gs.sortedPlayers[j]
          gs.sortedPlayers[j] = temp
        }
      }
    }
  }

  // Kills 정렬 (824-834)
  if (gs.playersNum > 0) {
    for (let i = 1; i <= gs.playersNum; i++) {
      for (let j = i + 1; j <= gs.playersNum; j++) {
        if (gs.sortedPlayers[j].flags === gs.sortedPlayers[i].flags) {
          if (gs.sortedPlayers[j].kills > gs.sortedPlayers[i].kills) {
            const temp = gs.sortedPlayers[i]
            gs.sortedPlayers[i] = gs.sortedPlayers[j]
            gs.sortedPlayers[j] = temp
          }
        }
      }
    }
  }

  // Deaths 정렬 (837-847)
  if (gs.playersNum > 0) {
    for (let i = 1; i <= gs.playersNum; i++) {
      for (let j = i + 1; j <= gs.playersNum; j++) {
        if (gs.sortedPlayers[j].flags === gs.sortedPlayers[i].flags) {
          if (gs.sortedPlayers[j].kills === gs.sortedPlayers[i].kills) {
            if (gs.sortedPlayers[j].deaths < gs.sortedPlayers[i].deaths) {
              const temp = gs.sortedPlayers[i]
              gs.sortedPlayers[i] = gs.sortedPlayers[j]
              gs.sortedPlayers[j] = temp
            }
          }
        }
      }
    }
  }

  // {$IFNDEF SERVER} SortedTeamScore(스코어보드 색 정렬) — 클라 전용, 생략.

  // {$IFDEF SERVER} Team - Kill Limit (872-883) — 팀 점수가 킬리밋 도달 시 라운드 종료.
  if (gs.mapChangeCounter < 1) {
    for (let i = 1; i <= 4; i++) {
      if (gs.teamScore[i] >= gs.svKilllimit) {
        nextMap(gs)
        break
      }
    }
  }
  // TODO(M2후속): UpdateWaveRespawnTime (ServerHelper.pas:236-241, 인원수 비례) — WaveRespawnTime
  //   계산 미포팅 (state.ts 필드 주석).

  // {$IFDEF SERVER} TeamAliveNum 집계 (895-909). INF 틱 스코어(sprites.ts) 등이 읽는다.
  for (let i = 1; i <= 4; i++) gs.teamAliveNum[i] = 0
  for (let i = 1; i <= MAX_SPRITES; i++) {
    if (gs.sprite[i].active) {
      const team = gs.sprite[i].player!.team
      if (team >= TEAM_ALPHA && team <= TEAM_DELTA) gs.teamAliveNum[team]++
    }
  }
}

// Game.pas:512-745 ChangeMap — 라운드/맵 리셋. 이 포트는 맵 로테이션(LoadMap/웨이포인트 로드/
// 데모/스냅샷/클라 카메라·메뉴)을 미채택하고, 순수 리셋 부분만 수행한다(= "같은 맵 재시작").
export function changeMap(gs: GameState): void {
  // {$IFDEF SERVER} LoadMapsList/BotPath 초기화/Map.LoadMap — 맵 로테이션(M4), 미채택.
  // {$IFNDEF SERVER} MapChanged/DemoRecorder/GetMapInfo/ExitToMenu — 클라 전용, 미채택.

  // 탄/씽/스파크 소거 (567-574). 스파크 소거는 원본 {$IFNDEF SERVER}이지만 규약 12(core에 스파크
  // 채택)에 따라 함께 채택 — 라운드 리셋 시 잔여 스파크를 남기지 않는다.
  for (let i = 1; i <= MAX_BULLETS; i++) gs.bullet[i].kill()
  for (let i = 1; i <= MAX_THINGS; i++) gs.thing[i].kill()
  for (let i = 1; i <= MAX_SPARKS; i++) gs.spark[i].kill(gs)

  // 스프라이트 리스폰 + 스탯 0 (583-600)
  for (let i = 1; i <= MAX_SPRITES; i++) {
    const spr = gs.sprite[i]
    if (spr.active && spr.isNotSpectator()) {
      // RandomizeStart(SpriteParts.Pos[i], Team) — Respawn 내부에서도 (서버) 재랜덤하지만
      // 원본이 둘 다 수행하므로 그대로 보존.
      gs.spriteParts.pos[i] = randomizeStart(gs, spr.player!.team).start
      spr.deadMeat = false
      spr.respawn()
      spr.player!.kills = 0
      spr.player!.deaths = 0
      spr.player!.flags = 0
      spr.bonusTime = 0
      spr.bonusStyle = BONUS_NONE
      // {$IFNDEF SERVER} SelWeapon := 0 — 클라 전용, 생략.
      spr.freeControls()
      spr.weapon = guns[NOWEAPON]

      const secWep = spr.player!.secWep + 1
      if (
        secWep >= 1 &&
        secWep <= SECONDARY_WEAPONS &&
        gs.weaponActive[PRIMARY_WEAPONS + secWep] === 1
      ) {
        spr.secondaryWeapon = guns[PRIMARY_WEAPONS + secWep]
      } else {
        spr.secondaryWeapon = guns[NOWEAPON]
      }

      spr.respawnCounter = 0
    }
  }

  // {$IFNDEF SERVER} WeaponSel 전부 1 리셋 — 클라 전용, 생략.

  // advance-mode WeaponSel 0 리셋 (619-633; SERVER 부분만). 기본 off라 정상 상태는 미실행.
  if (gs.svAdvancemode) {
    for (let j = 1; j <= MAX_SPRITES; j++) {
      for (let i = 1; i <= PRIMARY_WEAPONS; i++) gs.weaponSel[j][i] = 0
    }
    // {$IFNDEF SERVER} LimboMenu 갱신 — 생략.
  }

  // teamScore / teamFlag 리셋 (625-629)
  for (let i = 1; i <= 4; i++) gs.teamScore[i] = 0
  for (let i = 1; i <= 2; i++) gs.teamFlag[i] = 0

  // {$IFNDEF SERVER} FragsMenu/StatsMenu/LimboMenu — 클라 전용, 생략.

  // {$IFDEF SERVER} 모드별 씽 스폰 (639-683). CTF/INF 깃발 + 고정포만 채택; 나머지 모드는 스텁.
  // POINTMATCH/HTF 노란 깃발 (639-643) — TODO(M2후속) 스텁.
  if (gs.svGamemode === GAMESTYLE_POINTMATCH || gs.svGamemode === GAMESTYLE_HTF) {
    // TODO(M2후속): RandomizeStart(a,14) → TeamFlag[1] = CreateThing(OBJECT_POINTMATCH_FLAG).
  }

  // CTF/INF 빨강·파랑 깃발 (645-655)
  if (gs.svGamemode === GAMESTYLE_CTF || gs.svGamemode === GAMESTYLE_INF) {
    const red = randomizeStart(gs, 5)
    if (red.result) gs.teamFlag[1] = createThing(gs, red.start, 255, OBJECT_ALPHA_FLAG, 255)
    const blue = randomizeStart(gs, 6)
    if (blue.result) gs.teamFlag[2] = createThing(gs, blue.start, 255, OBJECT_BRAVO_FLAG, 255)
  }

  // RAMBO 활 (657-661) — TODO(M2후속) 스텁 (RAMBO 미주력).
  // 메디킷/수류탄킷 (663-672) — SpawnThings 미포팅이라 TODO(M2후속) 스텁.

  // 고정포 (674-683): sv_stationaryguns 시 team=16 스폰포인트마다 스폰.
  if (gs.svStationaryguns) {
    for (let i = 1; i <= MAX_SPAWNPOINTS && i < gs.map.spawnpoints.length; i++) {
      const sp = gs.map.spawnpoints[i]
      if (sp.active && sp.team === 16) {
        createThing(gs, vector2(sp.x, sp.y), 255, OBJECT_STATIONARY_GUN, 255)
      }
    }
  }

  // {$IFNDEF SERVER} Heartbeat/카메라/마우스/스폰사운드 — 클라 전용, 생략.
  // DEMO autorecord — 생략.

  sortPlayers(gs)

  gs.mapChangeCounter = -60
  gs.timeLimitCounter = gs.svTimelimit
  // {$IFDEF SERVER} ServerSpriteSnapshotMajor(NETW) — TODO(M3) NET.
}

// gs.sortPlayers 훅 배선 — Kill/Die/캡처(sprites.ts, things.ts)가 호출하는 콜백을 실제
// sortPlayers(gs)에 연결한다. createGameState()는 core 순환의존을 피해 훅을 no-op으로 두므로,
// GameState를 만든 셋업 코드(web/main.ts, tests/helpers.ts)가 이 함수를 한 번 호출해 배선한다.
export function wireGameHooks(gs: GameState): void {
  gs.sortPlayers = () => sortPlayers(gs)
}
