// src/net/session.ts — Session 전략 seam. 스펙 §3.1 모드③ + §9(피어권위=YAGNI)를 동시 만족.
// main.ts의 기존 배선은 갈아엎지 않는다(§자체리뷰) — 독립적 타입 계약으로만 존재하며, 피어모드로
// 실제 전환할 계획이 잡히면 그때 main.ts가 갈아탈 target 규약이 된다.
import type { GameState } from '../core/state'
import type { Transport } from './types'

export interface Session {
  readonly kind: 'host-authoritative' | 'peer'
  readonly gs: GameState
  tick(): void
  spriteNumOf(account: string): number | undefined
}

// 호스트권위 전략(M3-B~D 산출물, 무수정) 어댑터 — HostSession/ClientSession을 그대로 위임.
export class HostAuthoritativeSession implements Session {
  readonly kind = 'host-authoritative' as const
  constructor(private readonly inner: { tick(): void; gs: GameState; spriteNumOf?(account: string): number | undefined }) {}
  get gs() { return this.inner.gs }
  tick() { this.inner.tick() }
  spriteNumOf(account: string) { return this.inner.spriteNumOf?.(account) }
}

// 피어/피해자권한 전략 — 스펙 §9 "범위 밖"(YAGNI), seam만 확정. 아이디어(미구현): 각 클라가
// 자기 스프라이트만 권위 있게 시뮬(로컬입력 즉시반영), 피격 판정은 피해자 클라가 직접 확정해
// 데미지/사망 이벤트 브로드캐스트(원작 Soldat 논서버 모드와 동일 발상). 호스트권위가 릴레이
// 부하/레이턴시로 감당 안 될 때 이 전략으로 교체 — 그 시점에 tick()부터 채운다.
export class PeerSession implements Session {
  readonly kind = 'peer' as const
  constructor(private readonly transport: Transport, public readonly gs: GameState, private readonly myAccount: string) {
    void this.transport; void this.myAccount // seam 스텁 — 필드는 미래 구현이 소비할 자리(현재 미사용)
  }
  tick(): void { /* TODO(M4+, 스펙 §9): 로컬입력 즉시적용 + updateFrame 부분실행 + 피해자권한 데미지 확정 브로드캐스트. 의도적 no-op. */ }
  spriteNumOf(_account: string): number | undefined { return undefined } // 스텁 — 로컬스폰 로직 없음
}
