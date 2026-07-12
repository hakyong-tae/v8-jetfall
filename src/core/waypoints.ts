// 1:1 포팅: soldat-ref/soldat/shared/Waypoints.pas (61 lines)
// 봇 내비게이션 그래프. Waypoints.pas는 IFDEF가 없어 전체를 무조건 번역한다.
//
// 단일 출처: M1에서 mapfile.ts가 맵 파싱을 위해 TWaypoint/TWaypointAction/MAX_WAYPOINTS/
// MAX_CONNECTIONS를 로컬 정의했으나, Waypoints.pas가 이들의 원 소유자이므로 여기로 일원화하고
// mapfile.ts가 이 파일에서 import한다.

import { distance } from './calc'

// Waypoints.pas:14-15
export const MAX_WAYPOINTS = 5000
export const MAX_CONNECTIONS = 20

// Waypoints.pas:19 `{$scopedenums on} TWaypointAction = (None, StopAndCamp, Wait1Second, ...)`
export enum TWaypointAction {
  None = 0,
  StopAndCamp = 1,
  Wait1Second = 2,
  Wait5Seconds = 3,
  Wait10Seconds = 4,
  Wait15Seconds = 5,
  Wait20Seconds = 6,
}

// Waypoints.pas:20-29 TWaypoint record
export interface TWaypoint {
  active: boolean
  id: number
  x: number
  y: number
  left: boolean
  right: boolean
  up: boolean
  down: boolean
  jetpack: boolean
  pathNum: number
  action: TWaypointAction
  connectionsNum: number
  // Waypoints.pas:28 `array[1..MAX_CONNECTIONS] of Integer` — 1-based, index 0 unused.
  connections: number[]
}

// Pascal 고정 배열의 미사용 슬롯은 zero-init(Active=False, 모든 필드 0)이다. 이 포트는
// mapfile이 실제 로드한 개수(+1)만큼만 할당하므로, FindClosest / AI의 인덱스 접근이 로드
// 범위를 벗어나면 이 공유 zero 웨이포인트를 돌려준다 (Pascal이 5000짜리 배열에서 미사용
// 슬롯을 읽는 것과 동일한 값: Active=False, PathNum=0, Action=None, Connections 전부 0).
export function zeroWaypoint(): TWaypoint {
  return {
    active: false,
    id: 0,
    x: 0,
    y: 0,
    left: false,
    right: false,
    up: false,
    down: false,
    jetpack: false,
    pathNum: 0,
    action: TWaypointAction.None,
    connectionsNum: 0,
    connections: new Array(MAX_CONNECTIONS + 1).fill(0),
  }
}

const SHARED_ZERO: TWaypoint = zeroWaypoint()

// Waypoints.pas:31-35 TWaypoints object
export class TWaypoints {
  // 1-based: waypoint[0]은 더미(미사용), waypoint[1..count]가 유효. (원본은 [1..MAX_WAYPOINTS]
  // 고정 배열이지만 나머지가 전부 Active=False라 로드한 만큼만 할당해도 동작 동등.)
  waypoint: TWaypoint[] = [SHARED_ZERO]

  // 로드된 웨이포인트 개수 (1..count 유효).
  count = 0

  // AI가 인덱스를 직접 접근할 때 범위 밖이면 zero 웨이포인트를 돌려주는 안전 접근자
  // (Pascal 고정 배열의 미사용 슬롯 읽기와 동일 시맨틱).
  at(i: number): TWaypoint {
    if (i >= 1 && i <= this.count) return this.waypoint[i]
    return SHARED_ZERO
  }

  // Waypoints.pas:42-60 TWaypoints.FindClosest
  // 주의(리스크 지도 #5): "최근접"이 아니라 반경 내 "첫-매치"를 반환한다. 순서 개선 금지.
  findClosest(x: number, y: number, radius: number, currWaypoint: number): number {
    let result = 0

    // 원본은 1..MAX_WAYPOINTS 순회하지만 count 초과 슬롯은 전부 Active=False라 결과 동등.
    for (let i = 1; i <= this.count; i++) {
      if (this.waypoint[i].active && currWaypoint !== i) {
        const d = distance(x, y, this.waypoint[i].x, this.waypoint[i].y)
        if (d < radius) {
          result = i
          return result
        }
      }
    }

    return result
  }
}

// PolyMap.pas:158-159 (Initialize FillChar) + 236-255 (LoadData Move + OOB 비활성화).
// 원본은 BotPath가 Game.pas 전역이라 TPolyMap.LoadData가 직접 채운다. 이 포트에서 BotPath는
// gs.botPath이고 PolyMap은 gs를 참조하지 않으므로, 맵 로드 경로에서 이 브리지를 호출한다.
// MapFile.Waypoints[0..N-1] → BotPath.Waypoint[1..N] (1-based 시프트) 후, 좌표 절댓값이
// 2백만 이상인 웨이포인트를 비활성화한다 (PolyMap.pas:251-255).
export function loadWaypoints(bp: TWaypoints, waypoints: TWaypoint[]): void {
  const n = waypoints.length
  bp.count = n
  bp.waypoint = new Array(n + 1)
  bp.waypoint[0] = SHARED_ZERO
  for (let i = 1; i <= n; i++) {
    const src = waypoints[i - 1]
    // 깊은 복사 (record 값 복사 시맨틱 — connections 배열 포함)
    bp.waypoint[i] = {
      active: src.active,
      id: src.id,
      x: src.x,
      y: src.y,
      left: src.left,
      right: src.right,
      up: src.up,
      down: src.down,
      jetpack: src.jetpack,
      pathNum: src.pathNum,
      action: src.action,
      connectionsNum: src.connectionsNum,
      connections: src.connections.slice(),
    }
    if (Math.abs(bp.waypoint[i].x) >= 2000000 || Math.abs(bp.waypoint[i].y) >= 2000000) {
      bp.waypoint[i].active = false
    }
  }
}
