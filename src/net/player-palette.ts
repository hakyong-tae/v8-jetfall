// src/net/player-palette.ts — 멀티플레이 플레이어 구분용 색상 팔레트.
// 스프라이트 num으로 결정적으로 유도 → 호스트/모든 클라가 같은 색을 각자 계산(동기화 불필요:
// 호스트 spawnOne과 클라 ensureLocalSprite가 같은 num에 같은 팔레트를 적용한다).
// CTF에선 렌더러(gostek.ts)가 셔츠를 팀색으로 강제하므로 바지/머리 차이만 남는다 — 의도.

export interface PlayerColors { shirt: number; pants: number; hair: number }

// 8종 — 어두운 맵 배경 위 가독성 위주로 명도 확보, 팀색(빨/파)과 겹치지 않게 순수 원색 지양.
const PALETTE: PlayerColors[] = [
  { shirt: 0x33ccff, pants: 0x2a4a5e, hair: 0x2b2b2b }, // 시안
  { shirt: 0xffb347, pants: 0x5e452a, hair: 0x3d2b1f }, // 주황
  { shirt: 0x7ddc5f, pants: 0x2f4d2a, hair: 0x1f1f1f }, // 라임
  { shirt: 0xda70d6, pants: 0x4a2a5e, hair: 0x2b1f3d }, // 오키드
  { shirt: 0xf5d442, pants: 0x5e552a, hair: 0x3d331f }, // 옐로
  { shirt: 0xff6f61, pants: 0x5e2a2a, hair: 0x1f1f1f }, // 코럴
  { shirt: 0x9fd8ff, pants: 0x2a3a5e, hair: 0x4d4d4d }, // 아이스
  { shirt: 0xc0f060, pants: 0x3a4d2a, hair: 0x2b2b2b }, // 스프링
]

export function playerColors(num: number): PlayerColors {
  const i = ((num - 1) % PALETTE.length + PALETTE.length) % PALETTE.length
  return PALETTE[i]
}

// TPlayer 모양(부분)에 팔레트 적용 — 호스트/클라 스폰 경로 공용 헬퍼.
export function applyPlayerColors(player: { shirtColor: number; pantsColor: number; hairColor: number }, num: number): void {
  const c = playerColors(num)
  player.shirtColor = c.shirt
  player.pantsColor = c.pants
  player.hairColor = c.hair
}
