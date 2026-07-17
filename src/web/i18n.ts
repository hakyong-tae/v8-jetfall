// src/web/i18n.ts — UI 다국어(i18n) 단일 소스 (스펙: docs/superpowers/specs/2026-07-15-i18n-localization-design.md).
// 영어 기본 + 한국어/중국어(간체)/스페인어/포르투갈어. UI chrome 문구만 대상 — 고유명사(게임명·무기명·
// 맵명·팀명 Alpha/Bravo)·라이선스 본문은 원문 유지. STRINGS.en이 기준 키셋이며 나머지 언어는 동일 키를
// 전부 채운다(누락 시 en 폴백). 언어 상태는 모듈 전역, 변경은 settings.ts에 영속 + 구독자 통지.
import { loadSettings, saveSettings } from './settings'

export type Lang = 'en' | 'ko' | 'zh' | 'es' | 'pt'

// 선택기용 목록 — label은 각 언어의 자칭(endonym).
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'ko', label: '한국어' },
  { code: 'zh', label: '中文' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
]

// en을 기준 레코드로 삼아 StringKey를 파생 — 나머지 언어는 동일 키를 강제(Record<Lang, Record<StringKey,string>>).
const EN = {
  'menu.playOnline': 'Play Online',
  'menu.offlineBots': 'Offline Bots',
  'menu.settings': 'Settings',
  'menu.credits': 'Credits',
  'title.pressAnyKey': 'PRESS ANY KEY',
  'title.tagline': '2D JETPACK COMBAT',
  'offline.header': 'OFFLINE BOTS',
  'offline.map': 'Map',
  'offline.random': 'Random',
  'offline.respawnTime': 'Respawn Time',
  'offline.start': 'Start Match',
  'mode.dm': 'Deathmatch',
  'mode.ctf': 'Capture the Flag',
  'common.back': 'Back',
  'settings.sfxVolume': 'SFX Volume',
  'settings.mute': 'Mute',
  'settings.language': 'Language',
  'credits.heading': 'Credits',
  'lobby.joinInProgress': 'Join (live)',
  'lobby.inProgress': 'In progress',
  'lobby.noRooms': 'No open rooms — create one',
  'lobby.full': 'Full',
  'room.ready': 'Ready',
  'room.settings': 'Match Settings',
  'room.weapons': 'Weapons',
  'room.killLimit': 'Target Kills',
  'room.capLimit': 'Target Captures',
  'room.timeLimit': 'Time Limit',
  'room.unlimited': 'Unlimited',
  'room.saveFailed': 'Save failed — check connection and try again',
  'sb.name': 'Name',
  'sb.team': 'Team',
  'sb.kills': 'Kills',
  'sb.deaths': 'Deaths',
  'sb.caps': 'Caps',
  'sb.goal': 'Goal',
  'sb.ping': 'Ping',
  'ad.skipRespawn': 'Watch ad — respawn now',
  'hud.kills': 'Kills',
  'loadout.primary': 'Primary',
  'loadout.secondary': 'Secondary',
  'loadout.hint': 'Click to equip — Q toggle, Esc close',
  'esc.paused': 'Paused',
  'esc.menu': 'Menu',
  'esc.resume': 'Resume',
  'esc.leave': 'Leave to Menu',
} as const

export type StringKey = keyof typeof EN

const KO: Record<StringKey, string> = {
  'menu.playOnline': '온라인 플레이',
  'menu.offlineBots': '오프라인 봇전',
  'menu.settings': '설정',
  'menu.credits': '제작진',
  'title.pressAnyKey': '아무 키나 누르세요',
  'title.tagline': '2D 제트팩 전투',
  'offline.header': '오프라인 봇전',
  'offline.map': '맵',
  'offline.random': '랜덤',
  'offline.respawnTime': '리스폰 시간',
  'offline.start': '게임 시작',
  'mode.dm': '데스매치',
  'mode.ctf': '깃발 뺏기',
  'common.back': '뒤로',
  'settings.sfxVolume': '효과음 볼륨',
  'settings.mute': '음소거',
  'settings.language': '언어',
  'credits.heading': '제작진',
  'lobby.joinInProgress': '난입',
  'lobby.inProgress': '진행중',
  'lobby.noRooms': '열린 방 없음 — 방을 만들어 보세요',
  'lobby.full': '만원',
  'room.ready': '준비',
  'room.settings': '매치 설정',
  'room.weapons': '무기',
  'room.killLimit': '목표 킬수',
  'room.capLimit': '목표 캡처수',
  'room.timeLimit': '시간 제한',
  'room.unlimited': '무제한',
  'room.saveFailed': '저장 실패 — 연결 확인 후 다시 시도하세요',
  'sb.name': '이름',
  'sb.team': '팀',
  'sb.kills': '킬',
  'sb.deaths': '데스',
  'sb.caps': '캡처',
  'sb.goal': '목표',
  'sb.ping': '핑',
  'ad.skipRespawn': '광고 보고 바로 리스폰',
  'hud.kills': '킬',
  'loadout.primary': '주무기',
  'loadout.secondary': '부무기',
  'loadout.hint': '클릭하여 장착 — Q 토글, Esc 닫기',
  'esc.paused': '일시정지',
  'esc.menu': '메뉴',
  'esc.resume': '계속하기',
  'esc.leave': '메뉴로 나가기',
}

const ZH: Record<StringKey, string> = {
  'menu.playOnline': '在线游戏',
  'menu.offlineBots': '离线人机',
  'menu.settings': '设置',
  'menu.credits': '制作人员',
  'title.pressAnyKey': '按任意键继续',
  'title.tagline': '2D 喷气背包战斗',
  'offline.header': '离线人机',
  'offline.map': '地图',
  'offline.random': '随机',
  'offline.respawnTime': '重生时间',
  'offline.start': '开始比赛',
  'mode.dm': '死亡竞赛',
  'mode.ctf': '夺旗',
  'common.back': '返回',
  'settings.sfxVolume': '音效音量',
  'settings.mute': '静音',
  'settings.language': '语言',
  'credits.heading': '制作人员',
  'lobby.joinInProgress': '加入(进行中)',
  'lobby.inProgress': '进行中',
  'lobby.noRooms': '暂无房间 — 创建一个吧',
  'lobby.full': '已满',
  'room.ready': '准备',
  'room.settings': '比赛设置',
  'room.weapons': '武器',
  'room.killLimit': '目标击杀数',
  'room.capLimit': '目标夺旗数',
  'room.timeLimit': '时间限制',
  'room.unlimited': '无限制',
  'room.saveFailed': '保存失败 — 请检查连接后重试',
  'sb.name': '名称',
  'sb.team': '队伍',
  'sb.kills': '击杀',
  'sb.deaths': '死亡',
  'sb.caps': '夺旗',
  'sb.goal': '目标',
  'sb.ping': '延迟',
  'ad.skipRespawn': '看广告立即重生',
  'hud.kills': '击杀',
  'loadout.primary': '主武器',
  'loadout.secondary': '副武器',
  'loadout.hint': '点击装备 — Q 切换，Esc 关闭',
  'esc.paused': '已暂停',
  'esc.menu': '菜单',
  'esc.resume': '继续',
  'esc.leave': '返回菜单',
}

const ES: Record<StringKey, string> = {
  'menu.playOnline': 'Jugar en línea',
  'menu.offlineBots': 'Bots sin conexión',
  'menu.settings': 'Ajustes',
  'menu.credits': 'Créditos',
  'title.pressAnyKey': 'PRESIONA UNA TECLA',
  'title.tagline': 'COMBATE JETPACK 2D',
  'offline.header': 'BOTS SIN CONEXIÓN',
  'offline.map': 'Mapa',
  'offline.random': 'Aleatorio',
  'offline.respawnTime': 'Tiempo de reaparición',
  'offline.start': 'Iniciar partida',
  'mode.dm': 'Duelo a muerte',
  'mode.ctf': 'Captura la bandera',
  'common.back': 'Atrás',
  'settings.sfxVolume': 'Volumen de efectos',
  'settings.mute': 'Silenciar',
  'settings.language': 'Idioma',
  'credits.heading': 'Créditos',
  'lobby.joinInProgress': 'Unirse (en curso)',
  'lobby.inProgress': 'En curso',
  'lobby.noRooms': 'No hay salas abiertas — crea una',
  'lobby.full': 'Llena',
  'room.ready': 'Listo',
  'room.settings': 'Ajustes de partida',
  'room.weapons': 'Armas',
  'room.killLimit': 'Objetivo de bajas',
  'room.capLimit': 'Objetivo de capturas',
  'room.timeLimit': 'Límite de tiempo',
  'room.unlimited': 'Ilimitado',
  'room.saveFailed': 'Error al guardar — revisa la conexión e inténtalo de nuevo',
  'sb.name': 'Nombre',
  'sb.team': 'Equipo',
  'sb.kills': 'Bajas',
  'sb.deaths': 'Muertes',
  'sb.caps': 'Capturas',
  'sb.goal': 'Meta',
  'sb.ping': 'Ping',
  'ad.skipRespawn': 'Ver anuncio y reaparecer ya',
  'hud.kills': 'Bajas',
  'loadout.primary': 'Primaria',
  'loadout.secondary': 'Secundaria',
  'loadout.hint': 'Clic para equipar — Q alternar, Esc cerrar',
  'esc.paused': 'En pausa',
  'esc.menu': 'Menú',
  'esc.resume': 'Reanudar',
  'esc.leave': 'Salir al menú',
}

const PT: Record<StringKey, string> = {
  'menu.playOnline': 'Jogar online',
  'menu.offlineBots': 'Bots offline',
  'menu.settings': 'Configurações',
  'menu.credits': 'Créditos',
  'title.pressAnyKey': 'PRESSIONE QUALQUER TECLA',
  'title.tagline': 'COMBATE JETPACK 2D',
  'offline.header': 'BOTS OFFLINE',
  'offline.map': 'Mapa',
  'offline.random': 'Aleatório',
  'offline.respawnTime': 'Tempo de renascimento',
  'offline.start': 'Iniciar partida',
  'mode.dm': 'Mata-mata',
  'mode.ctf': 'Captura a bandeira',
  'common.back': 'Voltar',
  'settings.sfxVolume': 'Volume de efeitos',
  'settings.mute': 'Silenciar',
  'settings.language': 'Idioma',
  'credits.heading': 'Créditos',
  'lobby.joinInProgress': 'Entrar (em andamento)',
  'lobby.inProgress': 'Em andamento',
  'lobby.noRooms': 'Nenhuma sala aberta — crie uma',
  'lobby.full': 'Cheia',
  'room.ready': 'Pronto',
  'room.settings': 'Configurações da partida',
  'room.weapons': 'Armas',
  'room.killLimit': 'Meta de abates',
  'room.capLimit': 'Meta de capturas',
  'room.timeLimit': 'Limite de tempo',
  'room.unlimited': 'Ilimitado',
  'room.saveFailed': 'Falha ao salvar — verifique a conexão e tente novamente',
  'sb.name': 'Nome',
  'sb.team': 'Equipe',
  'sb.kills': 'Abates',
  'sb.deaths': 'Mortes',
  'sb.caps': 'Capturas',
  'sb.goal': 'Meta',
  'sb.ping': 'Ping',
  'ad.skipRespawn': 'Assistir anúncio e renascer já',
  'hud.kills': 'Abates',
  'loadout.primary': 'Primária',
  'loadout.secondary': 'Secundária',
  'loadout.hint': 'Clique para equipar — Q alternar, Esc fechar',
  'esc.paused': 'Pausado',
  'esc.menu': 'Menu',
  'esc.resume': 'Continuar',
  'esc.leave': 'Sair para o menu',
}

export const STRINGS: Record<Lang, Record<StringKey, string>> = {
  en: EN,
  ko: KO,
  zh: ZH,
  es: ES,
  pt: PT,
}

// ── 언어 상태 (모듈 전역) ─────────────────────────────────────────────────────
let current: Lang = 'en'
const listeners = new Set<(l: Lang) => void>()

export function isLang(v: unknown): v is Lang {
  return v === 'en' || v === 'ko' || v === 'zh' || v === 'es' || v === 'pt'
}

export function getLang(): Lang {
  return current
}

// 언어 변경 + settings 영속 + 구독자 통지. (메뉴에서만 호출 — 인게임 실시간 전환은 스코프 밖.)
export function setLang(l: Lang): void {
  current = l
  try {
    const s = loadSettings()
    saveSettings({ ...s, lang: l })
  } catch {
    // 스토리지 불가 — 세션 한정 동작
  }
  for (const fn of listeners) fn(l)
}

export function onLangChange(fn: (l: Lang) => void): () => void {
  listeners.add(fn)
  return () => void listeners.delete(fn)
}

// navigator.language 접두로 자동감지 (테스트/노드 환경 대비 guard). 명시 값을 넘기면 그걸 파싱.
export function detectLang(nav?: string): Lang {
  let raw = nav
  if (raw === undefined && typeof navigator !== 'undefined') raw = navigator.language
  const prefix = (raw ?? 'en').toLowerCase().split('-')[0]
  if (prefix === 'ko' || prefix === 'zh' || prefix === 'es' || prefix === 'pt') return prefix
  return 'en'
}

// 부팅 시 초기 언어 결정: 저장된 설정 우선, 없으면 브라우저 자동감지.
export function initLang(settingsLang?: string): Lang {
  current = isLang(settingsLang) ? settingsLang : detectLang()
  return current
}

// 조회 — 현재 언어에서 찾고, 없으면 en 폴백, 그래도 없으면 키 원문.
export function t(key: StringKey): string {
  return STRINGS[current][key] ?? STRINGS.en[key] ?? key
}
