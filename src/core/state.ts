// Pascal 전역변수 컨테이너 — 원본의 유닛 전역들을 한 곳에 모은다.
// 모듈이 포팅될 때마다 필드가 추가된다 (흩어진 모듈 전역 금지: 서버/클라 시뮬 다중 인스턴스 지원 목적).
export interface GameState {
  ticks: number
}

export function createGameState(): GameState {
  return { ticks: 0 }
}
