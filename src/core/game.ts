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
import { MAX_SPRITES } from './sprites'
import type { GameState } from './state'
import { cloneVec2 } from './vector'
import { ILUMINATESPEED, MAX_OLDPOS } from './constants'

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

    // TODO(M2): Bullets update — for j := 1 to MAX_BULLETS: if Bullet[j].Active then
    //   Bullet[j].Update (ServerLoop.pas:302-304)
    // TODO(M2): BulletParts.DoEulerTimeStep (306)
    // TODO(M2): Things update — for j := 1 to MAX_THINGS: if Thing[j].Active then
    //   Thing[j].Update (309-311)
    // TODO(M2): Bonuses spawn — sv_bonus_* 확률 스폰 (314-359, survival/realistic 제외 게이트)
  }

  // bullet timer (363-370)
  if (gs.bulletTimeTimer > -1) gs.bulletTimeTimer--

  if (gs.bulletTimeTimer === 0) {
    // TODO(M2): ToggleBulletTime(False) — Game.pas 불릿타임 토글 미포팅
    gs.bulletTimeTimer = -1
  } else if (gs.bulletTimeTimer < 1) {
    // MapChange counter update (374-377)
    if (gs.mapChangeCounter > -60 && gs.mapChangeCounter < 99999999) {
      gs.mapChangeCounter = gs.mapChangeCounter - 1
    }
    // TODO(M2): if (MapChangeCounter < 0) and (MapChangeCounter > -59) then ChangeMap —
    //   맵 로테이션 미포팅 (게임 진행 상태는 MapChangeCounter = -60 에서 안정)

    // TODO(M3): 게임 스탯 저장(380-393), 안티 매스플래그(396-423), sv_healthcooldown
    //   HasPack 리셋(425-429), 안티 채팅플러드(431-441), 방화벽 IP(443-456), 로비(458-462),
    //   밴 타이머(464-470), PlayTime 집계(472-475), 빈 서버 맵체인지(478-481) — 서버 관리 계열

    gs.sinusCounter = gs.sinusCounter + ILUMINATESPEED

    // Wave respawn count (487-489)
    gs.waveRespawnCounter = gs.waveRespawnCounter - 1
    if (gs.waveRespawnCounter < 1) gs.waveRespawnCounter = gs.waveRespawnTime

    // TODO(M3): VoteCooldown 감소 (491-493)
    // TODO(M2): TimeLimitCounter 감소 + NextMap + TimeLeft 콘솔 (496-518)
    // TODO(M3): TimerVote / MainConsole 스크롤 (523-531)
    // TODO(M2): if not sv_advancemode then WeaponSel 전부 1 리셋 (533-536)
  } // bullettime off

  // TODO(M2): INF 블루팀 점수(542-555)·HTF 점수(558-583) — SortPlayers(Game.pas, 미포팅) 의존
  // TODO(M2): 람보 활 재스폰 (586-609) — Things/Guns 의존
  // TODO(M2): 중복 깃발 정리 + 깃발 재생성 (612-678) — Things 의존
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
