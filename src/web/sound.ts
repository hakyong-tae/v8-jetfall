// WebAudio 사운드 — core의 gs.playSound(sfxId, pos) 훅 배선 (규약 11).
// SFX 인덱스→파일명 표는 client/Sound.pas SAMPLE_FILES(1..MAX_SAMPLES)를 그대로 옮긴다.
// core가 넘기는 sfxId는 constants.ts의 SFX_* 상수 값(1-based)이며, 이 배열 인덱스와 일치한다.
//
// M2 기초 범위: 무기별 발사음/폭발/리코셰/픽업/캡처 + 거리 감쇠(카메라 기준 선형 근사).
// 전 채널 믹싱/피치/도플러/스테레오 패닝은 M4.
import type { GameState } from '../core/state'
import type { Manifest } from './assets'
import type { TVector2 } from '../core/vector'
import type { Camera } from './camera'

// client/Sound.pas SAMPLE_FILES — 1-based. 인덱스 0은 미사용(패딩), 인덱스 4는 원본에서 ''(empty.wav).
// 값 = 확장자 뺀 manifest.sfx 키(소문자). radio/ 하위폴더 유지.
const SAMPLE_KEYS: (string | null)[] = [
  null, // 0 — 패딩 (SFX_* 상수는 1부터)
  'ak74-fire', // 1  SFX_AK74_FIRE
  'rocketz', // 2  SFX_ROCKETZ
  'ak74-reload', // 3  SFX_AK74_RELOAD
  null, // 4  (empty.wav — 미사용)
  'm249-fire', // 5  SFX_M249_FIRE
  'ruger77-fire', // 6  SFX_RUGER77_FIRE
  'ruger77-reload', // 7  SFX_RUGER77_RELOAD
  'm249-reload', // 8  SFX_M249_RELOAD
  'mp5-fire', // 9  SFX_MP5_FIRE
  'mp5-reload', // 10 SFX_MP5_RELOAD
  'spas12-fire', // 11 SFX_SPAS12_FIRE
  'spas12-reload', // 12 SFX_SPAS12_RELOAD
  'standup', // 13 SFX_STANDUP
  'fall', // 14 SFX_FALL
  'spawn', // 15 SFX_SPAWN
  'm79-fire', // 16 SFX_M79_FIRE
  'm79-explosion', // 17 SFX_M79_EXPLOSION
  'm79-reload', // 18 SFX_M79_RELOAD
  'grenade-throw', // 19 SFX_GRENADE_THROW
  'grenade-explosion', // 20 SFX_GRENADE_EXPLOSION
  'grenade-bounce', // 21 SFX_GRENADE_BOUNCE
  'bryzg', // 22 SFX_BRYZG
  'infiltmus', // 23 SFX_INFILTMUS
  'headchop', // 24 SFX_HEADCHOP
  'explosion-erg', // 25 SFX_EXPLOSION_ERG
  'water-step', // 26 SFX_WATER_STEP
  'bulletby', // 27 SFX_BULLETBY
  'bodyfall', // 28 SFX_BODYFALL
  'deserteagle-fire', // 29 SFX_DESERTEAGLE_FIRE
  'deserteagle-reload', // 30 SFX_DESERTEAGLE_RELOAD
  'steyraug-fire', // 31 SFX_STEYRAUG_FIRE
  'steyraug-reload', // 32 SFX_STEYRAUG_RELOAD
  'barretm82-fire', // 33 SFX_BARRETM82_FIRE
  'barretm82-reload', // 34 SFX_BARRETM82_RELOAD
  'minigun-fire', // 35 SFX_MINIGUN_FIRE
  'minigun-reload', // 36 SFX_MINIGUN_RELOAD
  'minigun-start', // 37 SFX_MINIGUN_START
  'minigun-end', // 38 SFX_MINIGUN_END
  'pickupgun', // 39 SFX_PICKUPGUN
  'capture', // 40 SFX_CAPTURE
  'colt1911-fire', // 41 SFX_COLT1911_FIRE
  'colt1911-reload', // 42 SFX_COLT1911_RELOAD
  'changeweapon', // 43 SFX_CHANGEWEAPON
  'shell', // 44 SFX_SHELL
  'shell2', // 45 SFX_SHELL2
  'dead-hit', // 46 SFX_DEAD_HIT
  'throwgun', // 47 SFX_THROWGUN
  'bow-fire', // 48 SFX_BOW_FIRE
  'takebow', // 49 SFX_TAKEBOW
  'takemedikit', // 50 SFX_TAKEMEDIKIT
  'wermusic', // 51 SFX_WERMUSIC
  'ts', // 52 SFX_TS
  'ctf', // 53 SFX_CTF
  'berserker', // 54 SFX_BERSERKER
  'godflame', // 55 SFX_GODFLAME
  'flamer', // 56 SFX_FLAMER
  'predator', // 57 SFX_PREDATOR
  'killberserk', // 58 SFX_KILLBERSERK
  'vesthit', // 59 SFX_VESTHIT
  'burn', // 60 SFX_BURN
  'vesttake', // 61 SFX_VESTTAKE
  'clustergrenade', // 62 SFX_CLUSTERGRENADE
  'cluster-explosion', // 63 SFX_CLUSTER_EXPLOSION
  'grenade-pullout', // 64 SFX_GRENADE_PULLOUT
  'spit', // 65 SFX_SPIT
  'stuff', // 66 SFX_STUFF
  'smoke', // 67 SFX_SMOKE
  'match', // 68 SFX_MATCH
  'roar', // 69 SFX_ROAR
  'step', // 70 SFX_STEP
  'step2', // 71 SFX_STEP2
  'step3', // 72 SFX_STEP3
  'step4', // 73 SFX_STEP4
  'hum', // 74 SFX_HUM
  'ric', // 75 SFX_RIC
  'ric2', // 76 SFX_RIC2
  'ric3', // 77 SFX_RIC3
  'ric4', // 78 SFX_RIC4
  'dist-m79', // 79 SFX_DIST_M79
  'dist-grenade', // 80 SFX_DIST_GRENADE
  'dist-gun1', // 81 SFX_DIST_GUN1
  'dist-gun2', // 82 SFX_DIST_GUN2
  'dist-gun3', // 83 SFX_DIST_GUN3
  'dist-gun4', // 84 SFX_DIST_GUN4
  'death', // 85 SFX_DEATH
  'death2', // 86 SFX_DEATH2
  'death3', // 87 SFX_DEATH3
  'crouch-move', // 88 SFX_CROUCH_MOVE
  'hit-arg', // 89 SFX_HIT_ARG
  'hit-arg2', // 90 SFX_HIT_ARG2
  'hit-arg3', // 91 SFX_HIT_ARG3
  'goprone', // 92 SFX_GOPRONE
  'roll', // 93 SFX_ROLL
  'fall-hard', // 94 SFX_FALL_HARD
  'onfire', // 95 SFX_ONFIRE
  'firecrack', // 96 SFX_FIRECRACK
  'scope', // 97 SFX_SCOPE
  'scopeback', // 98 SFX_SCOPEBACK
  'playerdeath', // 99 SFX_PLAYERDEATH
  'changespin', // 100 SFX_CHANGESPIN
  'arg', // 101 SFX_ARG
  'lava', // 102 SFX_LAVA
  'regenerate', // 103 SFX_REGENERATE
  'prone-move', // 104 SFX_PRONE_MOVE
  'jump', // 105 SFX_JUMP
  'crouch', // 106 SFX_CROUCH
  'crouch-movel', // 107 SFX_CROUCH_MOVEL
  'step5', // 108 SFX_STEP5
  'step6', // 109 SFX_STEP6
  'step7', // 110 SFX_STEP7
  'step8', // 111 SFX_STEP8
  'stop', // 112 SFX_STOP
  'bulletby2', // 113 SFX_BULLETBY2
  'bulletby3', // 114 SFX_BULLETBY3
  'bulletby4', // 115 SFX_BULLETBY4
  'bulletby5', // 116 SFX_BULLETBY5
  'weaponhit', // 117 SFX_WEAPONHIT
  'clipfall', // 118 SFX_CLIPFALL
  'bonecrack', // 119 SFX_BONECRACK
  'gaugeshell', // 120 SFX_GAUGESHELL
  'colliderhit', // 121 SFX_COLLIDERHIT
  'kit-fall', // 122 SFX_KIT_FALL
  'kit-fall2', // 123 SFX_KIT_FALL2
  'flag', // 124 SFX_FLAG
  'flag2', // 125 SFX_FLAG2
  'takegun', // 126 SFX_TAKEGUN
  'infilt-point', // 127 SFX_INFILT_POINT
  'menuclick', // 128 SFX_MENUCLICK
  'knife', // 129 SFX_KNIFE
  'slash', // 130 SFX_SLASH
  'chainsaw-d', // 131 SFX_CHAINSAW_D
  'chainsaw-m', // 132 SFX_CHAINSAW_M
  'chainsaw-r', // 133 SFX_CHAINSAW_R
  'piss', // 134 SFX_PISS
  'law', // 135 SFX_LAW
  'chainsaw-o', // 136 SFX_CHAINSAW_O
  'm2fire', // 137 SFX_M2FIRE
  'm2explode', // 138 SFX_M2EXPLODE
  'm2overheat', // 139 SFX_M2OVERHEAT
  'signal', // 140 SFX_SIGNAL
  'm2use', // 141 SFX_M2USE
  'scoperun', // 142 SFX_SCOPERUN
  'mercy', // 143 SFX_MERCY
  'ric5', // 144 SFX_RIC5
  'ric6', // 145 SFX_RIC6
  'ric7', // 146 SFX_RIC7
  'law-start', // 147 SFX_LAW_START
  'law-end', // 148 SFX_LAW_END
  'boomheadshot', // 149 SFX_BOOMHEADSHOT
  'snapshot', // 150 SFX_SNAPSHOT
  'radio/efcup', // 151 SFX_RADIO_EFCUP
  'radio/efcmid', // 152 SFX_RADIO_EFCMID
  'radio/efcdown', // 153 SFX_RADIO_EFCDOWN
  'radio/ffcup', // 154 SFX_RADIO_FFCUP
  'radio/ffcmid', // 155 SFX_RADIO_FFCMID
  'radio/ffcdown', // 156 SFX_RADIO_FFCDOWN
  'radio/esup', // 157 SFX_RADIO_ESUP
  'radio/esmid', // 158 SFX_RADIO_ESMID
  'radio/esdown', // 159 SFX_RADIO_ESDOWN
  'bounce', // 160 SFX_BOUNCE
  'sfx_rain', // 161 SFX_RAIN
  'sfx_snow', // 162 SFX_SNOW
  'sfx_wind', // 163 SFX_WIND
]

// M2 기초에서 실제로 재생할 SFX 세트 — 발사음(무기별)/폭발/리코셰/픽업/캡처/피격/사망.
// 여기 없는 id는 로드/재생을 건너뛴다(스텝음 등 도배성 SFX는 M4에서 폴리시).
const ENABLED_SFX = new Set<number>([
  2, // SFX_ROCKETZ — 제트팩 루프음 (updateJetpack이 사용)
  1, 5, 6, 9, 11, 16, 17, 20, 21, 29, 31, 33, 35, 41, 48, // 발사·리로드·폭발
  55, 56, // godflame/flamer
  17, 20, 25, 63, 138, // 폭발류
  75, 76, 77, 78, 144, 145, 146, // 리코셰
  39, 40, 50, 126, // 픽업/캡처/메디킷/takegun
  22, 24, 46, 59, 85, 86, 87, 99, // 피격/사망/헤드샷/베스트
  19, 64, 135, // 수류탄/law
  124, 125, // 깃발
])

const DIST_MAX = 900 // 이 거리(월드px) 밖은 무음 (선형 감쇠)

export class SoundSystem {
  private ctx: AudioContext | null = null
  private buffers = new Map<number, AudioBuffer>()
  private camera: Camera | null = null
  private manifest: Manifest
  private assetRoot: string
  // WebAudio는 사용자 제스처 전엔 suspend 상태 — 실제 제스처(pointerdown/keydown)에 바인딩해 resume.
  private resumed = false
  private gestureBound = false
  // 제트팩 루프 소스/게인 (updateJetpack이 관리)
  private jetSrc: AudioBufferSourceNode | null = null
  private jetGain: GainNode | null = null

  constructor(manifest: Manifest, assetRoot = '/assets') {
    this.manifest = manifest
    this.assetRoot = assetRoot
  }

  // AudioContext resume을 '진짜' 사용자 제스처에 바인딩한다. 봇이 유저 클릭 전에 발사해도
  // resumed 플래그가 잘못 latch되지 않도록, ctx.state==='running'이 확인될 때만 resumed=true.
  // ctx가 아직 없으면 이 제스처에서 지연 생성한다. (main.ts가 캔버스 준비 후 1회 호출)
  bindResumeGestures(target?: HTMLElement | null): void {
    if (this.gestureBound || typeof window === 'undefined') return
    this.gestureBound = true
    const resumeOnce = (): void => {
      if (!this.ctx) {
        try {
          this.ctx = new AudioContext()
        } catch {
          this.ctx = null
          return
        }
      }
      const ctx = this.ctx
      if (!ctx) return
      void ctx.resume().then(() => {
        if (ctx.state === 'running') this.resumed = true
      })
    }
    const opts: AddEventListenerOptions = { once: true }
    window.addEventListener('pointerdown', resumeOnce, opts)
    window.addEventListener('keydown', resumeOnce, opts)
    if (target) {
      target.addEventListener('pointerdown', resumeOnce, opts)
      target.addEventListener('keydown', resumeOnce, opts)
    }
  }

  // 테스트/디버그용 — resume 성사 여부 확인.
  get isResumed(): boolean {
    return this.resumed
  }
  get contextState(): string {
    return this.ctx?.state ?? 'none'
  }

  // ENABLED_SFX 세트만 디코드해 버퍼 캐시에 적재. (전 157종 프리로드는 대역폭 낭비이므로 지연 로드 가능하나
  // 여기선 소수 세트라 일괄 프리로드.) AudioContext는 첫 상호작용 후 생성한다.
  async init(camera: Camera): Promise<void> {
    this.camera = camera
    try {
      this.ctx = new AudioContext()
    } catch {
      this.ctx = null
      return // WebAudio 미지원 환경 — 무음으로 진행
    }
    const ctx = this.ctx
    await Promise.all(
      [...ENABLED_SFX].map(async (id) => {
        const key = SAMPLE_KEYS[id]
        if (!key) return
        const rel = this.manifest.sfx[key]
        if (!rel) return
        try {
          const res = await fetch(`${this.assetRoot}/${rel}`)
          if (!res.ok) return
          const buf = await ctx.decodeAudioData(await res.arrayBuffer())
          this.buffers.set(id, buf)
        } catch {
          // 개별 파일 실패는 무시 (해당 SFX만 무음)
        }
      }),
    )
  }

  // gs.playSound 훅에 배선할 콜백을 돌려준다.
  makeHook(): (sfxId: number, pos: TVector2) => void {
    return (sfxId, pos) => this.play(sfxId, pos)
  }

  // 카메라 기준 선형 거리 감쇠 (원본은 FMOD 3D — 여기선 2D 근사). 0이면 무음(스킵 신호).
  private distanceGain(pos: TVector2 | null): number {
    if (!this.camera || !pos) return 1
    const dx = pos.x - this.camera.x
    const dy = pos.y - this.camera.y
    const dist = Math.sqrt(dx * dx + dy * dy)
    return Math.max(0, 1 - dist / DIST_MAX)
  }

  private play(sfxId: number, pos: TVector2): void {
    if (!this.ctx) return
    const buf = this.buffers.get(sfxId)
    if (!buf) return // 미활성/미로드 SFX
    // resume은 제스처 리스너(bindResumeGestures)가 담당 — 여기선 latch하지 않는다. suspend 상태면
    // start()는 조용히 무시되며, 이후 사용자가 클릭해 running이 되면 정상 재생된다.

    const gain = this.distanceGain(pos)
    if (gain <= 0) return

    const src = this.ctx.createBufferSource()
    src.buffer = buf
    const g = this.ctx.createGain()
    g.gain.value = gain * 0.6 // 헤드룸
    src.connect(g).connect(this.ctx.destination)
    src.start()
  }

  // 제트팩 루프음 (Control.pas:379/385 PlaySound(SFX_ROCKETZ,..,JetsSoundChannel) 상당 — 클라 전용).
  // active면 SFX_ROCKETZ(id 2)를 루프 BufferSource로 시작, 아니면 정지. 매 프레임 거리 게인 갱신.
  updateJetpack(active: boolean, pos: TVector2 | null): void {
    if (!this.ctx) return
    const buf = this.buffers.get(2) // SFX_ROCKETZ
    const gain = active ? this.distanceGain(pos) : 0

    if (active && buf && this.ctx.state === 'running') {
      if (!this.jetSrc) {
        const src = this.ctx.createBufferSource()
        src.buffer = buf
        src.loop = true
        const g = this.ctx.createGain()
        g.gain.value = gain * 0.5
        src.connect(g).connect(this.ctx.destination)
        src.start()
        this.jetSrc = src
        this.jetGain = g
      } else if (this.jetGain) {
        this.jetGain.gain.value = gain * 0.5 // 거리 게인 갱신
      }
    } else if (this.jetSrc) {
      try {
        this.jetSrc.stop()
      } catch {
        // 이미 정지됨 — 무시
      }
      this.jetSrc.disconnect()
      this.jetSrc = null
      this.jetGain = null
    }
  }
}

// core의 gs.playSound에 배선. init 이후 호출.
export function wireSound(gs: GameState, sound: SoundSystem): void {
  gs.playSound = sound.makeHook()
}
