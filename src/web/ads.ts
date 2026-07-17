// src/web/ads.ts — Verse8 Ads SDK 래퍼 (hexellent 검증 패턴 이식).
// index.html의 <script src=".../@verse8/ads@0.4.0/...">가 window.Verse8Ads를 노출한다.
// V8 외 환경(로컬 dev 등)에선 호출이 { status:'failed', error:{code:'unsupported_env'} }로
// 떨어지므로 — 인터스티셜은 조용히 통과, 리워드는 즉시 보상(개발 중 기능 검증 가능)으로 폴백.
// 어떤 경우에도 던지지 않는다: 광고 실패가 게임 흐름을 막으면 안 된다.

interface AdResult { status?: 'rewarded' | 'dismissed' | 'failed'; error?: { code?: string } }
interface Verse8AdsSdk {
  init?: (opts: { debug: boolean }) => void
  showInterstitial?: (opts: { placementId: string }) => Promise<AdResult>
  showRewarded?: (opts: { placementId: string }) => Promise<AdResult>
}
declare global { interface Window { Verse8Ads?: Verse8AdsSdk } }

let unsupportedEnv = false // 한 번 unsupported_env가 확정되면 세션 동안 SDK 호출 생략
let busy = false // 동시 광고 호출 방지

function sdk(): Verse8AdsSdk | null {
  if (unsupportedEnv || typeof window === 'undefined' || !window.Verse8Ads) return null
  return window.Verse8Ads
}

export function initAds(): void {
  try { window.Verse8Ads?.init?.({ debug: false }) } catch { /* SDK 없음 — 폴백 경로가 처리 */ }
}

// 인터스티셜 — 닫힐 때 resolve. 실패/미지원/중복호출이면 즉시 resolve(흐름 무정지).
export async function showInterstitial(placementId: string): Promise<void> {
  const ads = sdk()
  if (!ads?.showInterstitial || busy) return
  busy = true
  try {
    const r = await ads.showInterstitial({ placementId })
    if (r?.error?.code === 'unsupported_env') unsupportedEnv = true
  } catch { /* 무시 — 게임 계속 */ } finally { busy = false }
}

// 리워드 — 끝까지 시청 시 true. V8 외 환경에선 true(개발 중 보상 경로 검증용, hexellent 규약).
export async function showRewarded(placementId: string): Promise<boolean> {
  const ads = sdk()
  if (!ads?.showRewarded) return true // SDK 부재/미지원 = dev — 즉시 보상
  if (busy) return false
  busy = true
  try {
    const r = await ads.showRewarded({ placementId })
    if (r?.error?.code === 'unsupported_env') { unsupportedEnv = true; return true }
    return r?.status === 'rewarded'
  } catch { return false } finally { busy = false }
}

// 라운드 종료 감지기 — core nextMap()이 mapChangeCounter를 무장하는 순간(≤0 → >0 전이)에
// 1회 콜백. 메인 루프가 매 프레임 tick()을 부른다.
export function makeRoundEndWatcher(onRoundEnd: () => void): (mapChangeCounter: number) => void {
  let prev = 0
  return (mc: number) => {
    if (mc > 0 && prev <= 0) onRoundEnd()
    prev = mc
  }
}
