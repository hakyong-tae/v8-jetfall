// 1:1 포팅: soldat-ref/soldat/shared/PolyMap.pas (749 lines)
// TPolyMap — 충돌 지오메트리(폴리곤) + 섹터 그리드 공간 분할. 매 틱 스프라이트/불릿 물리에서
// 조회된다.
//
// 스코프 노트
// -----------
// * LoadMap 두 오버로드(TMapInfo 기반, PHYSFS 파일 IO)는 포팅하지 않는다 — 이 포트의 진입점은
//   loadData(mapFile: TMapFile)뿐이다 (호출자가 이미 loadMapFile()로 파싱한 TMapFile을 넘긴다).
//   그 결과 LoadMap에서만 채워지는 MapInfo/Name/Filename 필드는 Initialize/LoadData 그 어느 쪽도
//   건드리지 않으므로(원본 확인됨) 이 포트에서도 별도로 다루지 않는다 — Name/Filename만 구조적
//   동등성을 위해 필드로 남겨두고(Initialize가 ''로 리셋) MapInfo(TMapInfo 타입 자체가 아직
//   존재하지 않음)는 완전히 생략했다.
// * BotPath(TWaypoints, Game.pas 전역)에 대한 Initialize의 FillChar와 LoadData의
//   Move/범위체크 루프는 생략했다 — Waypoints.pas/Game.pas가 아직 포팅되지 않았고, 이는
//   TPolyMap 자신의 상태가 아니라 외부 전역에 대한 부수효과이기 때문이다.
// * TLoadGraphics 훅(클라이언트 렌더링 콜백)은 생략 — 렌더링은 이 태스크 범위 밖이다.
// * CheckOutOfBounds의 두 오버로드(Single / SmallInt)는 JS에 그런 타입 구분이 없으므로 하나로
//   합쳤다. 원본은 Game.pas의 전역 `Map: TPolyMap` 싱글턴을 암묵적으로 읽지만, 그 전역이 아직
//   없으므로 `polyMap`을 명시적 인자로 받는다.
//
// var out-param 변환 규칙 (하나로 통일)
// --------------------------------------
// calc.ts가 이미 확립한 "결과 객체(return object)" 패턴을 그대로 따른다(예:
// LineCircleCollisionResult { hit, collisionPoint }). `{ value }` 참조 객체 패턴은 쓰지 않는다.
//   - LineInPoly(var v)              → { hit, v }              (hit=false면 v는 최후 계산값이 남아
//                                                                있을 수 있음 — Pascal의 var 파라미터가
//                                                                호출 전 상태를 유지하는 것과 동일하게,
//                                                                실패 시 읽지 않을 것)
//   - ClosestPerpendicular(var d, n) → { perp, d, n }
//   - CollisionTest(var PerpVec)     → { hit, perpVec }
//   - CollisionTestExcept(var PerpVec) → { hit, perpVec }
//   - RayCast(var Distance)          → { hit, distance }
//   - CheckOutOfBounds(var x, var y) → { x, y }
//
// MAX_* 상수 출처 재정리
// ----------------------
// MAX_POLYS/MAX_SECTOR/MAX_PROPS/MAX_SPAWNPOINTS/MAX_COLLIDERS는 PolyMap.pas가 정의하는
// 상수다(MapFile.pas는 이를 참조만 한다). mapfile.ts는 PolyMap.pas가 아직 없던 시절 임시로 이
// 상수들을 로컬 정의했었는데, 이제 이 파일이 "진짜 주인"이므로 mapfile.ts는 여기서 import해서
// 쓰도록 리팩터링했다(하나의 출처). MAX_WAYPOINTS/MAX_CONNECTIONS(Waypoints.pas 소유, 아직
// 미포팅)는 mapfile.ts에 그대로 로컬로 남아있다.
//
// 섹터 그리드 표현
// -----------------
// Pascal: `Sectors: array[MIN_SECTORZ..MAX_SECTORZ, MIN_SECTORZ..MAX_SECTORZ] of TMapSector;`
// (고정 2D 배열, 인덱스 -35..35). 이 포트는 오프셋을 적용한 1D 플랫 배열로 그 정확한 범위를
// 그대로 미러링한다(Map을 쓰지 않은 이유: 선언된 배열 범위 전체가 유효한 조회 대상이고 — 특히
// RayCast가 MIN_SECTORZ/MAX_SECTORZ까지 클램프해서 순회하므로 — 희소 Map보다 고정 크기 배열이
// Pascal 선언에 더 충실하다). LoadData가 실제로 채우는 범위는 -SectorsNum..SectorsNum뿐이고
// (SectorsNum <= MAX_SECTOR(25) < MAX_SECTORZ(35)), 그 밖의 셀은 Initialize가 채운 빈
// `{ polys: [0] }`(= Pascal의 nil 동적 배열, High(nil)=-1이라 순회 0회와 동일) 상태로 남는다.
//
// 1-based 배열 패딩 규약
// -----------------------
// 이 코드베이스의 기존 관례(parts.ts, mapfile.ts)를 따라 Pascal의 1-based 배열들
// (Polys/PolyType/Perp/Bounciness/Spawnpoints/Collider/BackPolys/FlagSpawn, 그리고 섹터 내부의
// Polys)은 index 0을 더미로 채운 배열로 표현한다. 단, Pascal 선언은 고정 크기(MAX_POLYS=5000 등)
// 이지만 이 포트는 mapfile.ts와 마찬가지로 실제 로드된 개수(+1) 만큼만 할당한다 — RayCast/
// CollisionTest 등은 항상 유효한(1..PolyCount) 인덱스만 참조하므로(맵이 올바르다면) 나머지
// 슬롯이 0으로 채워져 있을 필요가 없다.

import {
  type TVector2,
  type TVector3,
  vector2,
  vec2Length,
  vec2Normalize,
  vec2Scale,
  vec2Subtract,
} from './vector'
import { pascalRound, trunc } from './pascal'
import { pointLineDistance, sqrDist } from './calc'
import { TEAM_ALPHA, TEAM_BRAVO, TEAM_CHARLIE, TEAM_DELTA } from './constants'
import type { TMapCollider, TMapFile, TMapPolygon, TMapSpawnpoint, TMapVertex } from './mapfile'

/* ****************************************************************************
 *                                 Constants                                  *
 **************************************************************************** */

// PolyMap.pas:8-18
export const MAX_POLYS = 5000
export const MIN_SECTOR = -25
export const MAX_SECTOR = 25
export const MIN_SECTORZ = -35
export const MAX_SECTORZ = 35
export const TILESECTOR = 3
export const MIN_TILE = MIN_SECTOR * TILESECTOR
export const MAX_TILE = MAX_SECTOR * TILESECTOR
export const MAX_PROPS = 500
export const MAX_SPAWNPOINTS = 255
export const MAX_COLLIDERS = 128

// PolyMap.pas:21-45 — polygon types
export const POLY_TYPE_NORMAL = 0
export const POLY_TYPE_ONLY_BULLETS = 1
export const POLY_TYPE_ONLY_PLAYER = 2
export const POLY_TYPE_DOESNT = 3
export const POLY_TYPE_ICE = 4
export const POLY_TYPE_DEADLY = 5
export const POLY_TYPE_BLOODY_DEADLY = 6
export const POLY_TYPE_HURTS = 7
export const POLY_TYPE_REGENERATES = 8
export const POLY_TYPE_LAVA = 9
export const POLY_TYPE_RED_BULLETS = 10
export const POLY_TYPE_RED_PLAYER = 11
export const POLY_TYPE_BLUE_BULLETS = 12
export const POLY_TYPE_BLUE_PLAYER = 13
export const POLY_TYPE_YELLOW_BULLETS = 14
export const POLY_TYPE_YELLOW_PLAYER = 15
export const POLY_TYPE_GREEN_BULLETS = 16
export const POLY_TYPE_GREEN_PLAYER = 17
export const POLY_TYPE_BOUNCY = 18
export const POLY_TYPE_EXPLODES = 19
export const POLY_TYPE_HURTS_FLAGGERS = 20
export const POLY_TYPE_ONLY_FLAGGERS = 21
export const POLY_TYPE_NOT_FLAGGERS = 22
export const POLY_TYPE_NON_FLAGGER_COLLIDES = 23
export const POLY_TYPE_BACKGROUND = 24
export const POLY_TYPE_BACKGROUND_TRANSITION = 25

// PolyMap.pas:47-59
export const BACKGROUND_NORMAL = 0
export const BACKGROUND_TRANSITION = 1
export const BACKGROUND_POLY_UNKNOWN = -2
export const BACKGROUND_POLY_NONE = -1

// PolyMap.pas:265-267 CollisionTest EXCLUDED1/EXCLUDED2 poly-type sets
const CT_EXCLUDED1 = new Set([1, 2, 3, 11, 13, 15, 17, 24, 25])
const CT_EXCLUDED2 = new Set([21, 22, 23])
// PolyMap.pas:291 CollisionTestExcept EXCLUDED poly-type set
const CTE_EXCLUDED = new Set([1, 2, 3, 11, 24, 25])

const SECTOR_GRID_WIDTH = MAX_SECTORZ - MIN_SECTORZ + 1 // 71

/* ****************************************************************************
 *                            Free-standing helpers                          *
 **************************************************************************** */

function zeroVertex(): TMapVertex {
  return { x: 0, y: 0, z: 0, rhw: 0, color: [0, 0, 0, 0], u: 0, v: 0 }
}
function zeroVec3(): TVector3 {
  return { x: 0, y: 0, z: 0 }
}
function dummyPolygon(): TMapPolygon {
  const zv = zeroVertex()
  const z3 = zeroVec3()
  return { vertices: [zv, zv, zv, zv], normals: [z3, z3, z3, z3], polyType: 0, textureIndex: 0 }
}
function dummyCollider(): TMapCollider {
  return { active: false, x: 0, y: 0, radius: 0 }
}
function dummySpawnpoint(): TMapSpawnpoint {
  return { active: false, x: 0, y: 0, team: 0 }
}

// Pascal: function TPolyMap.PointInPoly(const p: TVector2; const Poly: TMapPolygon): Boolean;
// Takes the polygon by value (doesn't touch Self), so this is a free function rather than a
// method — that also lets it be exercised directly against a hand-built TMapPolygon in tests.
export function pointInPoly(p: TVector2, poly: TMapPolygon): boolean {
  const a = poly.vertices[1]
  const b = poly.vertices[2]
  const c = poly.vertices[3]

  const apX = p.x - a.x
  const apY = p.y - a.y

  const pAB = (b.x - a.x) * apY - (b.y - a.y) * apX > 0
  const pAC = (c.x - a.x) * apY - (c.y - a.y) * apX > 0

  if (pAC === pAB) return false

  // p_bc <> p_ab
  if (((c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x) > 0) !== pAB) return false

  return true
}

/* ****************************************************************************
 *                                Result types                                *
 **************************************************************************** */

export interface LineInPolyResult {
  hit: boolean
  v: TVector2
}

export interface ClosestPerpendicularResult {
  perp: TVector2
  d: number
  n: number
}

export interface CollisionTestResult {
  hit: boolean
  perpVec: TVector2
}

export interface RayCastResult {
  hit: boolean
  distance: number
}

export interface CheckOutOfBoundsResult {
  x: number
  y: number
}

// Internal 1-based sector storage: polys[0] is unused padding, polys[1..N] are the (already
// 1-based, per the PMS format) polygon indices for that sector — mirrors Sectors[i,j].Polys after
// LoadData's Move, which shifts MapFile.Sectors[k].Polys[0..N-1] into Self.Sectors[i,j].Polys[1..N]
// without altering the index values themselves.
interface SectorPolys {
  polys: number[]
}

function emptySector(): SectorPolys {
  return { polys: [0] }
}

/* ****************************************************************************
 *                                  TPolyMap                                  *
 **************************************************************************** */

export class PolyMap {
  mapID = 0
  name = ''
  filename = ''
  sectorsDivision = 0
  sectorsNum = 0
  startJet = 0
  grenades = 0
  medikits = 0
  weather = 0
  steps = 0
  polyCount = 0
  backPolyCount = 0
  colliderCount = 0

  // 1-based; index 0 is dummy padding (see file header note).
  polys: TMapPolygon[] = [dummyPolygon()]
  backPolys: number[] = [0] // stores 1-based indices into `polys` (Pascal stores ^TMapPolygon pointers)
  polyType: number[] = [0]
  perp: [TVector2, TVector2, TVector2, TVector2][] = [[vector2(0, 0), vector2(0, 0), vector2(0, 0), vector2(0, 0)]]
  bounciness: number[] = [0]
  spawnpoints: TMapSpawnpoint[] = [dummySpawnpoint()]
  collider: TMapCollider[] = [dummyCollider()]
  flagSpawn: [number, number, number] = [0, 0, 0] // index 0 dummy; [1]/[2] mirror Pascal FlagSpawn[1..2]

  private sectorsFlat: SectorPolys[] = []

  constructor() {
    this.initialize()
  }

  // PolyMap.pas:126-153 TPolyMap.Initialize
  initialize(): void {
    this.mapID = 0
    this.name = ''
    this.filename = ''
    this.sectorsDivision = 0
    this.sectorsNum = 0
    this.startJet = 0
    this.grenades = 0
    this.medikits = 0
    this.weather = 0
    this.steps = 0
    this.polyCount = 0
    this.backPolyCount = 0
    this.colliderCount = 0

    this.polys = [dummyPolygon()]
    this.backPolys = [0]
    this.polyType = [0]
    this.perp = [[vector2(0, 0), vector2(0, 0), vector2(0, 0), vector2(0, 0)]]
    this.bounciness = [0]
    this.spawnpoints = [dummySpawnpoint()]
    this.collider = [dummyCollider()]
    this.flagSpawn = [0, 0, 0]

    this.sectorsFlat = new Array(SECTOR_GRID_WIDTH * SECTOR_GRID_WIDTH)
    for (let i = 0; i < this.sectorsFlat.length; i++) this.sectorsFlat[i] = emptySector()

    // BotPath.Waypoint FillChar — skipped, see file header note (Waypoints.pas/Game.pas not ported).
  }

  private sectorIndex(x: number, y: number): number {
    return (x - MIN_SECTORZ) * SECTOR_GRID_WIDTH + (y - MIN_SECTORZ)
  }

  private getSector(x: number, y: number): SectorPolys {
    return this.sectorsFlat[this.sectorIndex(x, y)]
  }

  // PolyMap.pas:155-236 TPolyMap.LoadData (minus BotPath/Waypoints — see file header note)
  loadData(mapFile: TMapFile): void {
    this.mapID = mapFile.hash
    this.sectorsDivision = mapFile.sectorsDivision
    this.sectorsNum = mapFile.sectorsNum
    this.startJet = trunc((119 * mapFile.startJet) / 100) // quickfix bla bla (PolyMap.pas:161)
    this.grenades = mapFile.grenadePacks
    this.medikits = mapFile.medikits
    this.weather = mapFile.weather
    this.steps = mapFile.steps
    this.polyCount = mapFile.polygons.length
    this.colliderCount = mapFile.colliders.length

    // Move(MapFile.Polygons[0], Self.Polys[1], ...) — 0-based → 1-based shift.
    // Pascal records are value types, so Move gives Self independent copies of the source data;
    // a plain spread would instead share object references with the caller's TMapFile. That's
    // harmless for polys/colliders here (their fields are never mutated after this point), but
    // spawnpoints ARE mutated below (sp.active := False for out-of-range coords) — so spawnpoints
    // must be shallow-copied to avoid corrupting the caller's original TMapFile.
    this.polys = [dummyPolygon(), ...mapFile.polygons]
    this.collider = [dummyCollider(), ...mapFile.colliders]
    this.spawnpoints = [dummySpawnpoint(), ...mapFile.spawnpoints.map((sp) => ({ ...sp }))]

    this.polyType = new Array(this.polyCount + 1).fill(0)
    this.perp = new Array(this.polyCount + 1)
    this.perp[0] = [vector2(0, 0), vector2(0, 0), vector2(0, 0), vector2(0, 0)]
    this.bounciness = new Array(this.polyCount + 1).fill(0)
    this.backPolys = [0]
    this.backPolyCount = 0

    for (let i = 1; i <= this.polyCount; i++) {
      const poly = this.polys[i]
      this.polyType[i] = poly.polyType

      // Perp[i][1..3] := Polys[i].Normals[1..3] (TVector3 -> TVector2, z dropped)
      let p1: TVector2 = { x: poly.normals[1].x, y: poly.normals[1].y }
      let p2: TVector2 = { x: poly.normals[2].x, y: poly.normals[2].y }
      let p3: TVector2 = { x: poly.normals[3].x, y: poly.normals[3].y }

      // Bounciness computed from the RAW (pre-normalize) 3rd perpendicular — order matters,
      // matches PolyMap.pas:187 running before the Vec2Normalize calls on the next lines.
      this.bounciness[i] = vec2Length(p3)

      p1 = vec2Normalize(p1)
      p2 = vec2Normalize(p2)
      p3 = vec2Normalize(p3)

      this.perp[i] = [vector2(0, 0), p1, p2, p3]

      if (this.polyType[i] === POLY_TYPE_BACKGROUND || this.polyType[i] === POLY_TYPE_BACKGROUND_TRANSITION) {
        this.backPolyCount++
        this.backPolys[this.backPolyCount] = i
      }
    }

    // Sector grid: PolyMap.pas:216-227. MapFile.Sectors is a flat array in (i outer=x, j
    // inner=y) order matching this exact nested loop, k incrementing once per (i,j) pair
    // regardless of whether that sector has any polys.
    let k = 0
    for (let i = -this.sectorsNum; i <= this.sectorsNum; i++) {
      for (let j = -this.sectorsNum; j <= this.sectorsNum; j++) {
        const src = mapFile.sectors[k].polys
        if (src.length > 0) {
          const polys = new Array(src.length + 1)
          polys[0] = 0
          for (let m = 0; m < src.length; m++) polys[m + 1] = src[m]
          this.sectorsFlat[this.sectorIndex(i, j)] = { polys }
        } else {
          this.sectorsFlat[this.sectorIndex(i, j)] = emptySector()
        }
        k++
      }
    }

    // PolyMap.pas:229-236 — deactivate spawnpoints with insane coords, then find CTF flag spawns.
    // Team 5/6 here are map-file spawnpoint markers for the two flag spawns, NOT the player-team
    // constants (TEAM_SPECTATOR=5 in constants.ts is unrelated) — kept as the literal Pascal values.
    this.flagSpawn = [0, 0, 0]
    for (let i = 1; i < this.spawnpoints.length; i++) {
      const sp = this.spawnpoints[i]
      if (Math.abs(sp.x) >= 2000000 || Math.abs(sp.y) >= 2000000) sp.active = false

      if (sp.active) {
        if (this.flagSpawn[1] === 0 && sp.team === 5) this.flagSpawn[1] = i
        if (this.flagSpawn[2] === 0 && sp.team === 6) this.flagSpawn[2] = i
      }
    }

    // Waypoints out-of-bounds deactivation loop — skipped, see file header note.
  }

  // PolyMap.pas:369-427 TPolyMap.LineInPoly
  lineInPoly(a: TVector2, b: TVector2, poly: number): LineInPolyResult {
    let v: TVector2 = vector2(0, 0)

    for (let i = 1; i <= 3; i++) {
      const j = i === 3 ? 1 : i + 1
      const p = this.polys[poly].vertices[i]
      const q = this.polys[poly].vertices[j]

      if (b.x !== a.x || q.x !== p.x) {
        if (b.x === a.x) {
          const bk = (q.y - p.y) / (q.x - p.x)
          const bm = p.y - bk * p.x
          const vx = a.x
          const vy = bk * vx + bm
          v = { x: vx, y: vy }

          if (vx > Math.min(p.x, q.x) && vx < Math.max(p.x, q.x) && vy > Math.min(a.y, b.y) && vy < Math.max(a.y, b.y)) {
            return { hit: true, v }
          }
        } else if (q.x === p.x) {
          const ak = (b.y - a.y) / (b.x - a.x)
          const am = a.y - ak * a.x
          const vx = p.x
          const vy = ak * vx + am
          v = { x: vx, y: vy }

          if (vy > Math.min(p.y, q.y) && vy < Math.max(p.y, q.y) && vx > Math.min(a.x, b.x) && vx < Math.max(a.x, b.x)) {
            return { hit: true, v }
          }
        } else {
          const ak = (b.y - a.y) / (b.x - a.x)
          const bk = (q.y - p.y) / (q.x - p.x)

          if (ak !== bk) {
            const am = a.y - ak * a.x
            const bm = p.y - bk * p.x
            const vx = (bm - am) / (ak - bk)
            const vy = ak * vx + am
            v = { x: vx, y: vy }

            if (vx > Math.min(p.x, q.x) && vx < Math.max(p.x, q.x) && vx > Math.min(a.x, b.x) && vx < Math.max(a.x, b.x)) {
              return { hit: true, v }
            }
          }
        }
      }
    }

    // hit=false: `v` holds whatever the last-attempted edge computed (mirrors the Pascal `var v`
    // param, which is only ever written to, never reset) — callers must not read it on a miss.
    return { hit: false, v }
  }

  // PolyMap.pas:429-453 TPolyMap.PointInPolyEdges
  pointInPolyEdges(x: number, y: number, i: number): boolean {
    const poly = this.polys[i]
    const perp = this.perp[i]

    let ux = x - poly.vertices[1].x
    let uy = y - poly.vertices[1].y
    if (perp[1].x * ux + perp[1].y * uy < 0) return false

    ux = x - poly.vertices[2].x
    uy = y - poly.vertices[2].y
    if (perp[2].x * ux + perp[2].y * uy < 0) return false

    ux = x - poly.vertices[3].x
    uy = y - poly.vertices[3].y
    if (perp[3].x * ux + perp[3].y * uy < 0) return false

    return true
  }

  // PolyMap.pas:490-546 TPolyMap.ClosestPerpendicular
  closestPerpendicular(j: number, pos: TVector2): ClosestPerpendicularResult {
    const poly = this.polys[j]
    const px = [0, poly.vertices[1].x, poly.vertices[2].x, poly.vertices[3].x]
    const py = [0, poly.vertices[1].y, poly.vertices[2].y, poly.vertices[3].y]

    let p1: TVector2 = { x: px[1], y: py[1] }
    let p2: TVector2 = { x: px[2], y: py[2] }
    const d1 = pointLineDistance(p1, p2, pos)
    let d = d1
    let edgeV1 = 1
    let edgeV2 = 2

    p1 = { x: px[2], y: py[2] }
    p2 = { x: px[3], y: py[3] }
    const d2 = pointLineDistance(p1, p2, pos)
    if (d2 < d1) {
      edgeV1 = 2
      edgeV2 = 3
      d = d2
    }

    p1 = { x: px[3], y: py[3] }
    p2 = { x: px[1], y: py[1] }
    const d3 = pointLineDistance(p1, p2, pos)
    if (d3 < d2 && d3 < d1) {
      edgeV1 = 3
      edgeV2 = 1
      d = d3
    }

    let perp: TVector2 = vector2(0, 0)
    let n = 0

    if (edgeV1 === 1 && edgeV2 === 2) {
      perp = this.perp[j][1]
      n = 1
    }
    if (edgeV1 === 2 && edgeV2 === 3) {
      perp = this.perp[j][2]
      n = 2
    }
    if (edgeV1 === 3 && edgeV2 === 1) {
      perp = this.perp[j][3]
      n = 3
    }

    return { perp, d, n }
  }

  // PolyMap.pas:548-575 TPolyMap.CollisionTest
  collisionTest(pos: TVector2, isFlag = false): CollisionTestResult {
    let perpVec: TVector2 = vector2(0, 0)

    const kx = pascalRound(pos.x / this.sectorsDivision)
    const ky = pascalRound(pos.y / this.sectorsDivision)

    if (kx > -this.sectorsNum && kx < this.sectorsNum && ky > -this.sectorsNum && ky < this.sectorsNum) {
      const sector = this.getSector(kx, ky)
      for (let j = 1; j < sector.polys.length; j++) {
        const w = sector.polys[j]
        const pt = this.polyType[w]

        if (!CT_EXCLUDED1.has(pt) && (isFlag || !CT_EXCLUDED2.has(pt))) {
          if (pointInPoly(pos, this.polys[w])) {
            const cp = this.closestPerpendicular(w, pos)
            perpVec = vec2Scale(cp.perp, 1.5 * cp.d)
            return { hit: true, perpVec }
          }
        }
      }
    }

    return { hit: false, perpVec }
  }

  // PolyMap.pas:577-604 TPolyMap.CollisionTestExcept
  collisionTestExcept(pos: TVector2, c: number): CollisionTestResult {
    let perpVec: TVector2 = vector2(0, 0)

    const kx = pascalRound(pos.x / this.sectorsDivision)
    const ky = pascalRound(pos.y / this.sectorsDivision)

    if (kx > -this.sectorsNum && kx < this.sectorsNum && ky > -this.sectorsNum && ky < this.sectorsNum) {
      const sector = this.getSector(kx, ky)
      for (let j = 1; j < sector.polys.length; j++) {
        const w = sector.polys[j]
        const pt = this.polyType[w]

        if (w !== c && !CTE_EXCLUDED.has(pt)) {
          if (pointInPoly(pos, this.polys[w])) {
            const cp = this.closestPerpendicular(w, pos)
            perpVec = vec2Scale(cp.perp, 1.5 * cp.d)
            return { hit: true, perpVec }
          }
        }
      }
    }

    return { hit: false, perpVec }
  }

  // PolyMap.pas:607-684 TPolyMap.RayCast
  rayCast(
    a: TVector2,
    b: TVector2,
    maxDist: number,
    player = false,
    flag = false,
    bullet = true,
    checkCollider = false,
    team = 0,
  ): RayCastResult {
    const distance = vec2Length(vec2Subtract(a, b))
    if (distance > maxDist) {
      // Faithful oddity: rays longer than MaxDist short-circuit as an immediate "hit" with a
      // sentinel distance, without any actual geometry test — see PolyMap.pas:614-617.
      return { hit: true, distance: 9999999 }
    }

    let ax = pascalRound(Math.min(a.x, b.x) / this.sectorsDivision)
    let ay = pascalRound(Math.min(a.y, b.y) / this.sectorsDivision)
    let bx = pascalRound(Math.max(a.x, b.x) / this.sectorsDivision)
    let by = pascalRound(Math.max(a.y, b.y) / this.sectorsDivision)

    if (ax > MAX_SECTORZ || bx < MIN_SECTORZ || ay > MAX_SECTORZ || by < MIN_SECTORZ) {
      return { hit: false, distance }
    }

    ax = Math.max(MIN_SECTORZ, ax)
    ay = Math.max(MIN_SECTORZ, ay)
    bx = Math.min(MAX_SECTORZ, bx)
    by = Math.min(MAX_SECTORZ, by)

    const npCol = !player
    const nbCol = !bullet

    for (let i = ax; i <= bx; i++) {
      for (let j = ay; j <= by; j++) {
        const sector = this.getSector(i, j)

        for (let p = 1; p < sector.polys.length; p++) {
          const w = sector.polys[p]
          const pt = this.polyType[w]

          let testcol = true

          if (
            (pt === POLY_TYPE_RED_BULLETS && (team !== TEAM_ALPHA || nbCol)) ||
            (pt === POLY_TYPE_RED_PLAYER && (team !== TEAM_ALPHA || npCol))
          )
            testcol = false
          if (
            (pt === POLY_TYPE_BLUE_BULLETS && (team !== TEAM_BRAVO || nbCol)) ||
            (pt === POLY_TYPE_BLUE_PLAYER && (team !== TEAM_BRAVO || npCol))
          )
            testcol = false
          if (
            (pt === POLY_TYPE_YELLOW_BULLETS && (team !== TEAM_CHARLIE || nbCol)) ||
            (pt === POLY_TYPE_YELLOW_PLAYER && (team !== TEAM_CHARLIE || npCol))
          )
            testcol = false
          if (
            (pt === POLY_TYPE_GREEN_BULLETS && (team !== TEAM_DELTA || nbCol)) ||
            (pt === POLY_TYPE_GREEN_PLAYER && (team !== TEAM_DELTA || npCol))
          )
            testcol = false
          if (((!flag || npCol) && pt === POLY_TYPE_ONLY_FLAGGERS) || ((flag || npCol) && pt === POLY_TYPE_NOT_FLAGGERS))
            testcol = false
          if ((!flag || npCol || nbCol) && pt === POLY_TYPE_NON_FLAGGER_COLLIDES) testcol = false
          if (
            (pt === POLY_TYPE_ONLY_BULLETS && nbCol) ||
            (pt === POLY_TYPE_ONLY_PLAYER && npCol) ||
            pt === POLY_TYPE_DOESNT ||
            pt === POLY_TYPE_BACKGROUND ||
            pt === POLY_TYPE_BACKGROUND_TRANSITION
          )
            testcol = false

          if (testcol) {
            if (pointInPoly(a, this.polys[w])) {
              return { hit: true, distance: 0 }
            }
            const li = this.lineInPoly(a, b, w)
            if (li.hit) {
              const c = vec2Subtract(li.v, a)
              return { hit: true, distance: vec2Length(c) }
            }
          }
        }
      }
    }

    if (checkCollider) {
      // |A*x + B*y + C| / Sqrt(A^2 + B^2) < r
      const e = a.y - b.y
      const f = b.x - a.x
      const g = a.x * b.y - a.y * b.x
      const h = Math.sqrt(e * e + f * f)

      for (let i = 1; i < this.collider.length; i++) {
        const col = this.collider[i]
        if (col.active) {
          if (Math.abs(e * col.x + f * col.y + g) / h <= col.radius) {
            const r = sqrDist(a.x, a.y, b.x, b.y) + col.radius * col.radius
            if (sqrDist(a.x, a.y, col.x, col.y) <= r && sqrDist(b.x, b.y, col.x, col.y) <= r) {
              // Result := False; Break; — Result was already False on this path (the poly loop
              // above never set it True), so this is a no-op re-assignment in the original
              // Pascal; preserved faithfully rather than "fixed". See report for discussion.
              break
            }
          }
        }
      }
    }

    return { hit: false, distance }
  }
}

/* ****************************************************************************
 *                          Standalone free functions                        *
 **************************************************************************** */

// PolyMap.pas:717-749 CheckOutOfBounds (both overloads — Single/SmallInt collapse into one
// function, see file header note). Takes `polyMap` explicitly instead of reading the implicit
// Game.pas global `Map: TPolyMap`.
export function checkOutOfBounds(polyMap: PolyMap, x: number, y: number): CheckOutOfBoundsResult {
  let rx = x
  let ry = y

  const lowerBound = 10 * (-polyMap.sectorsNum * polyMap.sectorsDivision) + 50
  const upperBound = 10 * (polyMap.sectorsNum * polyMap.sectorsDivision) - 50

  if (rx < lowerBound) rx = 1
  else if (rx > upperBound) rx = 1

  if (ry < lowerBound) ry = 1
  else if (ry > upperBound) ry = 1

  return { x: rx, y: ry }
}
