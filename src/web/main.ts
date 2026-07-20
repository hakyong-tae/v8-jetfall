// 웹 부트스트랩 — 에셋 로드 → GameState 구성 → PIXI 씬 구성 → 60Hz 고정스텝 루프.
// 씬 드로우 순서는 원본 GameRendering.pas RenderFrame(925-995) 그대로:
//   배경 → 뒷폴리곤 → props0 → 병사 → props1 → 앞폴리곤 → props2
import { Application, Container, Text } from 'pixi.js'
import { createGameState, loadThingObjects, type GameState } from '../core/state'
import { loadAnimObjects } from '../core/anims'
import {
  loadSpriteObjects,
  createSprite,
  createTPlayer,
  randomizeStart,
  addBotPlayer,
  MAX_SPRITES,
  type BotConfigEntry,
} from '../core/sprites'
import { createWeapons, loadWeaponsConfig, guns, PRIMARY_WEAPONS, NOWEAPON, type WeaponsIniConfig } from '../core/weapons'
import { loadMapFile } from '../core/mapfile'
import { loadWaypoints } from '../core/waypoints'
import { updateFrame, wireGameHooks } from '../core/game'
import {
  TEAM_NONE,
  TEAM_ALPHA,
  TEAM_BRAVO,
  GAMESTYLE_DEATHMATCH,
  GAMESTYLE_CTF,
} from '../core/constants'
import { vector2 } from '../core/vector'
import { loadManifest, prefetchAnimFiles, fetchBinary, loadTexture, type Manifest } from './assets'
import {
  buildPolyBuffers,
  createPolyMesh,
  createBackgroundMesh,
  buildPropLayers,
  mapTextureKey,
} from './maprender'
import { GostekPool, loadGostekTextures } from './gostek'
import { BulletsRenderer } from './bulletsrender'
import { Hud } from './hud'
import { SoundSystem, wireSound } from './sound'
import { InputState, shouldSwap, slotTargetNum } from './input'
import { Camera } from './camera'
import { mountLobby, buildSettingsPanel, type StartMatchArg } from './lobby/lobby-ui'
import { GAME_TITLE, GAME_TAGLINE } from './brand'
import { injectTheme } from './lobby/ui-theme'
import { loadSettings, loadNick } from './settings'
import { t, initLang } from './i18n'
import { initAds, showInterstitial, showRewarded, makeRoundEndWatcher } from './ads'
import { BOOST_CHARGES, BOOST_DIVISOR, BOOST_MIN_WAIT_TICKS } from '../net/respawn-boost'
import { ROOM_CAP } from '../net/dropin'
import { HostSession, type HostSessionPlayer } from '../net/host-session'
import { ClientSession, type LocalInput } from '../net/client-session'
import { makeWsClientTransport } from '../net/ws-client-transport'
import { decideMigration } from '../net/host-migration'
import { attemptReconnect } from '../net/reconnect'
import { mergeRoomSettings, applyMatchSettings, type RoomSettings } from '../net/room-settings'
// (session.ts는 이번 단계에서 main.ts가 직접 소비하지 않음 — §Task4 "독립 seam" 선택, §자체리뷰)
import type { TControl } from '../core/sprites'
import { LoadoutMenu } from './loadout-menu'

const MAP_NAME_FALLBACK = 'ctf_ash' // manifest.maps 키 — 후보 목록이 비는 이상상황 최종 폴백
const TICK_MS = 1000 / 60 // 16.6667ms 고정스텝
const MAX_CATCHUP_TICKS = 5
const NUM_BOTS = 4 // DM 봇 수 (CTF는 팀당 절반)

// M5 Task1: manifest.maps 99종을 접두사로 필터(grep 실측 — ctf_ 34 / htf_ 19 / inf_ 17 / 무접두 29).
// CTF=ctf_ 전용, DM=무접두(htf_/inf_ 제외 — INF/HTF 게임스타일 규칙 미구현, 기존 스코프와 동일).
function eligibleMapKeys(manifest: Manifest, ctf: boolean): string[] {
  const keys = Object.keys(manifest.maps)
  return ctf
    ? keys.filter((k) => k.startsWith('ctf_'))
    : keys.filter((k) => !k.startsWith('ctf_') && !k.startsWith('htf_') && !k.startsWith('inf_'))
}

// ── 에셋 + 심 상태 로드 (tests/helpers.ts setupTestGame의 브라우저판). 봇전/네트전 공용.
// mapKey 생략(undefined) 또는 해당 모드에 속하지 않으면 후보 중 Math.random() 선택(Random 버튼).
async function loadGameAssets(ctf: boolean, mapKey?: string, respawnSeconds?: number) {
  const manifest = await loadManifest()
  const read = await prefetchAnimFiles(manifest)

  const gs = createGameState()
  wireGameHooks(gs) // gs.sortPlayers 훅 배선 (T10)
  gs.anims = loadAnimObjects(read)
  loadSpriteObjects(gs, read)
  loadThingObjects(gs, read)

  // ── 무기 데이터 (이게 없으면 총이 전부 0값 → 재장전 루프에 갇혀 웅크린 포즈가 됨)
  createWeapons(false)
  const weaponsJson = (await (await fetch('/assets/weapons.json')).json()) as { normal: WeaponsIniConfig }
  loadWeaponsConfig(weaponsJson.normal)

  const eligible = eligibleMapKeys(manifest, ctf)
  const resolvedKey =
    mapKey && eligible.includes(mapKey)
      ? mapKey
      : (eligible[Math.floor(Math.random() * eligible.length)] ?? MAP_NAME_FALLBACK)
  const mapFile = loadMapFile(await fetchBinary(manifest.maps[resolvedKey]))
  gs.map.loadData(mapFile)
  loadWaypoints(gs.botPath, mapFile.waypoints) // PolyMap.pas:236-255 BotPath 브리지

  // ── 게임모드. CTF면 CTF 깃발 무결성 가드가 첫 틱에 깃발 스폰.
  gs.svGamemode = ctf ? GAMESTYLE_CTF : GAMESTYLE_DEATHMATCH
  gs.svKilllimit = ctf ? 10 : 9999 // DM은 소크 중 라운드 리셋 방지(디버그 편의), CTF는 기본 캡
  // M7 Task1: 매치별 리스폰 대기시간(초→틱, 60틱=1s). 미지정이면 코어 기본(360틱=6s) 유지.
  if (respawnSeconds != null) gs.svRespawntime = Math.round(respawnSeconds * 60)
  // M7 Task2: 리스폰 3초 무적(180틱). 봇전/넷전/ws 전 경로가 이 로더를 거치므로 여기 한 곳이면 충분.
  gs.ceaseFireTime = 180
  // M8: 잠복버그 수정 — state.ts 기본 timeLimitCounter=3600(=60초)이라 그대로 두면 어떤 매치든
  // 1분 만에 nextMap(라운드 리셋)이 돈다(core game.ts:161-165). 전 경로 공통 시작점인 여기서
  // svTimelimit(기본 36000=10분)로 재무장. 넷 매치는 이후 applyMatchSettings가 방 설정으로 덮는다.
  gs.timeLimitCounter = gs.svTimelimit
  return { gs, manifest, mapFile, mapKey: resolvedKey }
}

type LoadedAssets = Awaited<ReturnType<typeof loadGameAssets>>

interface Scene {
  app: Application
  world: Container
  bgLayer: Container
  gostek: GostekPool
  entities: BulletsRenderer
  hud: Hud
  sound: SoundSystem
  input: InputState
  camera: Camera
}

// ── PIXI 씬 구성 (앱/텍스처/레이어/HUD/사운드/입력/카메라). 봇전/네트전 공용.
// 드로우 순서는 원본 GameRendering.pas RenderFrame(925-995) 그대로.
async function buildScene(gs: GameState, mapFile: LoadedAssets['mapFile'], manifest: LoadedAssets['manifest']): Promise<Scene> {
  // ── PIXI (커스텀 GlProgram 셰이더 사용 — WebGL 강제)
  const app = new Application()
  await app.init({
    preference: 'webgl',
    resizeTo: window,
    antialias: false,
    background: 0x000000,
  })
  document.body.appendChild(app.canvas)

  const mapTexture = await loadTexture(manifest, mapTextureKey(mapFile))
  if (!mapTexture) throw new Error(`map texture missing: ${mapTextureKey(mapFile)}`)
  const gostekTextures = await loadGostekTextures(manifest)
  const [props0, props1, props2] = await buildPropLayers(mapFile, manifest)

  const bgLayer = new Container()
  bgLayer.addChild(createBackgroundMesh(mapFile))

  // 탄환/씽/스파크 + HUD 렌더러 (텍스처 프리로드)
  const entities = new BulletsRenderer()
  await entities.load(manifest)
  const hud = new Hud()
  await hud.load(manifest)

  const world = new Container()
  const backBufs = buildPolyBuffers(mapFile, 'back')
  if (backBufs.triCount > 0) world.addChild(createPolyMesh(backBufs, mapTexture)) // ctf_Ash 등 BACKPOLY 0개 맵 대비
  world.addChild(props0)
  const gostek = new GostekPool(gostekTextures)
  world.addChild(gostek.container)
  world.addChild(entities.container) // 탄환/씽/스파크는 병사와 같은 월드 레이어(카메라 추종)
  world.addChild(props1)
  const frontBufs = buildPolyBuffers(mapFile, 'front')
  if (frontBufs.triCount > 0) world.addChild(createPolyMesh(frontBufs, mapTexture))
  world.addChild(props2)

  app.stage.addChild(bgLayer)
  app.stage.addChild(world)
  app.stage.addChild(hud.container) // HUD는 화면 고정(월드 밖)

  // ── 사운드 (WebAudio) — gs.playSound 훅 배선. AudioContext는 첫 사용자 제스처 후 resume.
  const sound = new SoundSystem(manifest)

  // ── 입력/카메라
  const input = new InputState()
  input.attach(app.canvas)
  const camera = new Camera()

  // 사운드 초기화(카메라 필요) 후 gs.playSound 배선. 실패해도(WebAudio 미지원) 무음 진행.
  await sound.init(camera)
  // M4-A: 영속 설정(localStorage) 적용 — 봇전/네트전/ws데모 전 경로 공통 적용점.
  const settings = loadSettings()
  sound.setMasterVolume(settings.sfxVolume)
  sound.setMuted(settings.muted)
  wireSound(gs, sound)
  // AudioContext resume을 실제 사용자 제스처(캔버스/윈도우 클릭·키)에 바인딩 — 봇 선발사 무음버그 방지.
  sound.bindResumeGestures(app.canvas)

  return { app, world, bgLayer, gostek, entities, hud, sound, input, camera }
}

// 빈 TControl 스크래치 — 매 틱 input.applyTo로 채운 뒤 LocalInput으로 복사(재사용, 할당 0).
function createScratchControl(): TControl {
  return { left: false, right: false, up: false, down: false, fire: false, jetpack: false,
    throwNade: false, changeWeapon: false, throwWeapon: false, reload: false, prone: false,
    flagThrow: false, mouseAimX: 0, mouseAimY: 0, mouseDist: 0 }
}

// ── M7 Task4: 1/2 직접 무기전환. input.consumeSlotSwitch()가 반환한 슬롯 요청을 받아,
// 로컬 병사가 살아있고 요청 슬롯이 현재 든 슬롯과 다르면 control.changeWeapon을 그 틱 한정 세팅.
// 코어 스왑은 토글뿐이라 "다를 때만 1회"가 정확히 1회 스왑을 만든다(이미 그 슬롯이면 무동작).
// 슬롯 num: 주무기=spr.selWeapon, 보조무기=guns[PRIMARY_WEAPONS+secWep+1].num. spr.weapon.num과 비교.
// 넷/ws 경로도 changeWeapon이 INPUT 메시지 비트(protocol BIT.changeWeapon)로 실려 호스트에 전달됨.
function applySlotSwitch(control: TControl, gs: GameState, me: number, req: 1 | 2 | null): void {
  if (req == null || me < 0) return
  const spr = gs.sprite[me]
  if (!spr?.active || spr.deadMeat || !spr.player) return
  const secondaryNum = guns[PRIMARY_WEAPONS + spr.player.secWep + 1]?.num
  const targetNum = slotTargetNum(req, spr.selWeapon, guns[NOWEAPON].num, secondaryNum)
  if (targetNum != null && shouldSwap(spr.weapon.num, targetNum)) control.changeWeapon = true
}

// TControl → LocalInput (seq/mouseDist 제외한 나머지 이름 그대로).
function toLocalInput(c: TControl): LocalInput {
  return { left: c.left, right: c.right, up: c.up, down: c.down, fire: c.fire, jetpack: c.jetpack,
    throwNade: c.throwNade, changeWeapon: c.changeWeapon, throwWeapon: c.throwWeapon, reload: c.reload,
    prone: c.prone, flagThrow: c.flagThrow, mouseAimX: c.mouseAimX, mouseAimY: c.mouseAimY }
}

// ── M4-A: 인게임 ESC 오버레이 메뉴 (RESUME / SETTINGS / LEAVE TO MENU) ──
// pausable=오프라인 봇전만 true(시뮬 일시정지). 네트 매치는 공정성 때문에 시뮬 계속 + 오버레이만.
// LEAVE: onLeave(트랜스포트 leave 등) → app 파괴 → body 클리어 → boot() 재호출로 메뉴 복귀.
function attachEscMenu(
  app: Application,
  sound: SoundSystem,
  o: { pausable: boolean; onLeave?: () => void },
): { paused: () => boolean; dispose: () => void } {
  injectTheme() // ?nolobby=1 직행 경로는 mountLobby를 안 거치므로 여기서도 보장
  let overlay: HTMLElement | null = null
  let disposed = false

  const close = (): void => { overlay?.remove(); overlay = null }
  const leave = (): void => {
    dispose()
    try { o.onLeave?.() } catch { /* leave 실패는 무시 — 어차피 파괴 */ }
    app.ticker.stop()
    app.destroy(true)
    document.body.innerHTML = ''
    // 개발용 직행 파라미터(?nolobby/?wshost/?mode)를 제거해 진짜 '메뉴로 나가기'가 되게 한다.
    const url = new URL(window.location.href)
    for (const k of ['nolobby', 'wshost', 'acc', 'mode']) url.searchParams.delete(k)
    window.history.replaceState(null, '', url)
    boot()
  }
  const open = (): void => {
    overlay = document.createElement('div')
    overlay.className = 'jf-overlay'
    const panel = document.createElement('div')
    panel.className = 'jf-panel'
    panel.innerHTML = `
      <h2 class="jf-h">${o.pausable ? t('esc.paused') : t('esc.menu')}</h2>
      ${o.pausable ? '' : '<div class="jf-muted">멀티플레이 중 — 게임은 계속 진행됩니다</div>'}
      <nav class="jf-menu" style="align-items:stretch">
        <button class="jf-menu-item" id="jf-esc-resume">${t('esc.resume')}</button>
        <button class="jf-menu-item" id="jf-esc-settings">${t('menu.settings')}</button>
        <button class="jf-menu-item" id="jf-esc-leave">${t('esc.leave')}</button>
      </nav>
      <div id="jf-esc-settings-slot"></div>`
    overlay.appendChild(panel)
    document.body.appendChild(overlay)
    panel.querySelector('#jf-esc-resume')!.addEventListener('click', close)
    panel.querySelector('#jf-esc-leave')!.addEventListener('click', leave)
    panel.querySelector('#jf-esc-settings')!.addEventListener('click', () => {
      const slot = panel.querySelector('#jf-esc-settings-slot') as HTMLElement
      if (slot.childElementCount > 0) { slot.innerHTML = ''; return } // 토글
      slot.appendChild(buildSettingsPanel((s) => {
        sound.setMasterVolume(s.sfxVolume)
        sound.setMuted(s.muted)
      }))
    })
  }
  const onKey = (e: KeyboardEvent): void => {
    // e.key 기준 — 합성 이벤트(테스트 드라이버 등)는 code가 비어있을 수 있다
    if ((e.key !== 'Escape' && e.code !== 'Escape') || disposed) return
    e.preventDefault()
    if (overlay) close()
    else open()
  }
  window.addEventListener('keydown', onKey)
  const dispose = (): void => {
    disposed = true
    window.removeEventListener('keydown', onKey)
    close()
  }
  return { paused: () => o.pausable && overlay !== null, dispose }
}

// 리워드 광고: 리스폰 부스트. 사망 대기 중 + 방 리스폰 대기가 의미있을 때(BOOST_MIN_WAIT_TICKS↑)만
// 노출되는 DOM 버튼. 완주 시 onReward가 권위 경로를 고른다(봇전 로컬 / 클라→호스트 요청).
// getState: 현재 리스폰 대기 틱 + 방 리스폰 설정 틱을 돌려줘 노출 여부·헛소모 방지 판정.
function attachRespawnBoostButton(
  getState: () => { waitTicks: number; roomRespawnTicks: number },
  onReward: () => void,
): { update: () => void; dispose: () => void } {
  const btn = document.createElement('button')
  btn.className = 'jf-btn jf-btn-primary'
  btn.style.cssText = 'position:fixed;left:50%;bottom:14%;transform:translateX(-50%);z-index:40;display:none'
  btn.textContent = `▶ ${t('ad.boostRespawn').replace('{n}', String(BOOST_CHARGES))}`
  let pending = false
  btn.addEventListener('click', () => {
    if (pending) return
    pending = true
    void showRewarded('respawn-boost').then((ok) => { pending = false; if (ok) onReward() })
  })
  document.body.appendChild(btn)
  return {
    update: () => {
      const { waitTicks, roomRespawnTicks } = getState()
      // 죽어서 대기 중(waitTicks>0) + 방 리스폰이 부스트할 가치가 있을 때(≥임계)만 노출.
      btn.style.display = waitTicks > 0 && roomRespawnTicks >= BOOST_MIN_WAIT_TICKS ? '' : 'none'
    },
    dispose: () => btn.remove(),
  }
}

// 오프라인 리스폰 부스트 — 호스트 tickRespawnBoost의 로컬(1인 시뮬) 판. updateFrame "전"에 tick().
function makeOfflineBoost(gs: GameState, getMe: () => number) {
  let remaining = 0
  let wasDead = false
  return {
    grant: () => { remaining = Math.min(BOOST_CHARGES * 2, remaining + BOOST_CHARGES) },
    remaining: () => remaining,
    tick: () => {
      const s = gs.sprite[getMe()]
      if (remaining <= 0 || !s?.active) { wasDead = s?.deadMeat ?? false; return }
      if (s.deadMeat) {
        const target = Math.max(1, Math.floor(gs.svRespawntime / BOOST_DIVISOR))
        if (s.respawnCounter > target) s.respawnCounter = target
      } else if (wasDead) {
        remaining = Math.max(0, remaining - 1) // 방금 리스폰 — 1회 소비
      }
      wasDead = s.deadMeat
    },
  }
}

// 활성 전투원 수(병사+봇) — 좌상단 인원 표시용.
function countActive(gs: GameState): number {
  let n = 0
  for (let i = 1; i <= MAX_SPRITES; i++) if (gs.sprite[i]?.active) n++
  return n
}

// 백그라운드 안정 시뮬 시계 (멀티 전용) — 호스트가 브라우저 탭을 백그라운드로 두면 rAF가
// Chrome에 스로틀돼 60Hz 권위 시뮬이 멈추고 "매치 전체가 몇 초씩 프리즈"한다. Web Worker의
// setInterval은 백그라운드에서도 강하게 스로틀되지 않으므로, 워커가 틱 신호만 쏘고 메인스레드가
// 실경과시간(performance.now())으로 고정스텝 시뮬을 돌린다(모든 게임로직은 메인스레드 그대로).
// Worker 미가용/생성실패 시 메인스레드 setInterval로 폴백(포그라운드 동일, 백그라운드만 스로틀).
// ⚠️ 불변식: 시뮬 tick()은 오직 이 시계로만 구동한다(rAF에서 또 돌리면 이중 스텝 → 관측자 디싱크).
function createSimClock(step: (dtMs: number) => void): { stop: () => void } {
  let last = performance.now()
  const onWake = (): void => { const now = performance.now(); step(now - last); last = now }
  try {
    if (typeof Worker === 'undefined') throw new Error('no Worker')
    const src = 'let i=setInterval(function(){postMessage(0)},12);onmessage=function(){clearInterval(i)}'
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
    const w = new Worker(url)
    URL.revokeObjectURL(url)
    w.onmessage = onWake
    return { stop: () => { try { w.postMessage('stop') } catch { /* noop */ } w.terminate() } }
  } catch {
    const id = setInterval(onWake, 16)
    return { stop: () => clearInterval(id) }
  }
}

async function startBotMatch(mode?: 'dm' | 'ctf', mapKey?: string, settings?: RoomSettings, botCount: number = NUM_BOTS): Promise<void> {
  // (봇전 시작 인터스티셜 제거 — 진입 즉시 광고가 이탈을 유발한다는 피드백. 수익은 라운드
  //  종료 인터스티셜 + 리스폰 부스트 리워드로 확보.)
  // ── 게임모드 — 메뉴 인자 우선, 없으면 URL ?mode=ctf 호환(개발 경로)
  const params = new URLSearchParams(window.location.search)
  const ctf = mode ? mode === 'ctf' : params.get('mode') === 'ctf'
  const { gs, manifest, mapFile, mapKey: resolvedMapKey } = await loadGameAssets(ctf, mapKey, settings?.respawnSeconds)
  // 봇전 상세설정 — 멀티 방과 동일 적용기(무기 토글/목표/시간/리스폰). 미지정(폴백/개발 직행)이면
  // loadGameAssets의 기본값 유지(DM 킬리밋 9999 = 소크용).
  if (settings) applyMatchSettings(gs, settings)

  // ── 플레이어 1명 스폰 (CTF=alpha, DM=무팀)
  const playerTeam = ctf ? TEAM_ALPHA : TEAM_NONE
  const player = createTPlayer()
  player.name = loadNick() // 봇전 내 캐릭터 이름 — 영속 닉(온라인과 공용). 스코어보드에 표시.
  player.team = playerTeam
  // 로컬 플레이어를 눈에 띄게 — DM에선 셔츠 청록(0x33ccff)으로 자기 병사 식별(CTF에선 팀색이 강제됨).
  player.shirtColor = 0x33ccff
  player.hairStyle = 1
  player.headgear = 0
  const r = randomizeStart(gs, playerTeam)
  const me = createSprite(gs, r.start, vector2(0, 0), 1, 255, player, true)
  if (me < 0) throw new Error('createSprite failed')
  // M5: 맨손 스폰 — createSprite()가 이미 selWeapon=0/secWep=0(원작 규약, Sprites.pas:3574 상당).
  // 무기는 로드아웃(림보) 메뉴가 클릭으로 골라 지급한다(LoadoutMenu, 이번 함수 하단에서 배선).
  gs.sprite[me].respawn()

  // ── 봇 스폰 (bots.json). DM=무팀 N기, CTF=팀당 N/2기(플레이어 alpha 보정 위해 bravo 우선).
  const bots = (await (await fetch('/assets/bots.json')).json()) as Record<string, BotConfigEntry>
  const botNames = Object.keys(bots)
  if (ctf) {
    for (let i = 0; i < botCount; i++) {
      const team = i % 2 === 0 ? TEAM_BRAVO : TEAM_ALPHA
      addBotPlayer(gs, bots[botNames[i % botNames.length]], team)
    }
  } else {
    for (let i = 0; i < botCount; i++) {
      addBotPlayer(gs, bots[botNames[i % botNames.length]], TEAM_NONE)
    }
  }

  // ── PIXI 씬 구성 (봇전/네트전 공용)
  const { app, world, bgLayer, gostek, entities, hud, sound, input, camera } = await buildScene(gs, mapFile, manifest)

  // ── 디버그 오버레이(FPS/pos/jets) — dev 전용. 프로덕션에선 좌상단을 매치 정보 패널이 쓴다.
  const debug = new Text({
    text: '',
    style: { fill: 0xffffff, fontSize: 12, fontFamily: 'monospace' },
  })
  debug.position.set(8, 8)
  debug.visible = import.meta.env.DEV
  if (import.meta.env.DEV) app.stage.addChild(debug)

  const spr = gs.sprite[me]

  // ── M5: 무기선택(림보) 메뉴 — 봇전은 "호스트"가 곧 로컬 gs이므로 네트워크 전송 없이 직접
  // gs를 조작(onNetworkPick 생략). Q 핫키 리스너는 attachEscMenu보다 먼저 등록해야 ESC가
  // 메뉴부터 닫히고 일시정지 메뉴로 새지 않는다(§Task2 스택 규약).
  const loadout = new LoadoutMenu(gs, () => me, manifest)
  const disposeLoadoutHotkeys = loadout.attachHotkeys()

  // 개발 콘솔 디버그 핸들
  ;(window as unknown as Record<string, unknown>).__soldat = {
    gs,
    me,
    camera,
    input,
    app,
    loadout,
    gostek, // dev 검증용 — 렌더러 틴트 등 시각 상태 직접 조회
    entities, // dev 검증용 — 총알 틴트 확인

    // rAF 스로틀 환경(헤드리스 프리뷰)용 수동 스텝퍼. focusNum을 주면 그 스프라이트를 카메라가
    // 따라가고(없으면 로컬 me), 라이브 틱과 동일하게 world/bgLayer 위치까지 세팅해 완전한 프레임을
    // 렌더한다(프로모 영상 캡처·눈검증용).
    step: (n: number, focusNum?: number) => {
      for (let i = 0; i < n; i++) {
        input.setMenuOpen(loadout.isOpen())
        input.applyTo(spr.control, camera.x, camera.y, app.screen.width, app.screen.height)
        applySlotSwitch(spr.control, gs, me, input.consumeSlotSwitch())
        updateFrame(gs)
        loadout.poll()
      }
      gostek.update(gs, me)
      entities.update(gs, me) // me = 내 총알 주황 틴트 대상
      hud.update(gs, me, app.screen.width, app.screen.height)
      hud.showScoreboard(gs, input.isTabHeld(), { myNum: me }) // 봇전: 내 이름 행 하이라이트
      const fn = focusNum != null && gs.sprite[focusNum]?.active ? focusNum : me
      camera.update(gs.spriteParts.pos[fn].x, gs.spriteParts.pos[fn].y, input.mouseX, input.mouseY, app.screen.width, app.screen.height)
      world.position.set(app.screen.width / 2 - camera.x, app.screen.height / 2 - camera.y)
      bgLayer.position.set(app.screen.width / 2, app.screen.height / 2 - camera.y)
      app.render()
    },
  }

  // ── 리스폰 부스트(오프라인 로컬) — 광고 완주 시 잔여 충전, 죽을 때마다 리스폰 절반+1회 차감.
  const boost = makeOfflineBoost(gs, () => me)
  const skipBtn = attachRespawnBoostButton(
    () => ({ waitTicks: gs.sprite[me]?.deadMeat ? gs.sprite[me].respawnCounter : 0, roomRespawnTicks: gs.svRespawntime }),
    () => boost.grant(),
  )
  // ── ESC 오버레이 — 오프라인 봇전은 pausable(시뮬 일시정지). onLeave: 로드아웃 핫키 리스너 해제
  // (안 하면 메뉴로 나갔다 재입장할 때 window keydown 리스너가 중첩된다).
  const roundEndAd = makeRoundEndWatcher(() => void showInterstitial('round-end')) // 광고 배치 #1
  const esc = attachEscMenu(app, sound, { pausable: true, onLeave: () => { disposeLoadoutHotkeys(); skipBtn.dispose() } })

  // ── 60Hz 고정스텝 루프 (rAF 누산기, 최대 5틱 캐치업)
  let acc = 0
  app.ticker.add((ticker) => {
    if (esc.paused()) { acc = 0; sound.updateJetpack(false, null); return } // ESC 일시정지 가드
    loadout.poll() // 최초 스폰/사망 전이 감지 → 자동 오픈
    input.setMenuOpen(loadout.isOpen()) // 메뉴 열림 중 좌클릭(발사) 억제
    acc += ticker.deltaMS
    let ticks = 0
    while (acc >= TICK_MS && ticks < MAX_CATCHUP_TICKS) {
      input.applyTo(spr.control, camera.x, camera.y, app.screen.width, app.screen.height)
      applySlotSwitch(spr.control, gs, me, input.consumeSlotSwitch()) // M7: 1/2 무기전환
      boost.tick() // 리스폰 부스트 — updateFrame이 respawnCounter를 감소시키기 전에 클램프
      updateFrame(gs)
      acc -= TICK_MS
      ticks++
    }
    if (ticks === MAX_CATCHUP_TICKS) acc = 0 // 스파이럴 방지 — 밀린 시간 폐기

    // ── 렌더 동기화 (맵/프롭은 정적, 병사·탄환·씽·HUD·카메라 갱신)
    gostek.update(gs, me)
    entities.update(gs, me) // me = 내 총알 주황 틴트 대상
    hud.update(gs, me, app.screen.width, app.screen.height)
    hud.showScoreboard(gs, input.isTabHeld(), { myNum: me }) // M5+봇전: Tab 홀드 스코어보드, 내 이름 행 하이라이트
    hud.setMatchInfo({ mapKey: resolvedMapKey, playerCount: countActive(gs) }) // 좌상단 상시 패널(봇전=방없음)
    hud.setRespawnStatus(gs.sprite[me]?.deadMeat ? gs.sprite[me].respawnCounter : 0, boost.remaining())
    skipBtn.update()
    roundEndAd(gs.mapChangeCounter)

    // 제트팩 루프음 — 로컬 병사가 제트 분사 중일 때만 (Control.pas 클라 전용 루프 배선).
    sound.updateJetpack(spr.control.jetpack && spr.jetsCount > 0, gs.spriteParts.pos[me])

    const px = gs.spriteParts.pos[me].x
    const py = gs.spriteParts.pos[me].y
    camera.update(px, py, input.mouseX, input.mouseY, app.screen.width, app.screen.height)

    world.position.set(app.screen.width / 2 - camera.x, app.screen.height / 2 - camera.y)
    bgLayer.position.set(app.screen.width / 2, app.screen.height / 2 - camera.y)

    if (debug.visible) {
      debug.text =
        `FPS ${ticker.FPS.toFixed(0)}\n` +
        `pos ${px.toFixed(1)}, ${py.toFixed(1)}\n` +
        `onGround ${spr.onGround}\n` +
        `jets ${spr.jetsCount}`
    }
  })
}

// ── 네트 인게임 (호스트권위 이동 동기화, B단계). 씬 구성은 봇전과 공유(buildScene),
// 차이는 스폰(HostSession.spawnPlayers vs 로컬 1인)과 루프 본문(host.tick/client.tick)뿐.
async function startNetMatch(a: StartMatchArg): Promise<void> {
  const ctf = a.mode === GAMESTYLE_CTF
  // M8: 방 설정 — 호스트가 start() 시점에 'random'을 확정 키로 해석해 roomState.settings에
  // 기록했으므로(lobby-client.ts) 호스트/클라 전원이 같은 mapKey를 로드한다. 이전에는
  // loadGameAssets(ctf)를 mapKey 없이 불러 각 클라가 각자 랜덤 맵을 뽑았다(충돌 지오메트리
  // 디싱크 — M5 이후 잠복). settings 없는 옛 방은 merge가 기본값으로 폴백(안전).
  const settings = mergeRoomSettings(a.lobby.roomState.settings)
  const { gs, manifest, mapFile, mapKey: netMapKey } = await loadGameAssets(ctf, settings.mapKey)
  // 리스폰/무기제한/킬·시간제한은 여기 한 곳에서만 반영(호스트/클라 동일 경로 → 동일 세팅).
  // loadGameAssets의 respawnSeconds 인자는 일부러 안 쓴다 — 이중 적용 방지.
  applyMatchSettings(gs, settings)
  const { app, world, bgLayer, gostek, entities, hud, sound, input, camera } = await buildScene(gs, mapFile, manifest)

  const account = a.lobby.account
  const dedicatedUrl = a.lobby.roomState.dedicatedHostUrl
  // 전용호스트(플랜B)가 있으면: 사람은 항상 클라, 매치 트랜스포트만 별도 ws로 스위칭.
  // 전용호스트(agent8-in-node)면: dedicatedUrl 미설정, 기존 배선 그대로(agent8 릴레이 공용).
  const isDedicated = !!dedicatedUrl // 전용 Node 호스트(플랜B) — 마이그레이션/재접속 스코프 밖(스펙§3.1)
  let isHost = dedicatedUrl ? false : a.lobby.isHost // let: 승격/강등 재대입(§설계결정)
  let myEpoch = 0 // 내가 승격했다면 세대(스플릿브레인 강등 판단용)
  const transport = dedicatedUrl ? makeWsClientTransport(dedicatedUrl, account) : a.lobby.net
  if (dedicatedUrl) await transport.connect()

  // 스크래치 TControl(매 틱 input.applyTo로 채움) → currentLocalInput(세션이 읽는 클로저 변수).
  const scratch = createScratchControl()
  let currentLocalInput: LocalInput = toLocalInput(scratch)

  let myNum = -1
  let hostSession: HostSession | null = null
  let clientSession: ClientSession | null = null
  let stopClock = (): void => {} // Worker 시뮬 시계 정지 훅 — 아래 루프에서 실제 stop으로 대입, 매치 종료 경로에서 호출

  // ── M5: 무기선택(림보) 메뉴 — 온라인 매치. 호스트는 자기 gs가 곧 권위값이라 로컬 반영만으로
  // 충분(HostSession.spawnPlayers가 맨손 스폰 + LOADOUT 핸들러가 다른 클라 선택을 받는다).
  // 비-호스트 클라는 로컬 예측 반영 후 LOADOUT을 호스트로 전송 — isHost/clientSession은 마이그레이션
  // 으로 재대입될 수 있어 콜백 안에서 최신값을 다시 읽는다(클로저가 위 let 변수를 그대로 참조).
  const loadout = new LoadoutMenu(gs, () => myNum, manifest, {
    onNetworkPick: (selWeapon, secWep) => {
      if (!isHost && clientSession) clientSession.sendLoadout(selWeapon, secWep)
    },
  })
  const disposeLoadoutHotkeys = loadout.attachHotkeys()

  if (isHost) {
    hostSession = new HostSession(transport, gs)
    const players: HostSessionPlayer[] = Object.entries(a.lobby.players)
      .map(([acc, p]) => ({ account: acc, team: p.team, nick: p.nick }))
    hostSession.spawnPlayers(players)
    myNum = hostSession.spriteNumOf(account) ?? -1
    hostSession.startPingSampling() // 스코어보드 핑 — 자기 RTT 측정(클라 보고는 MSG.PING 수신)
  } else {
    clientSession = new ClientSession(transport, gs, account, () => currentLocalInput)
    clientSession.startPingSampling() // 스코어보드 핑 — 3초마다 측정→호스트 보고
  }
  const pingOf = (n: number): number | undefined =>
    (isHost ? hostSession?.pingOfNum(n) : clientSession?.pingOfNum(n))
  const stopPing = (): void => { hostSession?.stopPingSampling(); clientSession?.stopPingSampling() }

  // ── M9: 매치 중 로스터 감시 — roomState의 p_ 변화(난입/이탈)를 호스트가 스폰/정리로 반영.
  // 핸드오프 시 room 화면 cleanup이 onChange를 초기화하므로 여기서 다시 구독해도 충돌 없음.
  // 저빈도 이벤트지만 rAF 루프에서 dirty 플래그로 소비 — 마이그레이션 승격 직후의 신임 호스트도
  // 같은 경로로 로스터를 이어받는다(isHost/hostSession은 루프 시점 최신값).
  // 초기값 true — onChange 등록 전(에셋/씬 로딩 await 구간)에 난입한 p_도 첫 루프 틱에 1회
  // 조정으로 흡수한다(syncRoster는 멱등 — 기존 인원은 no-op).
  let rosterDirty = true
  if (!isDedicated) a.lobby.onChange(() => { rosterDirty = true })
  function syncRosterIfHost(): void {
    if (!rosterDirty || !isHost || !hostSession) return
    rosterDirty = false
    hostSession.syncRoster(Object.entries(a.lobby.players)
      .map(([acc, p]) => ({ account: acc, team: p.team, nick: p.nick })))
    if (myNum < 0) myNum = hostSession.spriteNumOf(account) ?? -1
  }

  // ── M9: 방 목록 하트비트 — room 화면의 touchRoom 타이머는 핸드오프에서 해제되므로, 매치 중에도
  // 방장이 5초마다 soldat_rooms를 upsert해 목록에 "진행중 · 난입 가능"으로 계속 노출한다.
  // started=true는 start()가 이미 roomState에 기록 — touchRoom이 그대로 반영. 해제는 ESC LEAVE +
  // 오프라인 폴백(degrade) 양쪽에서.
  const touchTimer = window.setInterval(() => {
    if (!isHost || isDedicated) return
    void a.lobby.touchRoom().catch((e) => console.warn('[net] touchRoom failed (방 목록 미표시 가능):', e))
  }, 5000)

  // ── M3-E: 마이그레이션 감시 + 재접속 감시 + 오프라인 폴백(매 프레임 저비용 값 비교) ──
  let reconnecting = false
  let degraded = false
  const matchStartedAt = Date.now() // M9(리뷰 #3): 유령 방 난입 시 무스냅샷 타임아웃 기준점
  function degradeToOfflineBots(reason: string): void {
    if (degraded) return
    degraded = true
    console.warn(`[net] falling back to offline bots: ${reason}`)
    window.clearInterval(touchTimer) // M9: 방 목록 하트비트 해제
    stopPing()
    stopClock() // Worker 시뮬 시계 정지
    esc.dispose() // 이전 매치의 ESC 리스너 제거 (새 봇전이 자기 것을 단다)
    app.ticker.stop(); app.destroy(true); document.body.innerHTML = ''
    startBotMatch().catch(fail)
  }
  function checkMigrationAndReconnect(): void {
    if (isDedicated || degraded) return // 전용호스트: 마이그레이션 없음(스펙§3.1)
    if (isHost) {
      const rs = a.lobby.roomState
      if (rs.hostAccount && rs.hostAccount !== account && (rs.hostEpoch ?? 0) > myEpoch) {
        console.log(`[net] demoted — ${rs.hostAccount} claimed epoch ${rs.hostEpoch}`) // 스플릿브레인 가드
        hostSession = null; isHost = false
        clientSession = new ClientSession(transport, gs, account, () => currentLocalInput)
      }
      return
    }
    if (transport.status === 'offline' && !reconnecting) {
      reconnecting = true
      attemptReconnect({ transport, roomKey: a.lobby.roomKey ?? '' }).then((result) => {
        reconnecting = false
        if (result === 'gave-up') degradeToOfflineBots('reconnect failed')
      }).catch(() => { reconnecting = false; degradeToOfflineBots('reconnect error') })
      return
    }
    if (!clientSession) return
    // M9(리뷰 #3): 유령 started 방 난입 가드 — 목록엔 남았지만 호스트가 없는 방에 들어가면
    // 첫 스냅샷이 영영 안 온다(decideMigration은 lastSnapshotAt===0이면 판단 보류). 매치 진입
    // 후 8초 내 무수신이면 봇전 폴백.
    if (clientSession.lastSnapshotAt === 0 && Date.now() - matchStartedAt > 8000) {
      degradeToOfflineBots('no snapshot from host (dead room?)')
      return
    }
    const action = decideMigration(clientSession.lastSnapshotAt, {
      getPlayers: () => a.lobby.players, myAccount: account,
      currentHostAccount: a.lobby.roomState.hostAccount, nowFn: () => Date.now(),
    })
    if (action !== 'promote') return
    console.log('[net] promoting to host')
    const promoted = HostSession.fromPromotedClient(transport, gs, clientSession.knownSlots)
    myNum = promoted.spriteNumOf(account) ?? clientSession.myNum ?? -1
    myEpoch = (a.lobby.roomState.hostEpoch ?? 0) + 1
    hostSession = promoted; clientSession = null; isHost = true
    // updateRoomState는 이제 재시도 소진 시 던진다 — 승격 클레임 실패는 다음 감시 주기가 재승격
    // 판단으로 자연 복구하므로 경고만 남긴다(unhandled rejection 방지).
    transport.updateRoomState({ hostAccount: account, hostEpoch: myEpoch })
      .catch((e) => console.warn('[net] host claim write failed:', e))
  }

  // §설계결정5 수동우회용 디버그 훅(전용호스트 Plan-B의 dedicatedHostUrl 수동기록 등).
  // M9: 라이브 클로저 상태 게터(hostSession/rosterDirty 등) — loopback 단일페이지 seam에서
  // 난입 스폰을 콘솔로 관찰·검증하기 위한 읽기전용 디버그 핸들.
  // app 노출 — 봇전의 __soldat.step()과 같은 이유(rAF 스로틀 프리뷰에서 ticker.update() 수동 펌프).
  ;(window as unknown as Record<string, unknown>).__soldatNet = {
    lobby: a.lobby, gs, net: transport, app,
    get hostSession() { return hostSession },
    get isHost() { return isHost },
    get myNum() { return myNum },
  }

  // ── 리스폰 부스트(멀티) — 호스트는 자기 권위로 직접 충전, 클라는 호스트에 요청(+로컬 예측 표시).
  const skipBtn = attachRespawnBoostButton(
    () => ({ waitTicks: myNum >= 0 && gs.sprite[myNum]?.deadMeat ? gs.sprite[myNum].respawnCounter : 0, roomRespawnTicks: gs.svRespawntime }),
    () => {
      if (isHost) hostSession?.applyRespawnBoost(account, BOOST_CHARGES)
      else clientSession?.requestRespawnBoost()
    },
  )
  // HUD 부스트 잔여 표시용 — 호스트/클라 각자 자기 카운트를 읽는다.
  const myBoostRemaining = (): number => (isHost ? (hostSession?.boostOf(account) ?? 0) : (clientSession?.boostRemaining ?? 0))
  // ── ESC 오버레이 — 네트 매치는 시뮬 계속(공정성), 오버레이만. LEAVE 시 룸 이탈 + 로드아웃 핫키 해제.
  const roundEndAd = makeRoundEndWatcher(() => void showInterstitial('round-end')) // 광고 배치 #1
  const esc = attachEscMenu(app, sound, {
    pausable: false,
    onLeave: () => {
      window.clearInterval(touchTimer) // M9: 방 목록 하트비트 해제
      stopPing()
      stopClock() // Worker 시뮬 시계 정지
      skipBtn.dispose()
      disposeLoadoutHotkeys()
      void a.lobby.leave().catch(() => undefined)
      if (dedicatedUrl) void transport.leaveRoom().catch(() => undefined)
    },
  })

  // ── 60Hz 고정스텝: 시뮬은 Worker 시계가 구동(백그라운드 프리즈 방지), 렌더는 rAF.
  //    불변식: 권위 시뮬 tick()은 오직 simStep에서만(=Worker 경로). rAF(renderStep)는 렌더 전용 —
  //    양쪽에서 tick()을 부르면 이중 스텝으로 스냅샷 2배 송출 → 관측자 디싱크.
  let acc = 0
  function simStep(dtMs: number): void {
    checkMigrationAndReconnect() // M3-E 마이그레이션 감시 — 백그라운드에서도 계속 돌아야 호스트 이탈 대응
    syncRosterIfHost() // M9: roomState 변경(난입/이탈) 반영
    if (myNum >= 0) { loadout.poll(); input.setMenuOpen(loadout.isOpen()) } // M5: 자동오픈+발사억제
    acc += dtMs
    let ticks = 0
    while (acc >= TICK_MS && ticks < MAX_CATCHUP_TICKS) {
      input.applyTo(scratch, camera.x, camera.y, app.screen.width, app.screen.height)
      applySlotSwitch(scratch, gs, myNum, input.consumeSlotSwitch()) // M7: changeWeapon 비트가 INPUT 메시지로 실림
      currentLocalInput = toLocalInput(scratch)
      if (isHost) {
        if (myNum >= 0) Object.assign(gs.sprite[myNum].control, scratch) // 호스트 자신은 세션 경유 없이 직접 반영
        hostSession!.tick()
      } else {
        clientSession!.tick()
        if (clientSession!.myNum !== null) myNum = clientSession!.myNum
      }
      acc -= TICK_MS
      ticks++
    }
    if (ticks === MAX_CATCHUP_TICKS) acc = 0 // 스파이럴 방지(장시간 정지 후 복귀 시 밀린 시간 폐기)
  }
  function renderStep(): void {
    // ── 렌더 동기화 — GostekPool 무수정 재사용, .active 스프라이트 전부 렌더. (백그라운드면 rAF가
    //    멈춰 이 함수는 안 돌지만 simStep은 Worker로 계속 → 매치는 안 멈춘다.)
    gostek.update(gs, myNum)
    entities.update(gs, myNum) // myNum = 내 총알 주황 틴트 대상
    if (myNum >= 0) {
      hud.update(gs, myNum, app.screen.width, app.screen.height)
      hud.showScoreboard(gs, input.isTabHeld(), { pingOf, myNum }) // M5+핑 (방 이름은 좌상단 패널로 이동)
      hud.setMatchInfo({ mapKey: netMapKey, playerCount: Object.keys(a.lobby.players).length, cap: ROOM_CAP, roomLabel: a.lobby.roomKey ?? undefined })
      hud.setRespawnStatus(gs.sprite[myNum]?.deadMeat ? gs.sprite[myNum].respawnCounter : 0, myBoostRemaining())
      skipBtn.update()
      roundEndAd(gs.mapChangeCounter)
      // 스코어보드는 hud.update가 이미 gs.teamScore/kills를 읽어 그린다(스냅샷이 그 값을 덮어씀).
      // C단계 추가: 킬피드는 클라 세션 전용(호스트/오프라인 경로는 스킵 → 봇전 회귀 없음).
      if (clientSession) hud.setKillFeed(gs, clientSession.killFeed)
      const spr = gs.sprite[myNum]
      sound.updateJetpack(spr.control.jetpack && spr.jetsCount > 0, gs.spriteParts.pos[myNum])
      const px = gs.spriteParts.pos[myNum].x
      const py = gs.spriteParts.pos[myNum].y
      camera.update(px, py, input.mouseX, input.mouseY, app.screen.width, app.screen.height)
      world.position.set(app.screen.width / 2 - camera.x, app.screen.height / 2 - camera.y)
      bgLayer.position.set(app.screen.width / 2, app.screen.height / 2 - camera.y)
    }
  }
  stopClock = createSimClock(simStep).stop
  app.ticker.add(renderStep)
}

function fail(err: unknown): void {
  console.error('boot failed:', err)
  const pre = document.createElement('pre')
  pre.style.color = '#f66'
  pre.textContent = `boot failed: ${err instanceof Error ? err.stack : String(err)}`
  document.body.appendChild(pre)
}

// 개발/로컬멀티 데모 — 로비(agent8) 없이 전용 Node 호스트(자체 ws, `npm run host`)에 클라로 직접 접속.
// URL: ?wshost=ws://localhost:8765&acc=alice[&mode=ctf]. 탭 2개를 서로 다른 acc로 열면 실제 대전.
// 배포 없이 넷코드를 눈으로 확인하는 용도(스펙 §3.1-① 전용호스트 + own-ws 플랜B). 항상 클라이언트.
async function startWsClientMatch(url: string, account: string, ctf: boolean): Promise<void> {
  // M8 스코프 밖: ws 데모는 로비가 없어 방 설정이 없다 — 맵/규칙은 전용 호스트(npm run host) args가 결정.
  const { gs, manifest, mapFile } = await loadGameAssets(ctf)
  const { app, world, bgLayer, gostek, entities, hud, sound, input, camera } = await buildScene(gs, mapFile, manifest)
  const transport = makeWsClientTransport(url, account)
  const status = await transport.connect()
  if (status !== 'online') { fail(new Error(`ws host 접속 실패: ${url} — npm run host 실행 확인`)); return }

  const scratch = createScratchControl()
  let currentLocalInput: LocalInput = toLocalInput(scratch)
  const clientSession = new ClientSession(transport, gs, account, () => currentLocalInput)
  let myNum = -1
  ;(window as unknown as Record<string, unknown>).__soldatNet = { gs, net: transport, account }

  // ── M5: 무기선택(림보) 메뉴 — ws 데모는 항상 클라이언트이므로 로컬 예측 + LOADOUT 전송 둘 다.
  const loadout = new LoadoutMenu(gs, () => myNum, manifest, {
    onNetworkPick: (selWeapon, secWep) => clientSession.sendLoadout(selWeapon, secWep),
  })
  const disposeLoadoutHotkeys = loadout.attachHotkeys()

  // ── ESC 오버레이 — ws 데모도 네트 매치(시뮬 계속). LEAVE 시 룸 이탈 + 파라미터 제거 후 메뉴.
  attachEscMenu(app, sound, {
    pausable: false,
    onLeave: () => { disposeLoadoutHotkeys(); void transport.leaveRoom().catch(() => undefined) },
  })

  let acc = 0
  app.ticker.add((ticker) => {
    if (myNum >= 0) { loadout.poll(); input.setMenuOpen(loadout.isOpen()) }
    acc += ticker.deltaMS
    let ticks = 0
    while (acc >= TICK_MS && ticks < MAX_CATCHUP_TICKS) {
      input.applyTo(scratch, camera.x, camera.y, app.screen.width, app.screen.height)
      applySlotSwitch(scratch, gs, myNum, input.consumeSlotSwitch()) // M7: 1/2 무기전환(INPUT 비트로 전달)
      currentLocalInput = toLocalInput(scratch)
      clientSession.tick()
      if (clientSession.myNum !== null) myNum = clientSession.myNum
      acc -= TICK_MS; ticks++
    }
    if (ticks === MAX_CATCHUP_TICKS) acc = 0
    gostek.update(gs, myNum)
    entities.update(gs, myNum) // myNum = 내 총알 주황 틴트 대상
    if (myNum >= 0) {
      hud.update(gs, myNum, app.screen.width, app.screen.height)
      hud.setKillFeed(gs, clientSession.killFeed)
      hud.showScoreboard(gs, input.isTabHeld(), { pingOf: (n) => clientSession.pingOfNum(n), myNum }) // M5+핑
      const spr = gs.sprite[myNum]
      sound.updateJetpack(spr.control.jetpack && spr.jetsCount > 0, gs.spriteParts.pos[myNum])
      camera.update(gs.spriteParts.pos[myNum].x, gs.spriteParts.pos[myNum].y, input.mouseX, input.mouseY, app.screen.width, app.screen.height)
      world.position.set(app.screen.width / 2 - camera.x, app.screen.height / 2 - camera.y)
      bgLayer.position.set(app.screen.width / 2, app.screen.height / 2 - camera.y)
    }
  })
}

// 부트: 로비 경유. ?nolobby=1이면 봇전 직행(개발 편의). ?wshost=…이면 로컬멀티 데모(로비 우회).
// onStartMatch: 온라인이면 네트 인게임(B), 미배포/오프라인이면 봇전 폴백(A단계 그대로).
function boot(): void {
  // 첫 페인트부터 올바른 언어로 렌더되도록 저장된 설정(없으면 자동감지)으로 언어를 먼저 확정한다.
  initLang(loadSettings().lang)
  initAds() // Verse8 Ads SDK 초기화 (SDK 부재/비V8 환경은 내부 폴백)
  // 브라우저 탭 타이틀도 브랜드 단일소스에서 — index.html의 정적 title을 덮는다(리뷰 지적: 사용자 노출 표면).
  document.title = `${GAME_TITLE} — ${GAME_TAGLINE}`
  const params = new URLSearchParams(window.location.search)
  const wshost = params.get('wshost')
  if (wshost) {
    document.body.innerHTML = ''
    startWsClientMatch(wshost, params.get('acc') || 'p' + Math.floor(performance.now() % 100000), params.get('mode') === 'ctf').catch(fail)
    return
  }
  if (params.get('nolobby') === '1') {
    startBotMatch().catch(fail)
    return
  }
  mountLobby(document.body, {
    onStartMatch: (a) => {
      document.body.innerHTML = ''
      if (a.lobby.net.status === 'online') startNetMatch(a).catch(fail)
      else startBotMatch().catch(fail) // 미배포/오프라인 폴백
    },
    onOfflineBots: (mode, mapKey, settings, botCount) => { document.body.innerHTML = ''; startBotMatch(mode, mapKey, settings, botCount).catch(fail) },
    // 메뉴 화면에선 살아있는 SoundSystem이 없음 — 설정은 저장만 되고 인게임 진입 시 적용된다.
    // (인게임 ESC 설정은 attachEscMenu가 live sound에 즉시 반영)
  })
}

boot()
