// src/web/lobby/lobby-ui.ts — 게임 프론트 화면 상태머신 (M4-A).
// 화면: title → menu → (settings | credits | offline모드선택 | lobby → room → 인게임).
// 로직 계층(LobbyClient/net/*)은 무수정 — 이 파일은 DOM 렌더만 담당한다(스펙 §3, §7).
import { LobbyClient } from '../../net/lobby-client'
import { LoopbackHub } from '../../net/loopback'
import { makeAgent8Transport, realProvider } from '../../net/transport'
import type { Transport } from '../../net/types'
import {
  GAMESTYLE_DEATHMATCH, GAMESTYLE_CTF,
  TEAM_ALPHA, TEAM_BRAVO, TEAM_SPECTATOR, TEAM_NONE,
} from '../../core/constants'
import { GAME_TITLE, GAME_TAGLINE, GAME_VERSION, CREDITS_LINES } from '../brand'
import { loadSettings, saveSettings, type GameSettings } from '../settings'
import { injectTheme, showToast } from './ui-theme'

export interface StartMatchArg { lobby: LobbyClient; mode: number; myTeam: number }

export interface LobbyOpts {
  onStartMatch: (a: StartMatchArg) => void
  onOfflineBots: (mode: 'dm' | 'ctf') => void
  onSettingsChange?: (s: GameSettings) => void
}

// loopback=true면 배포 없이 단일 브라우저에서 목 릴레이 사용 (개발/데모).
export async function makeTransport(loopback: boolean): Promise<Transport> {
  if (loopback) return new LoopbackHub().createTransport('me-' + Math.floor(performance.now()))
  return makeAgent8Transport(await realProvider())
}

// ── 조작키 표 (읽기전용 — input.ts 기본 바인딩과 동일. 리바인딩은 후속)
const CONTROLS: [string, string][] = [
  ['A / D', '좌우 이동'],
  ['W', '점프'],
  ['S', '숙이기'],
  ['X', '엎드리기'],
  ['좌클릭', '발사'],
  ['우클릭', '제트팩'],
  ['R', '재장전'],
  ['Q', '무기 교체'],
  ['E', '수류탄'],
  ['F', '무기 버리기'],
  ['Space', '깃발 던지기'],
  ['ESC', '메뉴 (인게임)'],
]

// ── 설정 패널 빌더 — 설정 화면과 인게임 ESC 오버레이가 공유 (plan Task4).
// 변경 즉시 saveSettings + onChange 콜백. 반환 엘리먼트를 원하는 컨테이너에 붙이면 된다.
export function buildSettingsPanel(onChange?: (s: GameSettings) => void): HTMLElement {
  const s = loadSettings()
  const panel = document.createElement('div')
  panel.style.display = 'flex'
  panel.style.flexDirection = 'column'
  panel.style.gap = '14px'
  panel.innerHTML = `
    <div class="jf-row">
      <span class="jf-label">SFX Volume</span>
      <input class="jf-slider" id="jf-vol" type="range" min="0" max="100" step="1" value="${s.sfxVolume}" />
      <span class="jf-value" id="jf-vol-val">${s.sfxVolume}</span>
    </div>
    <div class="jf-row">
      <span class="jf-label">Mute</span>
      <input class="jf-check" id="jf-mute" type="checkbox" ${s.muted ? 'checked' : ''} />
    </div>
    <div>
      <div class="jf-label" style="margin-bottom:8px">Controls</div>
      <table class="jf-table">
        <tbody>
          ${CONTROLS.map(([k, desc]) => `<tr><td><span class="jf-key">${k}</span></td><td>${desc}</td></tr>`).join('')}
        </tbody>
      </table>
      <div class="jf-muted" style="margin-top:6px">키 변경은 추후 지원 예정</div>
    </div>`
  const vol = panel.querySelector('#jf-vol') as HTMLInputElement
  const volVal = panel.querySelector('#jf-vol-val') as HTMLElement
  const mute = panel.querySelector('#jf-mute') as HTMLInputElement
  const commit = (): void => {
    const next: GameSettings = { sfxVolume: Number(vol.value), muted: mute.checked }
    volVal.textContent = vol.value
    saveSettings(next)
    onChange?.(next)
  }
  vol.addEventListener('input', commit)
  mute.addEventListener('change', commit)
  return panel
}

// ─────────────────────────────────────────────────────────────────────────────

type ScreenName = 'title' | 'menu' | 'settings' | 'credits' | 'offline' | 'lobby' | 'room'

interface Ctx {
  root: HTMLElement
  opts: LobbyOpts
  lc: LobbyClient | null
  cleanup: (() => void)[] // 화면 전환 시 해제할 리스너/타이머
}

export function mountLobby(root: HTMLElement, opts: LobbyOpts): void {
  injectTheme()
  const ctx: Ctx = { root, opts, lc: null, cleanup: [] }
  show(ctx, 'title')
}

// 인게임으로 핸드오프하기 전 화면 리스너/타이머 해제 — 안 하면 stale ESC 리스너가
// 인게임 중 메뉴를 캔버스 위에 다시 그리는 버그가 난다(M4-A 검증에서 실제 발생).
function handoff(ctx: Ctx): void {
  for (const fn of ctx.cleanup.splice(0)) fn()
}

function show(ctx: Ctx, name: ScreenName): void {
  for (const fn of ctx.cleanup.splice(0)) fn()
  ctx.root.innerHTML = ''
  const scr = document.createElement('div')
  scr.className = 'jf-root'
  scr.dataset.screen = name
  ctx.root.appendChild(scr)
  addDecor(scr)
  switch (name) {
    case 'title': return renderTitle(ctx, scr)
    case 'menu': return renderMenu(ctx, scr)
    case 'settings': return renderSettings(ctx, scr)
    case 'credits': return renderCredits(ctx, scr)
    case 'offline': return renderOfflinePick(ctx, scr)
    case 'lobby': return renderLobby(ctx, scr)
    case 'room': return renderRoom(ctx, scr)
  }
}

// 로컬 scenery 에셋 저투명 데코 + 비네트 (외부 리소스 0).
function addDecor(scr: HTMLElement): void {
  const mk = (src: string, style: Partial<CSSStyleDeclaration>): void => {
    const img = document.createElement('img')
    img.className = 'jf-deco'
    img.src = src
    img.alt = ''
    Object.assign(img.style, style)
    scr.appendChild(img)
  }
  mk('/assets/scenery/0001.png', { left: '-40px', bottom: '-30px', width: '38vw', transform: 'scaleX(-1)' })
  mk('/assets/scenery/0007.png', { right: '-30px', top: '8vh', width: '30vw' })
  const vig = document.createElement('div')
  vig.className = 'jf-vignette'
  scr.appendChild(vig)
}

function el(tag: string, cls: string, html?: string): HTMLElement {
  const e = document.createElement(tag)
  e.className = cls
  if (html !== undefined) e.innerHTML = html
  return e
}

function versionTag(scr: HTMLElement): void {
  scr.appendChild(el('div', 'jf-version', `${GAME_TITLE} ${GAME_VERSION}`))
}

// ── title ────────────────────────────────────────────────────────────────────
function renderTitle(ctx: Ctx, scr: HTMLElement): void {
  scr.appendChild(el('h1', 'jf-logo', GAME_TITLE))
  scr.appendChild(el('p', 'jf-tagline', GAME_TAGLINE))
  scr.appendChild(el('p', 'jf-blink', 'PRESS ANY KEY'))
  versionTag(scr)
  const go = (): void => show(ctx, 'menu')
  const onKey = (e: KeyboardEvent): void => { e.preventDefault(); go() }
  window.addEventListener('keydown', onKey, { once: true })
  scr.addEventListener('pointerdown', go, { once: true })
  ctx.cleanup.push(() => window.removeEventListener('keydown', onKey))
}

// ── menu ─────────────────────────────────────────────────────────────────────
function menuList(items: [string, () => void][]): HTMLElement {
  const nav = el('nav', 'jf-menu')
  for (const [label, fn] of items) {
    const b = el('button', 'jf-menu-item', label) as HTMLButtonElement
    b.addEventListener('click', fn)
    nav.appendChild(b)
  }
  return nav
}

function renderMenu(ctx: Ctx, scr: HTMLElement): void {
  scr.appendChild(el('h1', 'jf-logo jf-logo-sm', GAME_TITLE))
  scr.appendChild(menuList([
    ['Play Online', () => void goOnline(ctx)],
    ['Offline Bots', () => show(ctx, 'offline')],
    ['Settings', () => show(ctx, 'settings')],
    ['Credits', () => show(ctx, 'credits')],
  ]))
  versionTag(scr)
  ;(scr.querySelector('.jf-menu-item') as HTMLElement | null)?.focus()
}

// PLAY ONLINE — 접속 성공시 lobby 화면, 실패(미배포)시 토스트 + 메뉴 유지.
async function goOnline(ctx: Ctx): Promise<void> {
  showToast('서버 접속 중…')
  try {
    if (!ctx.lc) {
      const transport = await makeTransport(false)
      ctx.lc = new LobbyClient(transport, 'Soldier')
    }
    const st = await ctx.lc.connect()
    if (st !== 'online') {
      ctx.lc = null
      showToast('서버 미배포 — 오프라인 봇전을 이용하세요')
      return
    }
    show(ctx, 'lobby')
  } catch {
    ctx.lc = null
    showToast('서버 미배포 — 오프라인 봇전을 이용하세요')
  }
}

// ── offline 모드 선택 소메뉴 ─────────────────────────────────────────────────
function renderOfflinePick(ctx: Ctx, scr: HTMLElement): void {
  scr.appendChild(el('h1', 'jf-logo jf-logo-sm', GAME_TITLE))
  scr.appendChild(el('p', 'jf-tagline', 'OFFLINE BOTS'))
  scr.appendChild(menuList([
    ['Deathmatch', () => { handoff(ctx); ctx.opts.onOfflineBots('dm') }],
    ['Capture the Flag', () => { handoff(ctx); ctx.opts.onOfflineBots('ctf') }],
    ['Back', () => show(ctx, 'menu')],
  ]))
  versionTag(scr)
  escBack(ctx, 'menu')
}

// ── settings ─────────────────────────────────────────────────────────────────
function renderSettings(ctx: Ctx, scr: HTMLElement): void {
  const panel = el('div', 'jf-panel')
  panel.appendChild(el('h2', 'jf-h', 'Settings'))
  panel.appendChild(buildSettingsPanel(ctx.opts.onSettingsChange))
  panel.appendChild(backBtn(ctx, 'menu'))
  scr.appendChild(panel)
  versionTag(scr)
  escBack(ctx, 'menu')
}

// ── credits ──────────────────────────────────────────────────────────────────
function renderCredits(ctx: Ctx, scr: HTMLElement): void {
  const panel = el('div', 'jf-panel')
  panel.appendChild(el('h2', 'jf-h', 'Credits'))
  panel.appendChild(el('div', 'jf-logo jf-logo-sm', GAME_TITLE))
  const list = el('div', '')
  list.style.display = 'flex'
  list.style.flexDirection = 'column'
  list.style.gap = '6px'
  for (const line of CREDITS_LINES) {
    const p = el('p', '', line)
    p.style.margin = '0'
    p.style.fontSize = '14px'
    list.appendChild(p)
  }
  panel.appendChild(list)
  panel.appendChild(backBtn(ctx, 'menu'))
  scr.appendChild(panel)
  versionTag(scr)
  escBack(ctx, 'menu')
}

function backBtn(ctx: Ctx, to: ScreenName): HTMLElement {
  const b = el('button', 'jf-btn', 'Back') as HTMLButtonElement
  b.style.alignSelf = 'flex-start'
  b.addEventListener('click', () => show(ctx, to))
  return b
}

// ESC로 뒤로가기 (메뉴 하위 화면 공통 — 키보드 사용성).
function escBack(ctx: Ctx, to: ScreenName): void {
  const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') show(ctx, to) }
  window.addEventListener('keydown', onKey)
  ctx.cleanup.push(() => window.removeEventListener('keydown', onKey))
}

// ── lobby (룸 목록/빠른입장/방만들기/닉네임) ─────────────────────────────────
function renderLobby(ctx: Ctx, scr: HTMLElement): void {
  const lc = ctx.lc
  if (!lc) return show(ctx, 'menu')
  const panel = el('div', 'jf-panel')
  panel.style.minWidth = 'min(560px, 92vw)'
  panel.innerHTML = `
    <h2 class="jf-h">Online Lobby</h2>
    <div class="jf-row">
      <span class="jf-label">Nickname</span>
      <input class="jf-input" id="jf-nick" maxlength="14" value="${lc.nick}" />
    </div>
    <table class="jf-table">
      <thead><tr><th>Room</th><th>Mode</th><th>Players</th><th></th></tr></thead>
      <tbody id="jf-rooms"><tr><td colspan="4" class="jf-muted">불러오는 중…</td></tr></tbody>
    </table>
    <div class="jf-row">
      <button class="jf-btn jf-btn-primary" id="jf-quick">Quick Join</button>
      <button class="jf-btn" id="jf-create-dm">Create DM</button>
      <button class="jf-btn" id="jf-create-ctf">Create CTF</button>
      <button class="jf-btn" id="jf-back">Back</button>
    </div>`
  scr.appendChild(panel)
  versionTag(scr)

  const nickInput = panel.querySelector('#jf-nick') as HTMLInputElement
  nickInput.addEventListener('input', () => { lc.nick = nickInput.value.trim() || 'Soldier' })

  const tbody = panel.querySelector('#jf-rooms') as HTMLElement
  let rooms: { key: string; count: number; mode: number; started: boolean }[] = []
  const drawRooms = (): void => {
    if (rooms.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="jf-muted">열린 방 없음 — 방을 만들어 보세요</td></tr>'
      return
    }
    tbody.innerHTML = rooms.map((r, i) => `
      <tr class="jf-click" data-i="${i}">
        <td>${r.key}</td>
        <td>${r.mode === GAMESTYLE_CTF ? 'CTF' : 'DM'}</td>
        <td>${r.count}</td>
        <td>${r.started ? '<span class="jf-muted">진행중</span>' : '<button class="jf-btn" data-join="' + r.key + '">Join</button>'}</td>
      </tr>`).join('')
    tbody.querySelectorAll('[data-join]').forEach((b) =>
      b.addEventListener('click', () => void enterRoom(ctx, (b as HTMLElement).dataset.join!)))
  }
  const refresh = async (): Promise<void> => {
    try { rooms = await lc.listRooms(); drawRooms() } catch { /* 목록 실패는 다음 주기 재시도 */ }
  }
  void refresh()
  const timer = window.setInterval(() => void refresh(), 3000) // 3s 주기 갱신 (plan Task3)
  ctx.cleanup.push(() => window.clearInterval(timer))

  panel.querySelector('#jf-quick')!.addEventListener('click', () => {
    const open = rooms.find((r) => !r.started)
    void enterRoom(ctx, open ? open.key : 'dm-' + Date.now(), open ? undefined : GAMESTYLE_DEATHMATCH)
  })
  panel.querySelector('#jf-create-dm')!.addEventListener('click', () =>
    void enterRoom(ctx, 'dm-' + Date.now(), GAMESTYLE_DEATHMATCH))
  panel.querySelector('#jf-create-ctf')!.addEventListener('click', () =>
    void enterRoom(ctx, 'ctf-' + Date.now(), GAMESTYLE_CTF))
  panel.querySelector('#jf-back')!.addEventListener('click', () => show(ctx, 'menu'))
  escBack(ctx, 'menu')
}

// createMode가 주어지면 새 방 생성, 아니면 기존 방 참가 → room 화면.
async function enterRoom(ctx: Ctx, key: string, createMode?: number): Promise<void> {
  const lc = ctx.lc
  if (!lc) return
  try {
    if (createMode !== undefined) await lc.createRoom(key, createMode)
    else await lc.joinRoom(key)
    show(ctx, 'room')
  } catch {
    showToast('방 입장 실패 — 다시 시도하세요')
  }
}

// ── room (참가자/팀/Ready/START) ─────────────────────────────────────────────
function renderRoom(ctx: Ctx, scr: HTMLElement): void {
  const lc = ctx.lc
  if (!lc) return show(ctx, 'menu')
  const panel = el('div', 'jf-panel')
  panel.style.minWidth = 'min(560px, 92vw)'
  scr.appendChild(panel)
  versionTag(scr)

  const teamName = (t: number): string =>
    t === TEAM_ALPHA ? '<span style="color:#d23c3c;font-weight:700">Alpha</span>'
    : t === TEAM_BRAVO ? '<span style="color:#3c6cd2;font-weight:700">Bravo</span>'
    : t === TEAM_SPECTATOR ? '<span class="jf-muted">Spectator</span>' : '—'

  const draw = (): void => {
    const isCtf = lc.roomState.mode === GAMESTYLE_CTF
    const players = lc.players
    const me = players[lc.account]
    const teamBtns = isCtf ? `
      <div class="jf-row">
        <span class="jf-label">Team</span>
        <button class="jf-btn jf-btn-alpha ${me?.team === TEAM_ALPHA ? 'jf-on' : ''}" data-team="${TEAM_ALPHA}">Alpha</button>
        <button class="jf-btn jf-btn-bravo ${me?.team === TEAM_BRAVO ? 'jf-on' : ''}" data-team="${TEAM_BRAVO}">Bravo</button>
        <button class="jf-btn jf-btn-spec ${me?.team === TEAM_SPECTATOR ? 'jf-on' : ''}" data-team="${TEAM_SPECTATOR}">Spectator</button>
      </div>` : ''
    panel.innerHTML = `
      <h2 class="jf-h">Room — ${isCtf ? 'Capture the Flag' : 'Deathmatch'}</h2>
      <table class="jf-table">
        <thead><tr><th>Player</th>${isCtf ? '<th>Team</th>' : ''}<th>Ready</th></tr></thead>
        <tbody>
          ${Object.entries(players).map(([acc, p]) => `
            <tr>
              <td>${p.nick}${acc === lc.account ? ' <span class="jf-muted">(you)</span>' : ''}${acc === lc.roomState.hostAccount ? ' <span style="color:#f5d442">★host</span>' : ''}</td>
              ${isCtf ? `<td>${teamName(p.team)}</td>` : ''}
              <td>${p.ready ? '<span style="color:#f5d442">✓</span>' : '<span class="jf-muted">…</span>'}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      ${teamBtns}
      <div class="jf-row">
        <button class="jf-btn ${me?.ready ? 'jf-btn-primary' : ''}" id="jf-ready">${me?.ready ? 'Ready ✓' : 'Ready'}</button>
        ${lc.isHost
          ? '<button class="jf-btn jf-btn-primary" id="jf-start">Start Match</button>'
          : '<span class="jf-muted">호스트 시작 대기 중…</span>'}
        <button class="jf-btn" id="jf-leave">Leave</button>
      </div>`
    panel.querySelectorAll('[data-team]').forEach((b) =>
      b.addEventListener('click', () => void lc.selectTeam(Number((b as HTMLElement).dataset.team))))
    panel.querySelector('#jf-ready')!.addEventListener('click', () => void lc.setReady(!(me?.ready ?? false)))
    panel.querySelector('#jf-start')?.addEventListener('click', () => void lc.start().catch(() => showToast('시작 실패')))
    panel.querySelector('#jf-leave')!.addEventListener('click', () => {
      void lc.leave().catch(() => undefined)
      show(ctx, 'lobby')
    })
  }
  lc.onChange(draw)
  lc.onStart(() => {
    const myTeam = lc.players[lc.account]?.team ?? TEAM_NONE
    handoff(ctx)
    ctx.opts.onStartMatch({ lobby: lc, mode: lc.roomState.mode, myTeam })
  })
  ctx.cleanup.push(() => { lc.onChange(() => {}); lc.onStart(() => {}) })
  draw()
}
