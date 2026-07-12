// 1:1 포팅: soldat-ref/soldat/shared/mechanics/Sparks.pas (574 lines)
// TSpark — 시청각 파티클(불꽃/연기/탄피/핏방울/폭발 프레임...) 물리 + 맵 충돌 바운스.
//
// 공통 포팅 규약 12 (의도적 이탈): 원본은 `Spark[]` 배열 자체가 `{$IFNDEF SERVER}` (Game.pas:117)
// — 서버 빌드엔 스파크가 없다. 이 포트는 권위 로컬 심이므로 스파크를 core에 채택한다(스파크가
// 게임플레이 판정에 역류하는 경로가 없음을 사후 검증 완료 — 계획서 규약 12 참조).
//
// 이 태스크(Task 3) 스코프
// ------------------------
// * 채택(시뮬레이션 — core에 실동작으로 포함):
//   - TSpark 필드 전체 (8-20)
//   - CreateSpark (35-98): 카메라 컬링 게이트(42-57)만 제외, 풀 예산 로직(59-73)은 채택
//     (`r_maxsparks` cvar → 계획서 지시대로 상수 MAX_SPARKS(558)로 고정 — 아래 주석 참조).
//   - TSpark.Update (101-161): NONEULER_STYLE/COLLIDABLE_STYLE 집합 그대로, 2차 스파크 스폰
//     (136-155) 채택. 카메라 셰이크(120-133)만 제외.
//   - TSpark.CheckMapCollision (420-551): SPARK_SURFACECOEF 바운스 + 스타일별 2차 스폰/사운드/
//     Kill 임계값 전부.
//   - TSpark.Kill (553-559), TSpark.CheckOutOfBounds (561-574).
// * 생략(클라 전용 — 코스메틱, 규약 8c/11):
//   - CreateSpark의 카메라 컬링 게이트 (42-57): CameraFollowSprite/MySprite/PointVisible류는
//     아직 포팅되지 않은 클라 상태이고 순수 렌더 최적화(화면 밖 스파크 생성 스킵)라 core는
//     항상 생성한다. 원본 라인은 아래 주석으로 shape만 보존.
//   - Update의 카메라 셰이크 (120-133): 규약 11 — 카메라 흔들림은 core에서 생략, web(M4) 소관.
//     PlaySound 호출부는 전부 `gs.playSound(sfx, pos)` 훅으로 치환(규약 11).
//   - TSpark.Render (163-418): 텍스처 드로우 전용(GfxDrawSprite 케이스 73개) — Constants.pas
//     포트 헤더가 이미 명시했듯 GFX_*/GFXG_* 리소스 ID 자체가 아직 이 코드베이스에 없다
//     (gfx.inc 미포팅). 완전히 클라 렌더 소관이라 core에는 메서드 자체를 두지 않는다 — web/
//     bulletsrender.ts(Task 13)가 `style`/`life`/`lifeReal`을 읽어 자체 텍스처 매핑으로 그린다.
//
// SparksCount vs r_maxsparks — 헷갈리기 쉬운 두 전역
// ---------------------------------------------------
// * `SparksCount` (Sparks.pas:26 유닛 전역, 정수) — "현재 활성 스파크 개수". 클라
//   UpdateFrame.pas:76-82가 매 프레임 0으로 리셋 후 활성 스파크 update마다 +1 — 이 배선은
//   game.ts의 틱 오더(Task 10) 몫이다. 이 파일은 규약 14(전역은 GameState로)에 따라
//   `gs.sparksCount` 필드만 선언/참조하고(state.ts), 갱신은 하지 않는다.
// * `r_maxsparks` (렌더 cvar, Value 조정 가능) — CreateSpark/Update가 예산 상한 비교에 쓰는
//   임계값. 계획서 지시대로 상수 MAX_SPARKS(=558)로 고정한다. 그 결과 Update의
//   `r_maxsparks.Value > (MAX_SPARKS - 10)` 형태 비교는 `MAX_SPARKS > MAX_SPARKS - 10`이 되어
//   항상 참으로 평가된다 — "임의 튜닝 금지" 규약에 따라 조건식 자체(비교 표현)는 원본 그대로
//   남기고 값만 상수로 치환했다(지우거나 단순화하지 않음).
//
// 순환 임포트 차단: 이 파일은 GameState를 `import type`으로만 참조한다(리스크 지도 #10). state.ts
// 쪽은 반대로 TSpark를 런타임 값으로 import해서 `new TSpark(i)`를 호출한다 — 단방향.
import { type TVector2, vector2, cloneVec2, vec2Subtract, vec2Scale, vec2Normalize } from './vector'
import { random, pascalRound, trunc } from './pascal'
import { MAX_SPARKS, SPARK_SURFACECOEF, teamCollides } from './sprites'
import {
  POLY_TYPE_BOUNCY,
  POLY_TYPE_ONLY_BULLETS,
  POLY_TYPE_ONLY_PLAYER,
  POLY_TYPE_DOESNT,
  POLY_TYPE_BACKGROUND,
  POLY_TYPE_BACKGROUND_TRANSITION,
} from './polymap'
import { SFX_TS, SFX_CLIPFALL, SFX_SHELL, SFX_GAUGESHELL } from './constants'
import type { GameState } from './state'

export { MAX_SPARKS }

/* ****************************************************************************
 *                     TSpark (Sparks.pas:8-21, 101-161, 420-574)             *
 **************************************************************************** */

// Sparks.pas:103 NONEULER_STYLE — 이 스타일들은 SparkParts 오일러 적분을 건너뛴다(제자리 유지 —
// 예: 클립 낙하 애니메이션이 아니라 고정 위치 폭발 프레임).
const NONEULER_STYLE = new Set([12, 13, 14, 15, 17, 24, 25, 28, 29, 31, 36, 37, 50, 54, 56, 60])

// Sparks.pas:105-107 COLLIDABLE_STYLE — 이 스타일들만 맵 충돌(바운스)을 검사한다.
const COLLIDABLE_STYLE = new Set([
  2, 4, 5, 6, 7, 8, 9, 10, 11, 13, 16, 18, 19, 20, 21, 22, 23, 30, 32, 33, 34, 40, 41, 42, 43, 48, 49, 51, 52, 57, 62,
  64, 65, 66, 67, 68, 69, 70, 71, 72, 73,
])

export class TSpark {
  active = false
  num = 0 // SmallInt — 자신의 gs.spark/gs.sparkParts 슬롯 인덱스 (1-based)
  // Sparks.pas:11 LifeReal: Single — 렌더 보간용(GameRendering.pas:793 `Lerp(LifePrev, Life, p)`).
  // 시뮬레이션은 건드리지 않는다 — web/T13이 프레임마다 세팅.
  lifeReal = 0
  life = 0 // Byte — 수명 카운트다운
  lifePrev = 0 // Byte
  style = 0 // Byte
  owner = 0 // Byte — 스폰한 스프라이트 번호 (1..32); 0/범위밖은 "소유자 없음"
  collideCount = 0 // Byte

  constructor(num: number) {
    this.num = num
  }

  // Sparks.pas:101-161 TSpark.Update
  update(gs: GameState): void {
    if (!NONEULER_STYLE.has(this.style)) {
      gs.sparkParts.doEulerTimeStepFor(this.num)
    }

    this.checkOutOfBounds(gs)

    // check collision with map
    if (COLLIDABLE_STYLE.has(this.style)) {
      this.checkMapCollision(gs, gs.sparkParts.pos[this.num].x, gs.sparkParts.pos[this.num].y)
    }

    // Sparks.pas:120-133 폭발 시 카메라 흔들림 — 공통 포팅 규약 11: 카메라 셰이크는 core에서
    // 생략(web M4 소관). MySprite/CameraFollowSprite/DemoPlayer는 아직 포팅되지 않은 클라 상태.
    // if (MySprite > 0) and (CameraFollowSprite > 0) and (not DemoPlayer.Active) then
    //   if (Style = 17) or (Style = 12) or (Style = 14) or (Style = 15) or (Style = 28) then
    //     if PointVisible(SparkParts.Pos[Num].X, SparkParts.Pos[Num].Y, CameraFollowSprite) then
    //       if Life > EXPLOSION_ANIMS * 2.3 then
    //       begin
    //         Wobble := Life div 6;
    //         WobbleX := Random(2 * Wobble + 1);
    //         WobbleY := Random(2 * Wobble);
    //         CameraX := CameraX - Wobble + WobbleX;
    //         CameraY := CameraY - Wobble + WobbleY;
    //       end;

    // Sparks.pas:135-138 smoke luska — r_maxsparks는 상수 MAX_SPARKS로 고정(파일 헤더 참조) →
    // `MAX_SPARKS > MAX_SPARKS - 10`은 항상 참(비교식은 원본 그대로 보존, 값만 치환).
    if (MAX_SPARKS > MAX_SPARKS - 10 && this.style > 64 && this.life > 235 && random(32) === 0) {
      createSpark(
        gs,
        cloneVec2(gs.sparkParts.pos[this.num]),
        cloneVec2(gs.sparkParts.velocity[this.num]),
        31,
        this.owner,
        40,
      )
    }

    // Sparks.pas:140-151 smoke m79 luska
    if (MAX_SPARKS > MAX_SPARKS - 10 && this.style === 52) {
      if (this.life > 235 && random(6) === 0) {
        createSpark(
          gs,
          cloneVec2(gs.sparkParts.pos[this.num]),
          cloneVec2(gs.sparkParts.velocity[this.num]),
          31,
          this.owner,
          40,
        )
      }

      if (this.life > 85 && this.life < 235 && random(15) === 0) {
        createSpark(
          gs,
          cloneVec2(gs.sparkParts.pos[this.num]),
          cloneVec2(gs.sparkParts.velocity[this.num]),
          31,
          this.owner,
          35,
        )
      }

      if (this.life < 85 && random(24) === 0) {
        createSpark(
          gs,
          cloneVec2(gs.sparkParts.pos[this.num]),
          cloneVec2(gs.sparkParts.velocity[this.num]),
          31,
          this.owner,
          30,
        )
      }
    }

    // Sparks.pas:153-155 iskry
    if (MAX_SPARKS > MAX_SPARKS - 10 && this.style === 2 && random(8) === 0) {
      createSpark(gs, cloneVec2(gs.sparkParts.pos[this.num]), vector2(0, 0), 26, this.owner, 35)
    }

    this.lifePrev = this.life
    this.life = this.life - 1
    if (this.life === 0) this.kill(gs)
  }

  // Sparks.pas:420-551 TSpark.CheckMapCollision
  checkMapCollision(gs: GameState, x: number, y: number): boolean {
    const map = gs.map

    const pos: TVector2 = vector2(x - 8, y - 1)

    // iterate through maps sector polygons
    const kx = pascalRound(pos.x / map.sectorsDivision)
    const ky = pascalRound(pos.y / map.sectorsDivision)
    if (kx < -map.sectorsNum || kx > map.sectorsNum || ky < -map.sectorsNum || ky > map.sectorsNum) {
      return false
    }

    // Pascal: `if High(Map.Sectors[kx, ky].Polys) > 0 then for j := 1 to High(...) do` — the `if`
    // guard is redundant with the for-loop's own bounds (a 1-to-0 Pascal for loop is a no-op
    // already), so the `j < sectorPolys.length` loop condition below reproduces both at once.
    const sectorPolys = map.sectorPolys(kx, ky)
    for (let j = 1; j < sectorPolys.length; j++) {
      const w = sectorPolys[j]

      if (this.owner < 1 || this.owner > 32) return false

      const teamcol = teamCollides(map, w, gs.sprite[this.owner].player!.team, false)

      const pt = map.polyType[w]
      if (
        teamcol &&
        !(pt === POLY_TYPE_BOUNCY && gs.sprite[this.owner].holdedThing === 0) &&
        pt !== POLY_TYPE_ONLY_BULLETS &&
        pt !== POLY_TYPE_ONLY_PLAYER &&
        pt !== POLY_TYPE_DOESNT &&
        pt !== POLY_TYPE_BACKGROUND &&
        pt !== POLY_TYPE_BACKGROUND_TRANSITION &&
        map.pointInPolyEdges(pos.x, pos.y, w)
      ) {
        const cp = map.closestPerpendicular(w, pos)
        let perp = vec2Normalize(cp.perp)
        perp = vec2Scale(perp, cp.d)

        gs.sparkParts.velocity[this.num] = vec2Subtract(gs.sparkParts.velocity[this.num], perp)
        gs.sparkParts.velocity[this.num] = vec2Scale(gs.sparkParts.velocity[this.num], SPARK_SURFACECOEF)

        switch (this.style) {
          case 2:
          case 62: {
            perp = vec2Scale(perp, 2.5)
            perp = { x: perp.x - 0.5 + random(11) / 10, y: -perp.y }
            if (random(2) === 0) {
              if (random(2) === 0) createSpark(gs, cloneVec2(pos), cloneVec2(perp), 26, this.owner, 35)
              else createSpark(gs, cloneVec2(pos), cloneVec2(perp), 27, this.owner, 35)

              gs.playSound(SFX_TS, gs.sparkParts.pos[this.num])
            }
            break
          }
          case 33:
          case 34: {
            perp = vec2Scale(perp, 2.5)
            perp = { x: perp.x - 0.5 + random(11) / 10, y: -perp.y }
            if (random(7) === 0) createSpark(gs, cloneVec2(pos), cloneVec2(perp), 26, this.owner, 35)
            else createSpark(gs, cloneVec2(pos), cloneVec2(perp), 27, this.owner, 35)

            if (this.collideCount > 4) this.kill(gs)
            break
          }
          case 4:
          case 5: {
            if (this.style === 5) {
              createSpark(
                gs,
                cloneVec2(gs.sparkParts.pos[this.num]),
                cloneVec2(gs.sparkParts.velocity[this.num]),
                55,
                this.owner,
                30,
              )
            }

            if (this.collideCount > 1) this.kill(gs)
            break
          }
          case 6: {
            if (this.collideCount === 0 || this.collideCount === 2 || this.collideCount === 4) {
              gs.playSound(SFX_CLIPFALL, gs.sparkParts.pos[this.num])
            }

            if (this.collideCount > 4) this.kill(gs)
            break
          }
          case 7:
          case 21:
          case 22:
          case 16:
          case 30:
          case 52:
          case 65:
          case 66:
          case 67:
          case 68:
          case 69:
          case 70:
          case 71:
          case 72:
          case 73: {
            if (this.collideCount === 0 || this.collideCount === 2 || this.collideCount === 4) {
              gs.playSound(SFX_SHELL + random(2), gs.sparkParts.pos[this.num])
            }
            if (this.collideCount > 4) this.kill(gs)
            break
          }
          case 51: {
            gs.playSound(SFX_GAUGESHELL, gs.sparkParts.pos[this.num])
            if (this.collideCount > 4) this.kill(gs)
            break
          }
          case 32:
          case 48:
          case 49: {
            if (this.collideCount > 2) this.kill(gs)
            break
          }
          case 9:
          case 10:
          case 11:
          case 18:
          case 19:
          case 20:
          case 23: {
            if (this.collideCount === 0 || this.collideCount === 4) {
              gs.playSound(SFX_CLIPFALL, gs.sparkParts.pos[this.num])
            }
            if (this.collideCount > 4) this.kill(gs)
            break
          }
          case 57: {
            perp = vec2Scale(perp, 0.75)
            perp = { x: perp.x - 0.5 + random(11) / 10, y: -perp.y }
            // 원본 그대로 보존: Random(2)의 양쪽 분기 모두 style 58 스파크를 만든다(분기 자체는
            // 무의미하지만 RNG 스트림을 소모하는 부작용까지 재현 — Sparks.pas:539-541).
            if (random(2) === 0) createSpark(gs, cloneVec2(pos), cloneVec2(perp), 58, this.owner, 50)
            else createSpark(gs, cloneVec2(pos), cloneVec2(perp), 58, this.owner, 50)
            break
          }
        }

        this.collideCount++
        return true
      } // PointInPolyEdges
    } // for j

    return false
  }

  // Sparks.pas:553-559 TSpark.Kill
  kill(gs: GameState): void {
    this.active = false
    this.style = 0
    if (this.num > 0) {
      gs.sparkParts.active[this.num] = false
    }
  }

  // Sparks.pas:561-572 TSpark.CheckOutOfBounds
  checkOutOfBounds(gs: GameState): void {
    const bound = gs.map.sectorsNum * gs.map.sectorsDivision - 10
    const p = gs.sparkParts.pos[this.num]

    if (Math.abs(p.x) > bound || Math.abs(p.y) > bound) {
      this.kill(gs)
    }
  }
}

/* ****************************************************************************
 *                          CreateSpark (Sparks.pas:35-98)                    *
 **************************************************************************** */

export function createSpark(
  gs: GameState,
  sPos: TVector2,
  sVelocity: TVector2,
  sStyle: number,
  sOwner: number,
  life: number,
): number {
  let result = 0

  // Sparks.pas:42-57 카메라 컬링 게이트 — 화면 밖(비가시) 스파크의 생성을 건너뛰는 클라 전용
  // 렌더 최적화. CameraFollowSprite/MySprite/PointVisible/PointVisible2는 아직 포팅되지 않은
  // 클라 상태 — 공통 포팅 규약 8(c)/11에 따라 core는 항상 생성하고 이 게이트는 생략한다(웹 M4).
  // if CameraFollowSprite > 0 then
  // begin
  //   if CameraFollowSprite = MySprite then
  //     if not PointVisible(sPos.X, sPos.Y, CameraFollowSprite) and (sStyle <> 38) then
  //     begin
  //       Result := 0;
  //       Exit;
  //     end;
  //   if CameraFollowSprite <> MySprite then
  //     if not PointVisible2(sPos.X, sPos.Y, CameraFollowSprite) and (sStyle <> 38) then
  //     begin
  //       Result := 0;
  //       Exit;
  //     end;
  // end;

  // Sparks.pas:59-73 스파크 풀 예산 + 빈 슬롯 스캔. `SparksCount`는 gs.sparksCount(현재 활성
  // 스파크 수 — game.ts Task 10의 틱 루프가 매 프레임 재계산)이고, `r_maxsparks.Value`는 계획서
  // 지시대로 상수 MAX_SPARKS로 고정한다(둘을 혼동하지 말 것 — 파일 헤더 참조).
  //
  // Pascal은 `for i := 1 to r_maxsparks.Value + 1 do`(= MAX_SPARKS+1까지) 순회하지만, i가
  // MAX_SPARKS에 도달하면 무조건 Break하는 분기가 먼저 걸리므로 i가 실제로 MAX_SPARKS+1에
  // 도달하는 경우는 없다 — 원본 그대로 루프 상한을 보존한다(고치지 않음).
  for (let i = 1; i <= MAX_SPARKS + 1; i++) {
    if (
      gs.sparksCount > MAX_SPARKS - 50 &&
      (sStyle === 3 || sStyle === 4 || sStyle === 26 || sStyle === 27 || sStyle === 59 || sStyle === 2)
    ) {
      return 0
    }
    if (gs.sparksCount > MAX_SPARKS - 40 && sStyle === 1) return 0
    if (gs.sparksCount > MAX_SPARKS - 30 && sStyle === 24) return 0

    if (i === MAX_SPARKS) {
      result = random(trunc(MAX_SPARKS / 3)) + 1
      break
    }
    if (!gs.spark[i].active && gs.spark[i].style === 0 && !gs.sparkParts.active[i]) {
      result = i
      break
    }
  }

  // i is now the active sprite
  const i = result

  // activate sprite
  gs.spark[i].active = true
  gs.spark[i].life = life
  gs.spark[i].style = sStyle
  gs.spark[i].num = i
  gs.spark[i].owner = sOwner
  gs.spark[i].collideCount = 0

  const m = 1

  // activate sprite part
  gs.sparkParts.createPart(sPos, sVelocity, m, i)

  return i
}
