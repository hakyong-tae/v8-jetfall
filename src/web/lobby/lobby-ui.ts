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
// M8: 방 설정 패널 — 무기명 표시(고유명사, i18n 비대상)용 guns + 그룹 경계 상수.
// createWeaponsBase()는 로비 컨텍스트(매치 시작 전, loadGameAssets 미경유)에서 무기명을 채운다.
import { guns, createWeaponsBase, EAGLE, PRIMARY_WEAPONS, MAIN_WEAPONS } from '../../core/weapons'
import { mergeRoomSettings, canDisableWeapon } from '../../net/room-settings'
// M9: 난입(drop-in) 순수 헬퍼 — 정원 게이트 + CTF 자동 팀배정(테스트 공유용 별도 모듈).
import { canJoinRoom, pickAutoTeam } from '../../net/dropin'
import { GAME_TITLE, GAME_VERSION, CREDITS_LINES } from '../brand'
import { loadSettings, saveSettings, type GameSettings } from '../settings'
import { loadManifest } from '../assets'
import { injectTheme, showToast } from './ui-theme'
import { t, LANGS, getLang, setLang } from '../i18n'

export interface StartMatchArg { lobby: LobbyClient; mode: number; myTeam: number }

export interface LobbyOpts {
  onStartMatch: (a: StartMatchArg) => void
  // mapKey 생략(undefined) = Random(모드에 맞는 후보 중 시드 없는 선택은 main.ts 담당). §M5 Task1
  // respawnSeconds: M7 — 매치별 리스폰 대기시간(초). 생략 시 코어 기본(6s) 유지.
  onOfflineBots: (mode: 'dm' | 'ctf', mapKey?: string, respawnSeconds?: number) => void
  onSettingsChange?: (s: GameSettings) => void
}

// ── M5: 봇전 맵 선택 — manifest.maps 99종을 접두사로 필터(grep 실측: ctf_ 34 / htf_ 19 /
// inf_ 17 / 무접두 29). CTF=ctf_ 전용, DM=무접두(htf_/inf_ 제외, INF/HTF 미지원 스코프 §배경).
// 모듈 스코프 캐시 — 화면 재방문마다 재요청하지 않게(오프라인 소메뉴 왕복이 잦음).
let mapKeysCache: { dm: string[]; ctf: string[] } | null = null
async function loadMapKeys(): Promise<{ dm: string[]; ctf: string[] }> {
  if (mapKeysCache) return mapKeysCache
  const manifest = await loadManifest()
  const keys = Object.keys(manifest.maps)
  mapKeysCache = {
    ctf: keys.filter((k) => k.startsWith('ctf_')).sort(),
    dm: keys.filter((k) => !k.startsWith('ctf_') && !k.startsWith('htf_') && !k.startsWith('inf_')).sort(),
  }
  return mapKeysCache
}

const LAST_MAP_KEY = 'jetfall.lastmap.v1'
function loadLastMap(): string {
  try { return localStorage.getItem(LAST_MAP_KEY) ?? 'random' } catch { return 'random' }
}
function saveLastMap(v: string): void {
  try { localStorage.setItem(LAST_MAP_KEY, v) } catch { /* 스토리지 불가 — 세션 한정 동작 */ }
}

// M7: 리스폰 대기시간(초) 프리셋. 0/2/4/6(기본)/8/10. localStorage 영속.
const RESPAWN_KEY = 'jetfall.respawn.v1'
const RESPAWN_OPTIONS = [0, 2, 4, 6, 8, 10]
const DEFAULT_RESPAWN = 6
function loadLastRespawn(): number {
  try {
    const raw = localStorage.getItem(RESPAWN_KEY)
    if (raw == null) return DEFAULT_RESPAWN
    const n = Number(raw)
    return Number.isFinite(n) && RESPAWN_OPTIONS.includes(n) ? n : DEFAULT_RESPAWN
  } catch { return DEFAULT_RESPAWN }
}
function saveLastRespawn(v: number): void {
  try { localStorage.setItem(RESPAWN_KEY, String(v)) } catch { /* 스토리지 불가 — 세션 한정 동작 */ }
}

// loopback=true면 배포 없이 단일 브라우저에서 목 릴레이 사용 (개발/데모).
// M9: 허브를 __soldatHub로 노출 — 단일 페이지 seam에서 진행중 방 목록/난입 동선을 콘솔로
// 연출·검증하기 위한 개발 핸들(__soldat/__soldatNet과 동일 규약, loopback 한정).
export async function makeTransport(loopback: boolean): Promise<Transport> {
  if (loopback) {
    const hub = new LoopbackHub()
    ;(window as unknown as Record<string, unknown>).__soldatHub = hub
    return hub.createTransport('me-' + Math.floor(performance.now()))
  }
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
// 언어 변경 시 자기 자신을 재렌더해 라벨이 즉시 반영된다(설정화면·ESC 오버레이 공용).
// onLangChange가 주어지면(설정 화면) 화면 전체(제목 포함)를 다시 그리게 위임하고, 없으면(ESC 슬롯)
// 패널만 자체 재렌더한다.
export function buildSettingsPanel(
  onChange?: (s: GameSettings) => void,
  onLangChange?: () => void,
): HTMLElement {
  const panel = document.createElement('div')
  panel.style.display = 'flex'
  panel.style.flexDirection = 'column'
  panel.style.gap = '14px'
  const render = (): void => {
    const s = loadSettings()
    const langOptions = LANGS.map(
      (l) => `<option value="${l.code}" ${l.code === getLang() ? 'selected' : ''}>${l.label}</option>`,
    ).join('')
    panel.innerHTML = `
      <div class="jf-row">
        <span class="jf-label">${t('settings.sfxVolume')}</span>
        <input class="jf-slider" id="jf-vol" type="range" min="0" max="100" step="1" value="${s.sfxVolume}" />
        <span class="jf-value" id="jf-vol-val">${s.sfxVolume}</span>
      </div>
      <div class="jf-row">
        <span class="jf-label">${t('settings.mute')}</span>
        <input class="jf-check" id="jf-mute" type="checkbox" ${s.muted ? 'checked' : ''} />
      </div>
      <div class="jf-row">
        <span class="jf-label">${t('settings.highlightMyGun')}</span>
        <input class="jf-check" id="jf-mygun" type="checkbox" ${s.highlightMyGun ? 'checked' : ''} />
      </div>
      <div class="jf-row">
        <span class="jf-label">${t('settings.language')}</span>
        <select class="jf-input" id="jf-lang">${langOptions}</select>
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
    const lang = panel.querySelector('#jf-lang') as HTMLSelectElement
    const mygun = panel.querySelector('#jf-mygun') as HTMLInputElement
    const commit = (): void => {
      const next: GameSettings = { sfxVolume: Number(vol.value), muted: mute.checked, lang: getLang(), highlightMyGun: mygun.checked }
      volVal.textContent = vol.value
      saveSettings(next)
      onChange?.(next)
    }
    vol.addEventListener('input', commit)
    mute.addEventListener('change', commit)
    mygun.addEventListener('change', commit)
    lang.addEventListener('change', () => {
      setLang(lang.value as import('../i18n').Lang)
      if (onLangChange) onLangChange() // 설정 화면: 제목 포함 전체 재렌더
      else render() // ESC 슬롯: 패널만 자체 재렌더
    })
  }
  render()
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
  scr.appendChild(el('p', 'jf-tagline', t('title.tagline')))
  scr.appendChild(el('p', 'jf-blink', t('title.pressAnyKey')))
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
    [t('menu.playOnline'), () => void goOnline(ctx)],
    [t('menu.offlineBots'), () => show(ctx, 'offline')],
    [t('menu.settings'), () => show(ctx, 'settings')],
    [t('menu.credits'), () => show(ctx, 'credits')],
  ]))
  versionTag(scr)
  ;(scr.querySelector('.jf-menu-item') as HTMLElement | null)?.focus()
}

// PLAY ONLINE — 접속 성공시 lobby 화면, 실패(미배포)시 토스트 + 메뉴 유지.
async function goOnline(ctx: Ctx): Promise<void> {
  showToast('서버 접속 중…')
  try {
    if (!ctx.lc) {
      // M8 개발/검증 seam: ?loopback=1 → 배포(agent8) 없이 인프로세스 목 릴레이로
      // 로비/방 화면·설정 패널을 구동(단일 브라우저 한정 — 실멀티 아님).
      const loopback = new URLSearchParams(window.location.search).get('loopback') === '1'
      const transport = await makeTransport(loopback)
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

// ── offline 모드+맵 선택 소메뉴 (M5: 모드 토글은 화면 유지, 맵 리스트만 갱신) ────────
function renderOfflinePick(ctx: Ctx, scr: HTMLElement): void {
  scr.appendChild(el('h1', 'jf-logo jf-logo-sm', GAME_TITLE))
  scr.appendChild(el('p', 'jf-tagline', t('offline.header')))

  const panel = el('div', 'jf-panel')
  panel.style.minWidth = 'min(460px, 92vw)'
  scr.appendChild(panel)

  let mode: 'dm' | 'ctf' = 'dm'
  let mapKey = loadLastMap() // 'random' 또는 저장된 맵 키
  let respawnSeconds = loadLastRespawn() // M7: 리스폰 대기시간(초)
  let keysByMode: { dm: string[]; ctf: string[] } | null = null

  const drawMapList = (): void => {
    const list = panel.querySelector('#jf-maplist') as HTMLElement | null
    if (!list) return
    if (!keysByMode) { list.innerHTML = '<div class="jf-muted">맵 목록 불러오는 중…</div>'; return }
    const keys = keysByMode[mode]
    if (mapKey !== 'random' && !keys.includes(mapKey)) mapKey = 'random' // 모드 전환 시 소속 안 맞으면 폴백
    const options = ['random', ...keys]
    list.innerHTML = `<div class="jf-maplist-scroll">${options.map((k) => `
      <button class="jf-btn jf-maplist-item ${k === mapKey ? 'jf-on' : ''}" data-map="${k}">${k === 'random' ? t('offline.random') : k}</button>
    `).join('')}</div>`
    list.querySelectorAll<HTMLButtonElement>('[data-map]').forEach((b) => {
      b.addEventListener('click', () => {
        mapKey = b.dataset.map!
        saveLastMap(mapKey)
        drawMapList()
      })
    })
  }

  const draw = (): void => {
    panel.innerHTML = `
      <div class="jf-row">
        <button class="jf-btn ${mode === 'dm' ? 'jf-btn-primary' : ''}" id="jf-mode-dm">${t('mode.dm')}</button>
        <button class="jf-btn ${mode === 'ctf' ? 'jf-btn-primary' : ''}" id="jf-mode-ctf">${t('mode.ctf')}</button>
      </div>
      <div class="jf-label" style="margin-top:4px">${t('offline.respawnTime')}</div>
      <div class="jf-row" id="jf-respawn">${RESPAWN_OPTIONS.map((s) => `
        <button class="jf-btn ${s === respawnSeconds ? 'jf-on' : ''}" data-respawn="${s}">${s}s</button>
      `).join('')}</div>
      <div class="jf-label" style="margin-top:4px">${t('offline.map')}</div>
      <div id="jf-maplist"></div>
      <div class="jf-row" style="margin-top:6px">
        <button class="jf-btn jf-btn-primary" id="jf-start">${t('offline.start')}</button>
        <button class="jf-btn" id="jf-back">${t('common.back')}</button>
      </div>`
    panel.querySelector('#jf-mode-dm')!.addEventListener('click', () => { mode = 'dm'; draw() })
    panel.querySelector('#jf-mode-ctf')!.addEventListener('click', () => { mode = 'ctf'; draw() })
    panel.querySelectorAll<HTMLButtonElement>('[data-respawn]').forEach((b) => {
      b.addEventListener('click', () => { respawnSeconds = Number(b.dataset.respawn); saveLastRespawn(respawnSeconds); draw() })
    })
    panel.querySelector('#jf-start')!.addEventListener('click', () => {
      handoff(ctx)
      ctx.opts.onOfflineBots(mode, mapKey === 'random' ? undefined : mapKey, respawnSeconds)
    })
    panel.querySelector('#jf-back')!.addEventListener('click', () => show(ctx, 'menu'))
    drawMapList()
  }

  draw()
  void loadMapKeys().then((keys) => { keysByMode = keys; drawMapList() })
    .catch(() => showToast('맵 목록 불러오기 실패 — Random으로 진행 가능'))

  versionTag(scr)
  escBack(ctx, 'menu')
}

// ── settings ─────────────────────────────────────────────────────────────────
function renderSettings(ctx: Ctx, scr: HTMLElement): void {
  const panel = el('div', 'jf-panel')
  panel.appendChild(el('h2', 'jf-h', t('menu.settings')))
  panel.appendChild(buildSettingsPanel(ctx.opts.onSettingsChange, () => show(ctx, 'settings')))
  panel.appendChild(backBtn(ctx, 'menu'))
  scr.appendChild(panel)
  versionTag(scr)
  escBack(ctx, 'menu')
}

// ── credits ──────────────────────────────────────────────────────────────────
function renderCredits(ctx: Ctx, scr: HTMLElement): void {
  const panel = el('div', 'jf-panel')
  panel.appendChild(el('h2', 'jf-h', t('credits.heading')))
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
  const b = el('button', 'jf-btn', t('common.back')) as HTMLButtonElement
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
      tbody.innerHTML = `<tr><td colspan="4" class="jf-muted">${t('lobby.noRooms')}</td></tr>`
      return
    }
    // M9: 진행중 방도 Join 가능(난입) — 정원 초과 시에만 비활성. started는 라벨로만 구분.
    const joinCell = (r: { key: string; count: number; started: boolean }): string => {
      if (!canJoinRoom(r.count)) return `<span class="jf-muted">${t('lobby.full')}</span>`
      const label = r.started ? t('lobby.joinInProgress') : 'Join'
      return `<button class="jf-btn" data-join="${r.key}">${label}</button>`
    }
    tbody.innerHTML = rooms.map((r, i) => `
      <tr class="jf-click" data-i="${i}">
        <td>${r.key}</td>
        <td>${r.mode === GAMESTYLE_CTF ? 'CTF' : 'DM'}</td>
        <td>${r.count}${r.started ? ` <span class="jf-muted">· ${t('lobby.inProgress')}</span>` : ''}</td>
        <td>${joinCell(r)}</td>
      </tr>`).join('')
    tbody.querySelectorAll('[data-join]').forEach((b) =>
      b.addEventListener('click', () => void enterRoom(ctx, (b as HTMLElement).dataset.join!)))
  }
  const refresh = async (): Promise<void> => {
    try { rooms = await lc.listRooms(); drawRooms() }
    catch (e) { console.warn('[lobby] listRooms failed (다음 주기 재시도):', e) } // 실릴레이 진단 가시화
  }
  void refresh()
  const timer = window.setInterval(() => void refresh(), 3000) // 3s 주기 갱신 (plan Task3)
  ctx.cleanup.push(() => window.clearInterval(timer))

  panel.querySelector('#jf-quick')!.addEventListener('click', () => {
    const open = rooms.find((r) => !r.started && canJoinRoom(r.count)) // M9: 정원 게이트 추가
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
// M9: 이미 시작된(started) 방에 참가하면 room 화면을 건너뛰고 곧장 매치로 난입한다 —
// CTF면 인원 적은 팀을 자동배정해 p_에 먼저 기록(호스트 syncRoster가 이 team으로 스폰).
async function enterRoom(ctx: Ctx, key: string, createMode?: number): Promise<void> {
  const lc = ctx.lc
  if (!lc) return
  try {
    if (createMode !== undefined) await lc.createRoom(key, createMode)
    else {
      await lc.joinRoom(key)
      if (lc.roomState.started === true) {
        const mode = lc.roomState.mode
        let myTeam = TEAM_NONE
        if (mode === GAMESTYLE_CTF) {
          myTeam = pickAutoTeam(lc.players)
          await lc.selectTeam(myTeam) // 핸드오프 전에 기록 — 호스트가 이 team으로 스폰
        }
        handoff(ctx)
        ctx.opts.onStartMatch({ lobby: lc, mode, myTeam })
        return
      }
    }
    show(ctx, 'room')
  } catch {
    showToast('방 입장 실패 — 다시 시도하세요')
  }
}

// ── room (참가자/팀/Ready/START + M8 방 설정 패널) ───────────────────────────
// 방장: 설정 편집 가능(변경 즉시 updateSettings → onRoomState로 전원 재렌더).
// 비방장: 같은 패널 읽기전용(disabled). 화면 전체를 innerHTML로 재구성하는 기존 저빈도 패턴 유지.
const KILL_LIMIT_OPTIONS = [5, 10, 15, 20]
const TIME_LIMIT_OPTIONS = [5, 10, 15, 0] // 분. 0 = 무제한

function renderRoom(ctx: Ctx, scr: HTMLElement): void {
  const lc = ctx.lc
  if (!lc) return show(ctx, 'menu')
  const panel = el('div', 'jf-panel')
  panel.style.minWidth = 'min(560px, 92vw)'
  panel.style.maxHeight = '86vh'
  panel.style.overflowY = 'auto' // M8: 설정 패널 추가로 세로 길어짐 — 작은 화면 스크롤
  scr.appendChild(panel)
  versionTag(scr)

  // M8: 무기명(고유명사) — 로비는 loadGameAssets를 안 거치므로 guns[]가 비어있을 수 있다.
  if (guns[EAGLE]?.name === '') createWeaponsBase()

  // M8: 맵 후보(모드별) — offline 픽커와 동일 소스(loadMapKeys 모듈 캐시) 재사용.
  let keysByMode: { dm: string[]; ctf: string[] } | null = null
  void loadMapKeys().then((k) => { keysByMode = k; draw() })
    .catch(() => showToast('맵 목록 불러오기 실패 — Random으로 진행'))

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
    // ── M8: 방 설정 패널 (방장=편집, 비방장=읽기전용 disabled) ──
    const s = mergeRoomSettings(lc.roomState.settings)
    const host = lc.isHost
    const dis = host ? '' : 'disabled'
    const mapKeys = keysByMode ? (isCtf ? keysByMode.ctf : keysByMode.dm) : null
    const mapListHtml = mapKeys
      ? `<div class="jf-maplist-scroll">${['random', ...mapKeys].map((k) => `
          <button class="jf-btn jf-maplist-item ${k === s.mapKey ? 'jf-on' : ''}" data-map="${k}" ${dis}>${k === 'random' ? t('offline.random') : k}</button>`).join('')}</div>`
      : `<div class="jf-muted">${s.mapKey === 'random' ? t('offline.random') : s.mapKey}</div>`
    // settings.weaponActive는 0-based(0..13) ↔ guns[]는 1-based(1..14).
    const wpnBtns = (from: number, to: number): string => {
      let html = ''
      for (let i = from; i < to; i++) {
        html += `<button class="jf-btn ${s.weaponActive[i] === 1 ? 'jf-on' : ''}" data-wpn="${i}" ${dis}>${guns[i + 1]?.name || '#' + (i + 1)}</button>`
      }
      return html
    }
    const settingsHtml = `
      <div class="jf-label" style="margin-top:8px">${t('room.settings')}${host ? '' : ' <span class="jf-muted">★host</span>'}</div>
      <div class="jf-label">${t('offline.map')}</div>
      <div id="jf-room-maplist">${mapListHtml}</div>
      <div class="jf-label">${t('room.weapons')} — ${t('loadout.primary')}</div>
      <div class="jf-row" style="flex-wrap:wrap">${wpnBtns(0, PRIMARY_WEAPONS)}</div>
      <div class="jf-label">${t('room.weapons')} — ${t('loadout.secondary')}</div>
      <div class="jf-row" style="flex-wrap:wrap">${wpnBtns(PRIMARY_WEAPONS, MAIN_WEAPONS)}</div>
      <div class="jf-label">${t('offline.respawnTime')}</div>
      <div class="jf-row">${RESPAWN_OPTIONS.map((v) => `
        <button class="jf-btn ${v === s.respawnSeconds ? 'jf-on' : ''}" data-rs="${v}" ${dis}>${v}s</button>`).join('')}</div>
      <div class="jf-label">${isCtf ? t('room.capLimit') : t('room.killLimit')}</div>
      <div class="jf-row">${KILL_LIMIT_OPTIONS.map((v) => `
        <button class="jf-btn ${v === s.killLimit ? 'jf-on' : ''}" data-kl="${v}" ${dis}>${v}</button>`).join('')}</div>
      <div class="jf-label">${t('room.timeLimit')}</div>
      <div class="jf-row">${TIME_LIMIT_OPTIONS.map((v) => `
        <button class="jf-btn ${v === s.timeLimitMin ? 'jf-on' : ''}" data-tl="${v}" ${dis}>${v === 0 ? t('room.unlimited') : v + 'm'}</button>`).join('')}</div>`

    panel.innerHTML = `
      <h2 class="jf-h">Room — ${isCtf ? t('mode.ctf') : t('mode.dm')}</h2>
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
      ${settingsHtml}
      <div class="jf-row" style="margin-top:6px">
        <button class="jf-btn ${me?.ready ? 'jf-btn-primary' : ''}" id="jf-ready">${me?.ready ? t('room.ready') + ' ✓' : t('room.ready')}</button>
        ${lc.isHost
          ? '<button class="jf-btn jf-btn-primary" id="jf-start">Start Match</button>'
          : '<span class="jf-muted">호스트 시작 대기 중…</span>'}
        <button class="jf-btn" id="jf-leave">Leave</button>
      </div>`
    panel.querySelectorAll('[data-team]').forEach((b) =>
      b.addEventListener('click', () => void lc.selectTeam(Number((b as HTMLElement).dataset.team)).catch(() => showToast(t('room.saveFailed')))))
    // ── M8: 설정 변경 핸들러 (방장 전용 — 비방장 버튼은 disabled라 클릭 불가, 이중 가드) ──
    if (host) {
      panel.querySelectorAll<HTMLButtonElement>('[data-map]').forEach((b) =>
        b.addEventListener('click', () => void lc.updateSettings({ mapKey: b.dataset.map! }).catch(() => showToast(t('room.saveFailed')))))
      panel.querySelectorAll<HTMLButtonElement>('[data-wpn]').forEach((b) =>
        b.addEventListener('click', () => {
          const i = Number(b.dataset.wpn)
          const wa = [...mergeRoomSettings(lc.roomState.settings).weaponActive]
          if (wa[i] === 1 && !canDisableWeapon(wa, i)) return // 그룹 최소 1종 가드 — 마지막 하나는 못 끔
          wa[i] = wa[i] === 1 ? 0 : 1
          void lc.updateSettings({ weaponActive: wa }).catch(() => showToast(t('room.saveFailed')))
        }))
      panel.querySelectorAll<HTMLButtonElement>('[data-rs]').forEach((b) =>
        b.addEventListener('click', () => void lc.updateSettings({ respawnSeconds: Number(b.dataset.rs) }).catch(() => showToast(t('room.saveFailed')))))
      panel.querySelectorAll<HTMLButtonElement>('[data-kl]').forEach((b) =>
        b.addEventListener('click', () => void lc.updateSettings({ killLimit: Number(b.dataset.kl) }).catch(() => showToast(t('room.saveFailed')))))
      panel.querySelectorAll<HTMLButtonElement>('[data-tl]').forEach((b) =>
        b.addEventListener('click', () => void lc.updateSettings({ timeLimitMin: Number(b.dataset.tl) }).catch(() => showToast(t('room.saveFailed')))))
    }
    panel.querySelector('#jf-ready')!.addEventListener('click', () => void lc.setReady(!(me?.ready ?? false)).catch(() => showToast(t('room.saveFailed'))))
    // M8: 시작 시 'random' 해석용 후보 풀 전달 — 호스트가 확정 키를 settings에 기록(디싱크 수정).
    panel.querySelector('#jf-start')?.addEventListener('click', () =>
      void lc.start(mapKeys ?? undefined).catch(() => showToast('시작 실패')))
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
  // 방 목록 자가치유 하트비트 — 방장이 5초마다 soldat_rooms 컬렉션에 재등록(upsert). 실 릴레이에서
  // joinRoom의 컬렉션 쓰기가 조용히 실패해 다른 브라우저 로비에 방이 안 보이던 사고를 치유하고
  // 인원수도 최신화한다. 즉시 1회 + 주기. 실패는 콘솔로 가시화(다음 주기 재시도).
  const touch = (): void => {
    if (!lc.isHost) return
    void lc.touchRoom().catch((e) => console.warn('[room] touchRoom failed (방 목록 미표시 가능):', e))
  }
  touch()
  const touchTimer = window.setInterval(touch, 5000)
  ctx.cleanup.push(() => window.clearInterval(touchTimer))
  ctx.cleanup.push(() => { lc.onChange(() => {}); lc.onStart(() => {}) })
  draw()
}
