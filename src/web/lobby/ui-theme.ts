// src/web/lobby/ui-theme.ts — 프론트 화면 공유 테마 (스펙 §5).
// CSS 문자열 단일 소스: 다크 올리브/카키 그라디언트, 옐로(#f5d442) 하이라이트, 스텐실풍 타이틀,
// interface/cursor.png 커서, 팀버튼(Alpha 빨강/Bravo 파랑/Spectator 회색). 외부 리소스 0 —
// 폰트는 시스템 스택, 이미지는 전부 로컬 manifest 에셋(/assets/*)만 사용한다.
// ⚠️ interface/title-l·r(SOLDAT 로고)은 상표 — 절대 사용 금지. 타이틀은 텍스트 로고(brand.ts).

export const COLOR_YELLOW = '#f5d442'
export const COLOR_ALPHA = '#d23c3c'
export const COLOR_BRAVO = '#3c6cd2'

const FONT_STACK =
  `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`

const THEME_CSS = `
.jf-root {
  position: absolute; inset: 0; overflow: hidden;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 18px;
  background: linear-gradient(180deg, #14140e 0%, #1e1e14 55%, #16160f 100%);
  color: #e8e6d8;
  font-family: ${FONT_STACK};
  cursor: url('/assets/interface/cursor.png') 0 0, auto;
  user-select: none;
}
.jf-root * { cursor: inherit; }

/* 로컬 에셋 데코 — 저투명 scenery 실루엣 (외부 리소스 아님) */
.jf-deco {
  position: absolute; pointer-events: none; opacity: 0.07;
  image-rendering: pixelated;
}
.jf-vignette {
  position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%);
}

/* 스텐실풍 텍스트 로고 */
.jf-logo {
  font-weight: 900;
  font-size: clamp(44px, 9vw, 104px);
  letter-spacing: 0.16em;
  line-height: 1;
  color: ${COLOR_YELLOW};
  text-transform: uppercase;
  text-shadow:
    0 2px 0 #7a681a,
    0 4px 0 #3d3410,
    0 6px 14px rgba(0,0,0,0.85),
    0 0 34px rgba(245,212,66,0.28);
  margin: 0;
  z-index: 1;
}
.jf-logo-sm { font-size: clamp(22px, 3.4vw, 34px); }
.jf-tagline {
  letter-spacing: 0.42em; font-size: clamp(11px, 1.6vw, 16px); font-weight: 600;
  color: #b9b491; text-transform: uppercase; margin: 0; z-index: 1;
}
.jf-version { position: absolute; bottom: 12px; right: 16px; font-size: 11px; opacity: 0.45; letter-spacing: 0.1em; }

.jf-blink { animation: jf-blink 1.2s steps(2, start) infinite; letter-spacing: 0.3em; font-size: 15px; color: #d8d4b4; z-index: 1; }
@keyframes jf-blink { 50% { opacity: 0; } }

/* 세로 메뉴 */
.jf-menu { display: flex; flex-direction: column; align-items: stretch; gap: 6px; z-index: 1; }
.jf-menu-item {
  background: none; border: none; font-family: inherit;
  color: #d8d4b4; font-size: clamp(20px, 2.6vw, 28px); font-weight: 800;
  letter-spacing: 0.18em; text-transform: uppercase;
  padding: 8px 40px; position: relative; text-align: center;
  transition: color 0.08s, transform 0.08s;
}
.jf-menu-item::before {
  content: '\\25B8'; position: absolute; left: 8px; opacity: 0;
  color: ${COLOR_YELLOW}; transition: opacity 0.08s;
}
.jf-menu-item:hover, .jf-menu-item:focus-visible {
  color: ${COLOR_YELLOW}; transform: translateX(6px); outline: none;
}
.jf-menu-item:hover::before, .jf-menu-item:focus-visible::before { opacity: 1; }

/* 패널(설정/크레딧/로비/룸 공용 카드) */
.jf-panel {
  background: rgba(12, 12, 7, 0.78);
  border: 1px solid #3a3a24;
  border-top: 2px solid ${COLOR_YELLOW};
  box-shadow: 0 10px 40px rgba(0,0,0,0.6);
  padding: 26px 34px; min-width: min(420px, 88vw); max-width: 92vw;
  max-height: 82vh; overflow: auto;
  display: flex; flex-direction: column; gap: 14px; z-index: 1;
}
.jf-h {
  margin: 0 0 4px; font-size: 20px; font-weight: 900; letter-spacing: 0.24em;
  text-transform: uppercase; color: ${COLOR_YELLOW};
}

/* 범용 버튼 */
.jf-btn {
  background: #232315; border: 1px solid #4a4a2e; color: #e8e6d8;
  font-family: inherit; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
  font-size: 14px; padding: 9px 18px; transition: all 0.08s;
}
.jf-btn:hover, .jf-btn:focus-visible { border-color: ${COLOR_YELLOW}; color: ${COLOR_YELLOW}; outline: none; }
/* 선택 상태 — 방 설정(무기 토글/리스폰/목표킬/시간제한) 버튼이 이 클래스를 쓴다. 팀/맵/무기창
   전용 규칙만 있고 범용 규칙이 빠져 있어 "선택해도 표시가 안 되던" 버그의 원인이었음. */
.jf-btn.jf-on { background: ${COLOR_YELLOW}; color: #14140e; border-color: ${COLOR_YELLOW}; }
.jf-btn.jf-on:disabled { opacity: 0.75; } /* 비방장에게도 현재 선택은 또렷하게 */
.jf-btn:disabled { opacity: 0.4; }
.jf-btn-primary { background: #3d3410; border-color: ${COLOR_YELLOW}; color: ${COLOR_YELLOW}; }
.jf-btn-primary:hover { background: ${COLOR_YELLOW}; color: #14140e; }

/* 팀 버튼 */
.jf-btn-alpha { border-color: ${COLOR_ALPHA}; color: ${COLOR_ALPHA}; }
.jf-btn-alpha:hover, .jf-btn-alpha.jf-on { background: ${COLOR_ALPHA}; color: #fff; border-color: ${COLOR_ALPHA}; }
.jf-btn-bravo { border-color: ${COLOR_BRAVO}; color: ${COLOR_BRAVO}; }
.jf-btn-bravo:hover, .jf-btn-bravo.jf-on { background: ${COLOR_BRAVO}; color: #fff; border-color: ${COLOR_BRAVO}; }
.jf-btn-spec { border-color: #8a8a7a; color: #a8a898; }
.jf-btn-spec:hover, .jf-btn-spec.jf-on { background: #8a8a7a; color: #14140e; border-color: #8a8a7a; }

/* 입력/슬라이더/테이블 */
.jf-input {
  background: #101008; border: 1px solid #4a4a2e; color: #e8e6d8;
  font-family: inherit; font-size: 15px; padding: 8px 10px; letter-spacing: 0.05em;
}
.jf-input:focus { border-color: ${COLOR_YELLOW}; outline: none; }
.jf-row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.jf-label { font-size: 13px; letter-spacing: 0.14em; text-transform: uppercase; color: #b9b491; min-width: 110px; }
.jf-slider { flex: 1; accent-color: ${COLOR_YELLOW}; min-width: 140px; }
.jf-value { min-width: 34px; text-align: right; font-variant-numeric: tabular-nums; color: ${COLOR_YELLOW}; font-weight: 700; }
.jf-check { accent-color: ${COLOR_YELLOW}; width: 17px; height: 17px; }

.jf-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.jf-table th {
  text-align: left; padding: 6px 10px; letter-spacing: 0.14em; text-transform: uppercase;
  font-size: 11px; color: #b9b491; border-bottom: 1px solid #3a3a24;
}
.jf-table td { padding: 6px 10px; border-bottom: 1px solid #26261a; }
.jf-table tr.jf-click:hover td { background: rgba(245,212,66,0.08); color: ${COLOR_YELLOW}; }
.jf-key {
  display: inline-block; min-width: 26px; text-align: center; padding: 2px 7px;
  background: #232315; border: 1px solid #4a4a2e; border-bottom-width: 3px;
  font-size: 12px; font-weight: 700; color: ${COLOR_YELLOW};
}
.jf-muted { opacity: 0.55; font-size: 12px; }

/* 토스트 */
.jf-toast {
  position: fixed; left: 50%; bottom: 42px; transform: translateX(-50%);
  background: rgba(20, 20, 12, 0.95); border: 1px solid ${COLOR_YELLOW}; color: ${COLOR_YELLOW};
  font-family: ${FONT_STACK}; font-size: 14px; font-weight: 600; letter-spacing: 0.06em;
  padding: 11px 22px; z-index: 1000; pointer-events: none;
  animation: jf-toast 3s forwards;
}
@keyframes jf-toast {
  0% { opacity: 0; transform: translate(-50%, 8px); }
  8% { opacity: 1; transform: translate(-50%, 0); }
  85% { opacity: 1; }
  100% { opacity: 0; }
}

/* 인게임 ESC 오버레이 */
.jf-overlay {
  position: fixed; inset: 0; z-index: 900;
  display: flex; align-items: center; justify-content: center;
  background: rgba(8, 8, 4, 0.72);
  font-family: ${FONT_STACK}; color: #e8e6d8;
  cursor: url('/assets/interface/cursor.png') 0 0, auto;
  user-select: none;
}

/* 봇전 로비 — 맵 리스트(스크롤 가능) */
.jf-maplist-scroll {
  display: flex; flex-direction: column; gap: 4px;
  max-height: 220px; overflow-y: auto; padding-right: 4px;
}
.jf-maplist-item {
  text-align: left; text-transform: none; letter-spacing: 0.02em;
  font-size: 13px; padding: 6px 12px;
}
.jf-maplist-item.jf-on { background: ${COLOR_YELLOW}; color: #14140e; border-color: ${COLOR_YELLOW}; }

/* 인게임 무기선택(림보) 메뉴 — 화면 중앙 하단 오버레이 */
.jf-loadout-overlay {
  position: fixed; left: 50%; bottom: 90px; transform: translateX(-50%);
  z-index: 800;
  font-family: ${FONT_STACK}; color: #e8e6d8;
  cursor: url('/assets/interface/cursor.png') 0 0, auto;
  user-select: none;
}
.jf-loadout-overlay * { cursor: inherit; }
.jf-loadout-panel {
  display: flex; gap: 18px;
  background: rgba(12, 12, 7, 0.85); border: 1px solid #3a3a24; border-top: 2px solid ${COLOR_YELLOW};
  padding: 14px 18px; box-shadow: 0 10px 40px rgba(0,0,0,0.6);
}
.jf-loadout-col { display: flex; flex-direction: column; gap: 6px; min-width: 170px; }
.jf-loadout-list { display: flex; flex-direction: column; gap: 4px; max-height: 260px; overflow-y: auto; }
.jf-loadout-item {
  display: flex; align-items: center; gap: 8px; text-align: left;
  text-transform: none; letter-spacing: 0.02em; font-size: 13px; padding: 6px 10px;
}
.jf-loadout-item.jf-on { background: ${COLOR_YELLOW}; color: #14140e; border-color: ${COLOR_YELLOW}; }
.jf-loadout-icon { width: 30px; height: 20px; object-fit: contain; image-rendering: pixelated; flex: none; }
`

// 테마 <style>을 document.head에 1회 주입 (중복 호출 안전).
export function injectTheme(doc: Document = document): void {
  if (doc.getElementById('jf-theme')) return
  const style = doc.createElement('style')
  style.id = 'jf-theme'
  style.textContent = THEME_CSS
  doc.head.appendChild(style)
}

// 3초 자동 소멸 토스트 (에러/안내 공용).
export function showToast(msg: string, doc: Document = document): void {
  const el = doc.createElement('div')
  el.className = 'jf-toast'
  el.textContent = msg
  doc.body.appendChild(el)
  setTimeout(() => el.remove(), 3100)
}
