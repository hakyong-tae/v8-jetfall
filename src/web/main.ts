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
  type BotConfigEntry,
} from '../core/sprites'
import { createWeapons, loadWeaponsConfig, guns, AK74, type WeaponsIniConfig } from '../core/weapons'
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
import { loadManifest, prefetchAnimFiles, fetchBinary, loadTexture } from './assets'
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
import { InputState } from './input'
import { Camera } from './camera'
import { mountLobby, buildSettingsPanel, type StartMatchArg } from './lobby/lobby-ui'
import { injectTheme } from './lobby/ui-theme'
import { loadSettings } from './settings'
import { HostSession, type HostSessionPlayer } from '../net/host-session'
import { ClientSession, type LocalInput } from '../net/client-session'
import { makeWsClientTransport } from '../net/ws-client-transport'
import { decideMigration } from '../net/host-migration'
import { attemptReconnect } from '../net/reconnect'
// (session.ts는 이번 단계에서 main.ts가 직접 소비하지 않음 — §Task4 "독립 seam" 선택, §자체리뷰)
import type { TControl } from '../core/sprites'

const MAP_NAME = 'ctf_ash' // manifest.maps 키
const TICK_MS = 1000 / 60 // 16.6667ms 고정스텝
const MAX_CATCHUP_TICKS = 5
const NUM_BOTS = 4 // DM 봇 수 (CTF는 팀당 절반)

// ── 에셋 + 심 상태 로드 (tests/helpers.ts setupTestGame의 브라우저판). 봇전/네트전 공용.
async function loadGameAssets(ctf: boolean) {
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

  const mapFile = loadMapFile(await fetchBinary(manifest.maps[MAP_NAME]))
  gs.map.loadData(mapFile)
  loadWaypoints(gs.botPath, mapFile.waypoints) // PolyMap.pas:236-255 BotPath 브리지

  // ── 게임모드. CTF면 CTF 깃발 무결성 가드가 첫 틱에 깃발 스폰.
  gs.svGamemode = ctf ? GAMESTYLE_CTF : GAMESTYLE_DEATHMATCH
  gs.svKilllimit = ctf ? 10 : 9999 // DM은 소크 중 라운드 리셋 방지(디버그 편의), CTF는 기본 캡
  return { gs, manifest, mapFile }
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
      <h2 class="jf-h">${o.pausable ? 'Paused' : 'Menu'}</h2>
      ${o.pausable ? '' : '<div class="jf-muted">멀티플레이 중 — 게임은 계속 진행됩니다</div>'}
      <nav class="jf-menu" style="align-items:stretch">
        <button class="jf-menu-item" id="jf-esc-resume">Resume</button>
        <button class="jf-menu-item" id="jf-esc-settings">Settings</button>
        <button class="jf-menu-item" id="jf-esc-leave">Leave to Menu</button>
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

async function startBotMatch(mode?: 'dm' | 'ctf'): Promise<void> {
  // ── 게임모드 — 메뉴 인자 우선, 없으면 URL ?mode=ctf 호환(개발 경로)
  const params = new URLSearchParams(window.location.search)
  const ctf = mode ? mode === 'ctf' : params.get('mode') === 'ctf'
  const { gs, manifest, mapFile } = await loadGameAssets(ctf)

  // ── 플레이어 1명 스폰 (CTF=alpha, DM=무팀)
  const playerTeam = ctf ? TEAM_ALPHA : TEAM_NONE
  const player = createTPlayer()
  player.name = 'Web'
  player.team = playerTeam
  // 로컬 플레이어를 눈에 띄게 — DM에선 셔츠 청록(0x33ccff)으로 자기 병사 식별(CTF에선 팀색이 강제됨).
  player.shirtColor = 0x33ccff
  player.hairStyle = 1
  player.headgear = 0
  const r = randomizeStart(gs, playerTeam)
  const me = createSprite(gs, r.start, vector2(0, 0), 1, 255, player, true)
  if (me < 0) throw new Error('createSprite failed')
  // AK-74 + 보조권총 로드아웃 (respawn이 selWeapon/secWep 규칙대로 지급 — Respawn 3580-3612)
  gs.sprite[me].selWeapon = guns[AK74].num
  gs.sprite[me].player!.secWep = 0
  gs.sprite[me].respawn()

  // ── 봇 스폰 (bots.json). DM=무팀 N기, CTF=팀당 N/2기(플레이어 alpha 보정 위해 bravo 우선).
  const bots = (await (await fetch('/assets/bots.json')).json()) as Record<string, BotConfigEntry>
  const botNames = Object.keys(bots)
  if (ctf) {
    for (let i = 0; i < NUM_BOTS; i++) {
      const team = i % 2 === 0 ? TEAM_BRAVO : TEAM_ALPHA
      addBotPlayer(gs, bots[botNames[i % botNames.length]], team)
    }
  } else {
    for (let i = 0; i < NUM_BOTS; i++) {
      addBotPlayer(gs, bots[botNames[i % botNames.length]], TEAM_NONE)
    }
  }

  // ── PIXI 씬 구성 (봇전/네트전 공용)
  const { app, world, bgLayer, gostek, entities, hud, sound, input, camera } = await buildScene(gs, mapFile, manifest)

  // ── 디버그 오버레이
  const debug = new Text({
    text: '',
    style: { fill: 0xffffff, fontSize: 12, fontFamily: 'monospace' },
  })
  debug.position.set(8, 8)
  app.stage.addChild(debug)

  const spr = gs.sprite[me]

  // 개발 콘솔 디버그 핸들
  ;(window as unknown as Record<string, unknown>).__soldat = {
    gs,
    me,
    camera,
    input,
    app,
    // rAF 스로틀 환경(헤드리스 프리뷰)용 수동 스텝퍼
    step: (n: number) => {
      for (let i = 0; i < n; i++) {
        input.applyTo(spr.control, camera.x, camera.y, app.screen.width, app.screen.height)
        updateFrame(gs)
      }
      gostek.update(gs, me)
      entities.update(gs)
      hud.update(gs, me, app.screen.width, app.screen.height)
      app.render()
    },
  }

  // ── ESC 오버레이 — 오프라인 봇전은 pausable(시뮬 일시정지)
  const esc = attachEscMenu(app, sound, { pausable: true })

  // ── 60Hz 고정스텝 루프 (rAF 누산기, 최대 5틱 캐치업)
  let acc = 0
  app.ticker.add((ticker) => {
    if (esc.paused()) { acc = 0; sound.updateJetpack(false, null); return } // ESC 일시정지 가드
    acc += ticker.deltaMS
    let ticks = 0
    while (acc >= TICK_MS && ticks < MAX_CATCHUP_TICKS) {
      input.applyTo(spr.control, camera.x, camera.y, app.screen.width, app.screen.height)
      updateFrame(gs)
      acc -= TICK_MS
      ticks++
    }
    if (ticks === MAX_CATCHUP_TICKS) acc = 0 // 스파이럴 방지 — 밀린 시간 폐기

    // ── 렌더 동기화 (맵/프롭은 정적, 병사·탄환·씽·HUD·카메라 갱신)
    gostek.update(gs, me)
    entities.update(gs)
    hud.update(gs, me, app.screen.width, app.screen.height)

    // 제트팩 루프음 — 로컬 병사가 제트 분사 중일 때만 (Control.pas 클라 전용 루프 배선).
    sound.updateJetpack(spr.control.jetpack && spr.jetsCount > 0, gs.spriteParts.pos[me])

    const px = gs.spriteParts.pos[me].x
    const py = gs.spriteParts.pos[me].y
    camera.update(px, py, input.mouseX, input.mouseY, app.screen.width, app.screen.height)

    world.position.set(app.screen.width / 2 - camera.x, app.screen.height / 2 - camera.y)
    bgLayer.position.set(app.screen.width / 2, app.screen.height / 2 - camera.y)

    debug.text =
      `FPS ${ticker.FPS.toFixed(0)}\n` +
      `pos ${px.toFixed(1)}, ${py.toFixed(1)}\n` +
      `onGround ${spr.onGround}\n` +
      `jets ${spr.jetsCount}`
  })
}

// ── 네트 인게임 (호스트권위 이동 동기화, B단계). 씬 구성은 봇전과 공유(buildScene),
// 차이는 스폰(HostSession.spawnPlayers vs 로컬 1인)과 루프 본문(host.tick/client.tick)뿐.
async function startNetMatch(a: StartMatchArg): Promise<void> {
  const ctf = a.mode === GAMESTYLE_CTF
  const { gs, manifest, mapFile } = await loadGameAssets(ctf)
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

  if (isHost) {
    hostSession = new HostSession(transport, gs)
    const players: HostSessionPlayer[] = Object.entries(a.lobby.players)
      .map(([acc, p]) => ({ account: acc, team: p.team }))
    hostSession.spawnPlayers(players)
    myNum = hostSession.spriteNumOf(account) ?? -1
  } else {
    clientSession = new ClientSession(transport, gs, account, () => currentLocalInput)
  }

  // ── M3-E: 마이그레이션 감시 + 재접속 감시 + 오프라인 폴백(매 프레임 저비용 값 비교) ──
  let reconnecting = false
  let degraded = false
  function degradeToOfflineBots(reason: string): void {
    if (degraded) return
    degraded = true
    console.warn(`[net] falling back to offline bots: ${reason}`)
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
    void transport.updateRoomState({ hostAccount: account, hostEpoch: myEpoch })
  }

  // §설계결정5 수동우회용 디버그 훅(전용호스트 Plan-B의 dedicatedHostUrl 수동기록 등).
  ;(window as unknown as Record<string, unknown>).__soldatNet = { lobby: a.lobby, gs, net: transport }

  // ── ESC 오버레이 — 네트 매치는 시뮬 계속(공정성), 오버레이만. LEAVE 시 룸 이탈.
  const esc = attachEscMenu(app, sound, {
    pausable: false,
    onLeave: () => {
      void a.lobby.leave().catch(() => undefined)
      if (dedicatedUrl) void transport.leaveRoom().catch(() => undefined)
    },
  })

  // ── 60Hz 고정스텝 루프 (rAF 누산기, 최대 5틱 캐치업)
  let acc = 0
  app.ticker.add((ticker) => {
    checkMigrationAndReconnect() // ← M3-E 신규 감시 훅, 루프 나머지는 기존 그대로
    acc += ticker.deltaMS
    let ticks = 0
    while (acc >= TICK_MS && ticks < MAX_CATCHUP_TICKS) {
      input.applyTo(scratch, camera.x, camera.y, app.screen.width, app.screen.height)
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
    if (ticks === MAX_CATCHUP_TICKS) acc = 0 // 스파이럴 방지

    // ── 렌더 동기화 — GostekPool 무수정 재사용, .active 스프라이트 전부 렌더
    gostek.update(gs, myNum)
    entities.update(gs)
    if (myNum >= 0) {
      hud.update(gs, myNum, app.screen.width, app.screen.height)
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
  })
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

  // ── ESC 오버레이 — ws 데모도 네트 매치(시뮬 계속). LEAVE 시 룸 이탈 + 파라미터 제거 후 메뉴.
  attachEscMenu(app, sound, { pausable: false, onLeave: () => void transport.leaveRoom().catch(() => undefined) })

  let acc = 0
  app.ticker.add((ticker) => {
    acc += ticker.deltaMS
    let ticks = 0
    while (acc >= TICK_MS && ticks < MAX_CATCHUP_TICKS) {
      input.applyTo(scratch, camera.x, camera.y, app.screen.width, app.screen.height)
      currentLocalInput = toLocalInput(scratch)
      clientSession.tick()
      if (clientSession.myNum !== null) myNum = clientSession.myNum
      acc -= TICK_MS; ticks++
    }
    if (ticks === MAX_CATCHUP_TICKS) acc = 0
    gostek.update(gs, myNum)
    entities.update(gs)
    if (myNum >= 0) {
      hud.update(gs, myNum, app.screen.width, app.screen.height)
      hud.setKillFeed(gs, clientSession.killFeed)
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
    onOfflineBots: (mode) => { document.body.innerHTML = ''; startBotMatch(mode).catch(fail) },
    // 메뉴 화면에선 살아있는 SoundSystem이 없음 — 설정은 저장만 되고 인게임 진입 시 적용된다.
    // (인게임 ESC 설정은 attachEscMenu가 live sound에 즉시 반영)
  })
}

boot()
