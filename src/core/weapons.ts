// 1:1 포팅: soldat-ref/soldat/shared/Weapons.pas (1518 lines)
// + SharedConfig.pas:222-291 LoadWeaponsConfig/ReadWMConf (ini→Guns[] 오버라이드 로직만 발췌).
//
// 모듈 전역 예외 (M2 공통 포팅 규약 14, plan Task 1 Step 2): `guns`/`defaultGuns`는 Pascal
// 유닛 전역(`var Guns: array[1..TOTAL_WEAPONS] of TGun`)이지만, 무기 테이블은 심 인스턴스 간
// 공유해도 안전한 불변 데이터(사용자 입력/네트워크 상태를 담지 않음)이므로 M1/M2 GameState 승격
// 규약의 예외로 모듈 전역을 그대로 허용한다 (state.ts 헤더에도 동일 사유 기록됨, Task 2).
//
// TGun/emptyGun은 M1에서 sprites.ts에 스텁으로 먼저 만들어졌다 — 이 태스크에서 여기로 이관하고
// sprites.ts는 re-export만 한다 (기존 import 경로 호환, plan Task 1 Step 3).
//
// GFX_WEAPONS_* 텍스처 ID는 gfx.ts(gfx.inc 부분 포팅, 이번 태스크에서 추가)에서 가져온다.

import { trunc, pascalRound } from './pascal'
import { GRENADE_TIMEOUT, BULLET_TIMEOUT, MELEE_TIMEOUT, FLAMER_TIMEOUT, M2BULLET_TIMEOUT } from './constants'
import {
  GFX_WEAPONS_FRAG_GRENADE,
  GFX_WEAPONS_AK74, GFX_WEAPONS_AK74_CLIP, GFX_WEAPONS_AK74_BULLET, GFX_WEAPONS_AK74_FIRE,
  GFX_WEAPONS_MINIMI, GFX_WEAPONS_MINIMI_CLIP, GFX_WEAPONS_MINIMI_BULLET, GFX_WEAPONS_MINIMI_FIRE,
  GFX_WEAPONS_RUGER, GFX_WEAPONS_RUGER_BULLET, GFX_WEAPONS_RUGER_FIRE,
  GFX_WEAPONS_MP5, GFX_WEAPONS_MP5_CLIP, GFX_WEAPONS_MP5_BULLET, GFX_WEAPONS_MP5_FIRE,
  GFX_WEAPONS_SPAS, GFX_WEAPONS_SPAS_FIRE,
  GFX_WEAPONS_M79, GFX_WEAPONS_M79_CLIP, GFX_WEAPONS_M79_FIRE,
  GFX_WEAPONS_DEAGLES, GFX_WEAPONS_DEAGLES_CLIP, GFX_WEAPONS_DEAGLES_BULLET, GFX_WEAPONS_DEAGLES_FIRE,
  GFX_WEAPONS_STEYR, GFX_WEAPONS_STEYR_CLIP, GFX_WEAPONS_STEYR_BULLET, GFX_WEAPONS_STEYR_FIRE,
  GFX_WEAPONS_BARRETT, GFX_WEAPONS_BARRETT_CLIP, GFX_WEAPONS_BARRETT_BULLET, GFX_WEAPONS_BARRETT_FIRE,
  GFX_WEAPONS_MINIGUN, GFX_WEAPONS_MINIGUN_BULLET, GFX_WEAPONS_MINIGUN_FIRE,
  GFX_WEAPONS_SOCOM, GFX_WEAPONS_SOCOM_CLIP, GFX_WEAPONS_COLT_BULLET, GFX_WEAPONS_SOCOM_FIRE,
  GFX_WEAPONS_BOW, GFX_WEAPONS_BOW_S, GFX_WEAPONS_BOW_FIRE,
  GFX_WEAPONS_FLAMER, GFX_WEAPONS_FLAMER_FIRE,
  GFX_WEAPONS_KNIFE,
  GFX_WEAPONS_CHAINSAW, GFX_WEAPONS_CHAINSAW_FIRE,
  GFX_WEAPONS_LAW, GFX_WEAPONS_LAW_FIRE,
} from './gfx'

/* ****************************************************************************
 *                      TGun (Weapons.pas:14-53)                              *
 **************************************************************************** */

// M1에서 sprites.ts에 있던 TGun 스텁을 그대로 이관 (필드 순서/이름 동일).
export interface TGun {
  ammo: number
  ammoCount: number
  num: number
  movementAcc: number
  bink: number
  recoil: number
  fireInterval: number
  fireIntervalPrev: number
  fireIntervalCount: number
  fireIntervalReal: number
  startUpTime: number
  startUpTimeCount: number
  reloadTime: number
  reloadTimePrev: number
  reloadTimeCount: number
  reloadTimeReal: number
  textureNum: number
  clipTextureNum: number
  clipReload: boolean
  clipInTime: number
  clipOutTime: number
  name: string
  iniName: string
  speed: number
  hitMultiply: number
  bulletSpread: number
  push: number
  inheritedVelocity: number
  modifierLegs: number
  modifierChest: number
  modifierHead: number
  noCollision: number
  fireMode: number
  timeout: number
  bulletStyle: number
  fireStyle: number
  bulletImageStyle: number
}

export function emptyGun(): TGun {
  return {
    ammo: 0, ammoCount: 0, num: 0, movementAcc: 0, bink: 0, recoil: 0,
    fireInterval: 0, fireIntervalPrev: 0, fireIntervalCount: 0, fireIntervalReal: 0,
    startUpTime: 0, startUpTimeCount: 0,
    reloadTime: 0, reloadTimePrev: 0, reloadTimeCount: 0, reloadTimeReal: 0,
    textureNum: 0, clipTextureNum: 0, clipReload: false, clipInTime: 0, clipOutTime: 0,
    name: '', iniName: '', speed: 0, hitMultiply: 0, bulletSpread: 0, push: 0,
    inheritedVelocity: 0, modifierLegs: 0, modifierChest: 0, modifierHead: 0,
    noCollision: 0, fireMode: 0, timeout: 0, bulletStyle: 0, fireStyle: 0, bulletImageStyle: 0,
  }
}

/* ****************************************************************************
 *                 Weapon index constants (Weapons.pas:56-78)                 *
 **************************************************************************** */

export const EAGLE = 1
export const MP5 = 2
export const AK74 = 3
export const STEYRAUG = 4
export const SPAS12 = 5
export const RUGER77 = 6
export const M79 = 7
export const BARRETT = 8
export const M249 = 9
export const MINIGUN = 10
export const COLT = 11
export const KNIFE = 12
export const CHAINSAW = 13
export const LAW = 14
export const BOW2 = 15
export const BOW = 16
export const FLAMER = 17
export const M2 = 18
export const NOWEAPON = 19
export const FRAGGRENADE = 20
export const CLUSTERGRENADE = 21
export const CLUSTER = 22
export const THROWNKNIFE = 23

export const PRIMARY_WEAPONS = 10
export const SECONDARY_WEAPONS = 4
export const BONUS_WEAPONS = 3
export const MAIN_WEAPONS = PRIMARY_WEAPONS + SECONDARY_WEAPONS
export const EXTENDED_WEAPONS = MAIN_WEAPONS + BONUS_WEAPONS

export const ORIGINAL_WEAPONS = 20
export const TOTAL_WEAPONS = 23

// FIXME(skoskav): Normalize weapons' num with their index — 배열 인덱스(위)와 Num(아래)은
// 다른 번호 체계다. 변환은 반드시 weaponNumToIndex 경유 (리스크 지도 7번).
export const EAGLE_NUM = 1
export const MP5_NUM = 2
export const AK74_NUM = 3
export const STEYRAUG_NUM = 4
export const SPAS12_NUM = 5
export const RUGER77_NUM = 6
export const M79_NUM = 7
export const BARRETT_NUM = 8
export const M249_NUM = 9
export const MINIGUN_NUM = 10
export const COLT_NUM = 0
export const KNIFE_NUM = 11
export const CHAINSAW_NUM = 12
export const LAW_NUM = 13
export const BOW2_NUM = 16
export const BOW_NUM = 15
export const FLAMER_NUM = 14
export const M2_NUM = 30
export const NOWEAPON_NUM = 255
export const FRAGGRENADE_NUM = 50
export const CLUSTERGRENADE_NUM = 51
export const CLUSTER_NUM = 52
export const THROWNKNIFE_NUM = 53

// BulletStyle types
export const BULLET_STYLE_PLAIN = 1
export const BULLET_STYLE_FRAGNADE = 2
export const BULLET_STYLE_SHOTGUN = 3
export const BULLET_STYLE_M79 = 4
export const BULLET_STYLE_FLAME = 5
export const BULLET_STYLE_PUNCH = 6
export const BULLET_STYLE_ARROW = 7
export const BULLET_STYLE_FLAMEARROW = 8
export const BULLET_STYLE_CLUSTERNADE = 9
export const BULLET_STYLE_CLUSTER = 10
export const BULLET_STYLE_KNIFE = 11
export const BULLET_STYLE_LAW = 12
export const BULLET_STYLE_THROWNKNIFE = 13
export const BULLET_STYLE_M2 = 14

// Used for NoCollision attribute
export const WEAPON_NOCOLLISION_ENEMY = 1 << 0
export const WEAPON_NOCOLLISION_TEAM = 1 << 1
export const WEAPON_NOCOLLISION_SELF = 1 << 2
export const WEAPON_NOCOLLISION_EXP_ENEMY = 1 << 3
export const WEAPON_NOCOLLISION_EXP_TEAM = 1 << 4
export const WEAPON_NOCOLLISION_EXP_SELF = 1 << 5

/* ****************************************************************************
 *  Module globals: Guns/DefaultGuns (Weapons.pas:139-141) — 예외적 모듈 전역     *
 **************************************************************************** */

function makeGunsArray(): TGun[] {
  // 1-based, [0]은 더미 (M1 공통 규약 2).
  return Array.from({ length: TOTAL_WEAPONS + 1 }, () => emptyGun())
}

export let guns: TGun[] = makeGunsArray()
export let defaultGuns: TGun[] = makeGunsArray()

// SharedConfig.pas가 세팅하는 무기 모드 표시용 메타데이터 (LoadWeaponsConfig의 [Info] 섹션).
// DefaultWMChecksum/LoadedWMChecksum(Weapons.pas:141)은 서버-클라 무기설정 무결성 비교용으로
// M3 네트 코드 소관 — 이 태스크 범위에서는 값을 담을 곳만 남기지 않고 생략(TODO(M3) NET).
export let wmName = ''
export let wmVersion = ''

/* ****************************************************************************
 *                 CreateWeapons 계열 (Weapons.pas:166-490)                    *
 **************************************************************************** */

export function createWeapons(realisticMode: boolean): void {
  createWeaponsBase()
  createDefaultWeapons(realisticMode)
}

export function createDefaultWeapons(realisticMode: boolean): void {
  if (realisticMode) {
    createRealisticWeapons()
  } else {
    createNormalWeapons()
  }

  // Set defaults for weapon menu selection comparisons
  for (let weaponIndex = 1; weaponIndex <= TOTAL_WEAPONS; weaponIndex++) {
    const gun = guns[weaponIndex]
    const defaultGun = defaultGuns[weaponIndex]

    defaultGun.hitMultiply = gun.hitMultiply
    defaultGun.fireInterval = gun.fireInterval
    defaultGun.ammo = gun.ammo
    defaultGun.reloadTime = gun.reloadTime
    defaultGun.speed = gun.speed
    defaultGun.bulletStyle = gun.bulletStyle
    defaultGun.startUpTime = gun.startUpTime
    defaultGun.bink = gun.bink
    defaultGun.movementAcc = gun.movementAcc
    defaultGun.bulletSpread = gun.bulletSpread
    defaultGun.recoil = gun.recoil
    defaultGun.push = gun.push
    defaultGun.inheritedVelocity = gun.inheritedVelocity
    defaultGun.modifierLegs = gun.modifierLegs
    defaultGun.modifierChest = gun.modifierChest
    defaultGun.modifierHead = gun.modifierHead
  }

  buildWeapons()
}

export function createWeaponsBase(): void {
  // Desert Eagle
  let gun = guns[EAGLE]
  gun.name = 'Desert Eagles'
  gun.iniName = gun.name
  gun.num = EAGLE_NUM
  gun.textureNum = GFX_WEAPONS_DEAGLES
  gun.clipTextureNum = GFX_WEAPONS_DEAGLES_CLIP
  gun.clipReload = true
  gun.bulletImageStyle = GFX_WEAPONS_DEAGLES_BULLET
  gun.fireStyle = GFX_WEAPONS_DEAGLES_FIRE
  gun.fireMode = 2

  // MP5
  gun = guns[MP5]
  gun.name = 'HK MP5'
  gun.iniName = gun.name
  gun.num = MP5_NUM
  gun.textureNum = GFX_WEAPONS_MP5
  gun.clipTextureNum = GFX_WEAPONS_MP5_CLIP
  gun.clipReload = true
  gun.bulletImageStyle = GFX_WEAPONS_MP5_BULLET
  gun.fireStyle = GFX_WEAPONS_MP5_FIRE
  gun.fireMode = 0

  // AK-74
  gun = guns[AK74]
  gun.name = 'Ak-74'
  gun.iniName = gun.name
  gun.num = AK74_NUM
  gun.textureNum = GFX_WEAPONS_AK74
  gun.clipTextureNum = GFX_WEAPONS_AK74_CLIP
  gun.clipReload = true
  gun.bulletImageStyle = GFX_WEAPONS_AK74_BULLET
  gun.fireStyle = GFX_WEAPONS_AK74_FIRE
  gun.fireMode = 0

  // Steyr AUG
  gun = guns[STEYRAUG]
  gun.name = 'Steyr AUG'
  gun.iniName = gun.name
  gun.num = STEYRAUG_NUM
  gun.textureNum = GFX_WEAPONS_STEYR
  gun.clipTextureNum = GFX_WEAPONS_STEYR_CLIP
  gun.clipReload = true
  gun.bulletImageStyle = GFX_WEAPONS_STEYR_BULLET
  gun.fireStyle = GFX_WEAPONS_STEYR_FIRE
  gun.fireMode = 0

  // SPAS-12
  gun = guns[SPAS12]
  gun.name = 'Spas-12'
  gun.iniName = gun.name
  gun.num = SPAS12_NUM
  gun.textureNum = GFX_WEAPONS_SPAS
  gun.clipTextureNum = 0
  gun.clipReload = false
  gun.bulletImageStyle = 0
  gun.fireStyle = GFX_WEAPONS_SPAS_FIRE
  gun.fireMode = 2

  // Ruger 77
  gun = guns[RUGER77]
  gun.name = 'Ruger 77'
  gun.iniName = gun.name
  gun.num = RUGER77_NUM
  gun.textureNum = GFX_WEAPONS_RUGER
  gun.clipTextureNum = 0
  gun.clipReload = false
  gun.bulletImageStyle = GFX_WEAPONS_RUGER_BULLET
  gun.fireStyle = GFX_WEAPONS_RUGER_FIRE
  gun.fireMode = 2

  // M79 grenade launcher
  gun = guns[M79]
  gun.name = 'M79'
  gun.iniName = gun.name
  gun.num = M79_NUM
  gun.textureNum = GFX_WEAPONS_M79
  gun.clipTextureNum = GFX_WEAPONS_M79_CLIP
  gun.clipReload = true
  gun.bulletImageStyle = 0
  gun.fireStyle = GFX_WEAPONS_M79_FIRE
  gun.fireMode = 0

  // Barrett M82A1
  gun = guns[BARRETT]
  gun.name = 'Barrett M82A1'
  gun.iniName = 'Barret M82A1' // 원본 오타 그대로 (M2 규약: IniName은 실제 ini 섹션명과 일치해야 함)
  gun.num = BARRETT_NUM
  gun.textureNum = GFX_WEAPONS_BARRETT
  gun.clipTextureNum = GFX_WEAPONS_BARRETT_CLIP
  gun.clipReload = true
  gun.bulletImageStyle = GFX_WEAPONS_BARRETT_BULLET
  gun.fireStyle = GFX_WEAPONS_BARRETT_FIRE
  gun.fireMode = 2

  // M249
  gun = guns[M249]
  gun.name = 'FN Minimi'
  gun.iniName = gun.name
  gun.num = M249_NUM
  gun.textureNum = GFX_WEAPONS_MINIMI
  gun.clipTextureNum = GFX_WEAPONS_MINIMI_CLIP
  gun.clipReload = true
  gun.bulletImageStyle = GFX_WEAPONS_MINIMI_BULLET
  gun.fireStyle = GFX_WEAPONS_MINIMI_FIRE
  gun.fireMode = 0

  // Minigun
  gun = guns[MINIGUN]
  gun.name = 'XM214 Minigun'
  gun.iniName = gun.name
  gun.num = MINIGUN_NUM
  gun.textureNum = GFX_WEAPONS_MINIGUN
  gun.clipTextureNum = 0
  gun.clipReload = false
  gun.bulletImageStyle = GFX_WEAPONS_MINIGUN_BULLET
  gun.fireStyle = GFX_WEAPONS_MINIGUN_FIRE
  gun.fireMode = 0

  // Colt 1911
  gun = guns[COLT]
  gun.name = 'USSOCOM'
  gun.iniName = gun.name
  gun.num = COLT_NUM
  gun.textureNum = GFX_WEAPONS_SOCOM
  gun.clipTextureNum = GFX_WEAPONS_SOCOM_CLIP
  gun.clipReload = true
  gun.bulletImageStyle = GFX_WEAPONS_COLT_BULLET
  gun.fireStyle = GFX_WEAPONS_SOCOM_FIRE
  gun.fireMode = 2

  // Knife
  gun = guns[KNIFE]
  gun.name = 'Combat Knife'
  gun.iniName = gun.name
  gun.num = KNIFE_NUM
  gun.textureNum = GFX_WEAPONS_KNIFE
  gun.clipTextureNum = 0
  gun.clipReload = false
  gun.bulletImageStyle = 0
  gun.fireStyle = 0
  gun.fireMode = 0

  // Chainsaw
  gun = guns[CHAINSAW]
  gun.name = 'Chainsaw'
  gun.iniName = gun.name
  gun.num = CHAINSAW_NUM
  gun.textureNum = GFX_WEAPONS_CHAINSAW
  gun.clipTextureNum = 0
  gun.clipReload = false
  gun.bulletImageStyle = 0
  gun.fireStyle = GFX_WEAPONS_CHAINSAW_FIRE
  gun.fireMode = 0

  // M72 LAW
  gun = guns[LAW]
  gun.name = 'LAW'
  gun.iniName = 'M72 LAW'
  gun.num = LAW_NUM
  gun.textureNum = GFX_WEAPONS_LAW
  gun.clipTextureNum = 0
  gun.clipReload = true
  gun.bulletImageStyle = 0
  gun.fireStyle = GFX_WEAPONS_LAW_FIRE
  gun.fireMode = 0

  // Rambo Bow with flame
  gun = guns[BOW2]
  gun.name = 'Flame Bow'
  gun.iniName = 'Flamed Arrows'
  gun.num = BOW2_NUM
  gun.textureNum = GFX_WEAPONS_BOW
  gun.clipTextureNum = GFX_WEAPONS_BOW_S
  gun.clipReload = false
  gun.bulletImageStyle = 0
  gun.fireStyle = GFX_WEAPONS_BOW_FIRE
  gun.fireMode = 0

  // Rambo Bow
  gun = guns[BOW]
  gun.name = 'Bow'
  gun.iniName = 'Rambo Bow'
  gun.num = BOW_NUM
  gun.textureNum = GFX_WEAPONS_BOW
  gun.clipTextureNum = GFX_WEAPONS_BOW_S
  gun.clipReload = false
  gun.bulletImageStyle = 0
  gun.fireStyle = GFX_WEAPONS_BOW_FIRE
  gun.fireMode = 0

  // Flamethrower
  gun = guns[FLAMER]
  gun.name = 'Flamer'
  gun.iniName = gun.name
  gun.num = FLAMER_NUM
  gun.textureNum = GFX_WEAPONS_FLAMER
  gun.clipTextureNum = GFX_WEAPONS_FLAMER
  gun.clipReload = false
  gun.bulletImageStyle = 0
  gun.fireStyle = GFX_WEAPONS_FLAMER_FIRE
  gun.fireMode = 0

  // M2
  gun = guns[M2]
  gun.name = 'M2 MG'
  gun.iniName = 'Stationary Gun'
  gun.num = M2_NUM
  gun.textureNum = GFX_WEAPONS_MINIGUN
  gun.clipTextureNum = 0
  gun.clipReload = false
  gun.bulletImageStyle = 0
  gun.fireStyle = 0
  gun.fireMode = 0

  // No weapon
  gun = guns[NOWEAPON]
  gun.name = 'Hands'
  gun.iniName = 'Punch'
  gun.num = NOWEAPON_NUM
  gun.textureNum = 0
  gun.clipTextureNum = 0
  gun.clipReload = false
  gun.bulletImageStyle = 0
  gun.fireStyle = 0
  gun.fireMode = 0

  // Frag grenade
  gun = guns[FRAGGRENADE]
  gun.name = 'Frag Grenade'
  gun.iniName = 'Grenade'
  gun.num = FRAGGRENADE_NUM
  gun.textureNum = GFX_WEAPONS_FRAG_GRENADE
  gun.clipTextureNum = GFX_WEAPONS_FRAG_GRENADE
  gun.clipReload = false
  gun.bulletImageStyle = 0
  gun.fireStyle = GFX_WEAPONS_AK74_FIRE
  gun.fireMode = 0

  // TODO(skoskav): Add a proper entry for cluster nade and thrown knife
  // Cluster grenade
  gun = guns[CLUSTERGRENADE]
  gun.name = 'Frag Grenade'
  gun.iniName = ''
  gun.num = CLUSTERGRENADE_NUM
  gun.textureNum = GFX_WEAPONS_FRAG_GRENADE
  gun.clipTextureNum = GFX_WEAPONS_FRAG_GRENADE
  gun.clipReload = false
  gun.bulletImageStyle = 0
  gun.fireStyle = GFX_WEAPONS_AK74_FIRE
  gun.fireMode = 0

  // Cluster
  gun = guns[CLUSTER]
  gun.name = 'Frag Grenade'
  gun.iniName = ''
  gun.num = CLUSTER_NUM
  gun.textureNum = GFX_WEAPONS_FRAG_GRENADE
  gun.clipTextureNum = GFX_WEAPONS_FRAG_GRENADE
  gun.clipReload = false
  gun.bulletImageStyle = 0
  gun.fireStyle = GFX_WEAPONS_AK74_FIRE
  gun.fireMode = 0

  // Thrown knife
  gun = guns[THROWNKNIFE]
  gun.name = 'Combat Knife'
  gun.iniName = ''
  gun.num = THROWNKNIFE_NUM
  gun.textureNum = GFX_WEAPONS_KNIFE
  gun.clipTextureNum = 0
  gun.clipReload = false
  gun.bulletImageStyle = 0
  gun.fireStyle = 0
  gun.fireMode = 0
}

export function createNormalWeapons(): void {
  // Desert Eagle
  let gun = guns[EAGLE]
  gun.hitMultiply = 1.81
  gun.fireInterval = 24
  gun.ammo = 7
  gun.reloadTime = 87
  gun.speed = 19
  gun.bulletStyle = BULLET_STYLE_PLAIN
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0.009
  gun.bulletSpread = 0.15
  gun.recoil = 0
  gun.push = 0.0176
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.1
  gun.modifierChest = 0.95
  gun.modifierLegs = 0.85

  // MP5
  gun = guns[MP5]
  gun.hitMultiply = 1.01
  gun.fireInterval = 6
  gun.ammo = 30
  gun.reloadTime = 105
  gun.speed = 18.9
  gun.bulletStyle = BULLET_STYLE_PLAIN
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0
  gun.bulletSpread = 0.14
  gun.recoil = 0
  gun.push = 0.0112
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.1
  gun.modifierChest = 0.95
  gun.modifierLegs = 0.85

  // AK-74
  gun = guns[AK74]
  gun.hitMultiply = 1.004
  gun.fireInterval = 10
  gun.ammo = 35
  gun.reloadTime = 165
  gun.speed = 24.6
  gun.bulletStyle = BULLET_STYLE_PLAIN
  gun.startUpTime = 0
  gun.bink = -12
  gun.movementAcc = 0.011
  gun.bulletSpread = 0.025
  gun.recoil = 0
  gun.push = 0.01376
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.1
  gun.modifierChest = 0.95
  gun.modifierLegs = 0.85

  // Steyr AUG
  gun = guns[STEYRAUG]
  gun.hitMultiply = 0.71
  gun.fireInterval = 7
  gun.ammo = 25
  gun.reloadTime = 125
  gun.speed = 26
  gun.bulletStyle = BULLET_STYLE_PLAIN
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0
  gun.bulletSpread = 0.075
  gun.recoil = 0
  gun.push = 0.0084
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.1
  gun.modifierChest = 0.95
  gun.modifierLegs = 0.85

  // SPAS-12
  gun = guns[SPAS12]
  gun.hitMultiply = 1.22
  gun.fireInterval = 32
  gun.ammo = 7
  gun.reloadTime = 175
  gun.speed = 14
  gun.bulletStyle = BULLET_STYLE_SHOTGUN
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0
  gun.bulletSpread = 0.8
  gun.recoil = 0
  gun.push = 0.0188
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.1
  gun.modifierChest = 0.95
  gun.modifierLegs = 0.85

  // Ruger 77
  gun = guns[RUGER77]
  gun.hitMultiply = 2.49
  gun.fireInterval = 45
  gun.ammo = 4
  gun.reloadTime = 78
  gun.speed = 33
  gun.bulletStyle = BULLET_STYLE_PLAIN
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0.03
  gun.bulletSpread = 0
  gun.recoil = 0
  gun.push = 0.012
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.2
  gun.modifierChest = 1.05
  gun.modifierLegs = 1

  // M79 grenade launcher
  gun = guns[M79]
  gun.hitMultiply = 1550
  gun.fireInterval = 6
  gun.ammo = 1
  gun.reloadTime = 178
  gun.speed = 10.7
  gun.bulletStyle = BULLET_STYLE_M79
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0
  gun.bulletSpread = 0
  gun.recoil = 0
  gun.push = 0.036
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.15
  gun.modifierChest = 1
  gun.modifierLegs = 0.9

  // Barrett M82A1
  gun = guns[BARRETT]
  gun.hitMultiply = 4.45
  gun.fireInterval = 225
  gun.ammo = 10
  gun.reloadTime = 70
  gun.speed = 55
  gun.bulletStyle = BULLET_STYLE_PLAIN
  gun.startUpTime = 19
  gun.bink = 65
  gun.movementAcc = 0.05
  gun.bulletSpread = 0
  gun.recoil = 0
  gun.push = 0.018
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1
  gun.modifierChest = 1
  gun.modifierLegs = 1

  // M249
  gun = guns[M249]
  gun.hitMultiply = 0.85
  gun.fireInterval = 9
  gun.ammo = 50
  gun.reloadTime = 250
  gun.speed = 27
  gun.bulletStyle = BULLET_STYLE_PLAIN
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0.013
  gun.bulletSpread = 0.064
  gun.recoil = 0
  gun.push = 0.0128
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.1
  gun.modifierChest = 0.95
  gun.modifierLegs = 0.85

  // Minigun
  gun = guns[MINIGUN]
  gun.hitMultiply = 0.468
  gun.fireInterval = 3
  gun.ammo = 100
  gun.reloadTime = 480
  gun.speed = 29
  gun.bulletStyle = BULLET_STYLE_PLAIN
  gun.startUpTime = 25
  gun.bink = 0
  gun.movementAcc = 0.0625
  gun.bulletSpread = 0.3
  gun.recoil = 0
  gun.push = 0.0104
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.1
  gun.modifierChest = 0.95
  gun.modifierLegs = 0.85

  // Colt 1911
  gun = guns[COLT]
  gun.hitMultiply = 1.49
  gun.fireInterval = 10
  gun.ammo = 14
  gun.reloadTime = 60
  gun.speed = 18
  gun.bulletStyle = BULLET_STYLE_PLAIN
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0
  gun.bulletSpread = 0
  gun.recoil = 0
  gun.push = 0.02
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.1
  gun.modifierChest = 0.95
  gun.modifierLegs = 0.85

  // Knife
  gun = guns[KNIFE]
  gun.hitMultiply = 2150
  gun.fireInterval = 6
  gun.ammo = 1
  gun.reloadTime = 3
  gun.speed = 6
  gun.bulletStyle = BULLET_STYLE_KNIFE
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0
  gun.bulletSpread = 0
  gun.recoil = 0
  gun.push = 0.12
  gun.inheritedVelocity = 0
  gun.modifierHead = 1.15
  gun.modifierChest = 1
  gun.modifierLegs = 0.9

  // Chainsaw
  gun = guns[CHAINSAW]
  gun.hitMultiply = 50
  gun.fireInterval = 2
  gun.ammo = 200
  gun.reloadTime = 110
  gun.speed = 8
  gun.bulletStyle = BULLET_STYLE_KNIFE
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0
  gun.bulletSpread = 0
  gun.recoil = 0
  gun.push = 0.0028
  gun.inheritedVelocity = 0
  gun.modifierHead = 1.15
  gun.modifierChest = 1
  gun.modifierLegs = 0.9

  // M72 LAW
  gun = guns[LAW]
  gun.hitMultiply = 1550
  gun.fireInterval = 6
  gun.ammo = 1
  gun.reloadTime = 300
  gun.speed = 23
  gun.bulletStyle = BULLET_STYLE_LAW
  gun.startUpTime = 13
  gun.bink = 0
  gun.movementAcc = 0
  gun.bulletSpread = 0
  gun.recoil = 0
  gun.push = 0.028
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.15
  gun.modifierChest = 1
  gun.modifierLegs = 0.9

  // Rambo Bow with flame
  gun = guns[BOW2]
  gun.hitMultiply = 8
  gun.fireInterval = 10
  gun.ammo = 1
  gun.reloadTime = 39
  gun.speed = 18
  gun.bulletStyle = BULLET_STYLE_FLAMEARROW
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0
  gun.bulletSpread = 0
  gun.recoil = 0
  gun.push = 0
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.15
  gun.modifierChest = 1
  gun.modifierLegs = 0.9

  // Rambo Bow
  gun = guns[BOW]
  gun.hitMultiply = 12
  gun.fireInterval = 10
  gun.ammo = 1
  gun.reloadTime = 25
  gun.speed = 21
  gun.bulletStyle = BULLET_STYLE_ARROW
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0
  gun.bulletSpread = 0
  gun.recoil = 0
  gun.push = 0.0148
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.15
  gun.modifierChest = 1
  gun.modifierLegs = 0.9

  // Flamethrower
  gun = guns[FLAMER]
  gun.hitMultiply = 19
  gun.fireInterval = 6
  gun.ammo = 200
  gun.reloadTime = 5
  gun.speed = 10.5
  gun.bulletStyle = BULLET_STYLE_FLAME
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0
  gun.bulletSpread = 0
  gun.recoil = 0
  gun.push = 0.016
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.15
  gun.modifierChest = 1
  gun.modifierLegs = 0.9

  // M2
  gun = guns[M2]
  gun.hitMultiply = 1.8
  gun.fireInterval = 10
  gun.ammo = 100
  gun.reloadTime = 366
  gun.speed = 36
  gun.bulletStyle = BULLET_STYLE_M2
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0
  gun.bulletSpread = 0
  gun.recoil = 0
  gun.push = 0.0088
  gun.inheritedVelocity = 0
  gun.modifierHead = 1.1
  gun.modifierChest = 0.95
  gun.modifierLegs = 0.85

  // No weapon
  gun = guns[NOWEAPON]
  gun.hitMultiply = 330
  gun.fireInterval = 6
  gun.ammo = 1
  gun.reloadTime = 3
  gun.speed = 5
  gun.bulletStyle = BULLET_STYLE_PUNCH
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0
  gun.bulletSpread = 0
  gun.recoil = 0
  gun.push = 0
  gun.inheritedVelocity = 0
  gun.modifierHead = 1.15
  gun.modifierChest = 1
  gun.modifierLegs = 0.9

  // Frag grenade
  gun = guns[FRAGGRENADE]
  gun.hitMultiply = 1500
  gun.fireInterval = 80
  gun.ammo = 1
  gun.reloadTime = 20
  gun.speed = 5
  gun.bulletStyle = BULLET_STYLE_FRAGNADE
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0
  gun.bulletSpread = 0
  gun.recoil = 0
  gun.push = 0
  gun.inheritedVelocity = 1
  gun.modifierHead = 1
  gun.modifierChest = 1
  gun.modifierLegs = 1
}

export function createRealisticWeapons(): void {
  // Desert Eagle
  let gun = guns[EAGLE]
  gun.hitMultiply = 1.66
  gun.fireInterval = 27
  gun.ammo = 7
  gun.reloadTime = 106
  gun.speed = 19
  gun.bulletStyle = BULLET_STYLE_PLAIN
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0.02
  gun.bulletSpread = 0.1
  gun.recoil = 55
  gun.push = 0.0164
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.1
  gun.modifierChest = 1
  gun.modifierLegs = 0.6

  // MP5
  gun = guns[MP5]
  gun.hitMultiply = 0.94
  gun.fireInterval = 6
  gun.ammo = 30
  gun.reloadTime = 110
  gun.speed = 18.9
  gun.bulletStyle = BULLET_STYLE_PLAIN
  gun.startUpTime = 0
  gun.bink = -10
  gun.movementAcc = 0.01
  gun.bulletSpread = 0.03
  gun.recoil = 9
  gun.push = 0.0164
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.1
  gun.modifierChest = 1
  gun.modifierLegs = 0.6

  // AK-74
  gun = guns[AK74]
  gun.hitMultiply = 1.08
  gun.fireInterval = 11
  gun.ammo = 35
  gun.reloadTime = 158
  gun.speed = 24
  gun.bulletStyle = BULLET_STYLE_PLAIN
  gun.startUpTime = 0
  gun.bink = -10
  gun.movementAcc = 0.02
  gun.bulletSpread = 0
  gun.recoil = 13
  gun.push = 0.0132
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.1
  gun.modifierChest = 1
  gun.modifierLegs = 0.6

  // Steyr AUG
  gun = guns[STEYRAUG]
  gun.hitMultiply = 0.68
  gun.fireInterval = 7
  gun.ammo = 30
  gun.reloadTime = 126
  gun.speed = 26
  gun.bulletStyle = BULLET_STYLE_PLAIN
  gun.startUpTime = 0
  gun.bink = -9
  gun.movementAcc = 0.01
  gun.bulletSpread = 0
  gun.recoil = 11
  gun.push = 0.012
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.1
  gun.modifierChest = 1
  gun.modifierLegs = 0.6

  // SPAS-12
  gun = guns[SPAS12]
  gun.hitMultiply = 1.2
  gun.fireInterval = 35
  gun.ammo = 7
  gun.reloadTime = 175
  gun.speed = 13.2
  gun.bulletStyle = BULLET_STYLE_SHOTGUN
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0.01
  gun.bulletSpread = 0.8
  gun.recoil = 65
  gun.push = 0.0224
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.1
  gun.modifierChest = 1
  gun.modifierLegs = 0.6

  // Ruger 77
  gun = guns[RUGER77]
  gun.hitMultiply = 2.22
  gun.fireInterval = 52
  gun.ammo = 4
  gun.reloadTime = 104
  gun.speed = 33
  gun.bulletStyle = BULLET_STYLE_PLAIN
  gun.startUpTime = 0
  gun.bink = 14
  gun.movementAcc = 0.03
  gun.bulletSpread = 0
  gun.recoil = 54
  gun.push = 0.0096
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.1
  gun.modifierChest = 1
  gun.modifierLegs = 0.6

  // M79 grenade launcher
  gun = guns[M79]
  gun.hitMultiply = 1600
  gun.fireInterval = 6
  gun.ammo = 1
  gun.reloadTime = 173
  gun.speed = 11.4
  gun.bulletStyle = BULLET_STYLE_M79
  gun.startUpTime = 0
  gun.bink = 45
  gun.movementAcc = 0.03
  gun.bulletSpread = 0
  gun.recoil = 420
  gun.push = 0.024
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.1
  gun.modifierChest = 1
  gun.modifierLegs = 0.6

  // Barrett M82A1
  gun = guns[BARRETT]
  gun.hitMultiply = 4.95
  gun.fireInterval = 200
  gun.ammo = 10
  gun.reloadTime = 170
  gun.speed = 55
  gun.bulletStyle = BULLET_STYLE_PLAIN
  gun.startUpTime = 16
  gun.bink = 80
  gun.movementAcc = 0.07
  gun.bulletSpread = 0
  gun.recoil = 0
  gun.push = 0.0056
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.1
  gun.modifierChest = 1
  gun.modifierLegs = 0.6

  // M249
  gun = guns[M249]
  gun.hitMultiply = 0.81
  gun.fireInterval = 10
  gun.ammo = 50
  gun.reloadTime = 261
  gun.speed = 27
  gun.bulletStyle = BULLET_STYLE_PLAIN
  gun.startUpTime = 0
  gun.bink = -8
  gun.movementAcc = 0.02
  gun.bulletSpread = 0
  gun.recoil = 8
  gun.push = 0.0116
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.1
  gun.modifierChest = 1
  gun.modifierLegs = 0.6

  // Minigun
  gun = guns[MINIGUN]
  gun.hitMultiply = 0.43
  gun.fireInterval = 4
  gun.ammo = 100
  gun.reloadTime = 320
  gun.speed = 29
  gun.bulletStyle = BULLET_STYLE_PLAIN
  gun.startUpTime = 33
  gun.bink = -2
  gun.movementAcc = 0.01
  gun.bulletSpread = 0.1
  gun.recoil = 4
  gun.push = 0.0108
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.1
  gun.modifierChest = 1
  gun.modifierLegs = 0.6

  // Colt 1911
  gun = guns[COLT]
  gun.hitMultiply = 1.3
  gun.fireInterval = 12
  gun.ammo = 12
  gun.reloadTime = 72
  gun.speed = 18
  gun.bulletStyle = BULLET_STYLE_PLAIN
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0.02
  gun.bulletSpread = 0
  gun.recoil = 28
  gun.push = 0.0172
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.1
  gun.modifierChest = 1
  gun.modifierLegs = 0.6

  // Knife
  gun = guns[KNIFE]
  gun.hitMultiply = 2250
  gun.fireInterval = 6
  gun.ammo = 1
  gun.reloadTime = 3
  gun.speed = 6
  gun.bulletStyle = BULLET_STYLE_KNIFE
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0.01
  gun.bulletSpread = 0
  gun.recoil = 10
  gun.push = 0.028
  gun.inheritedVelocity = 0
  gun.modifierHead = 1.1
  gun.modifierChest = 1
  gun.modifierLegs = 0.6

  // Chainsaw
  gun = guns[CHAINSAW]
  gun.hitMultiply = 21
  gun.fireInterval = 2
  gun.ammo = 200
  gun.reloadTime = 110
  gun.speed = 7.6
  gun.bulletStyle = BULLET_STYLE_KNIFE
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0.01
  gun.bulletSpread = 0
  gun.recoil = 1
  gun.push = 0.0028
  gun.inheritedVelocity = 0
  gun.modifierHead = 1.1
  gun.modifierChest = 1
  gun.modifierLegs = 0.6

  // M72 LAW
  gun = guns[LAW]
  gun.hitMultiply = 1500
  gun.fireInterval = 30
  gun.ammo = 1
  gun.reloadTime = 495
  gun.speed = 23
  gun.bulletStyle = BULLET_STYLE_LAW
  gun.startUpTime = 12
  gun.bink = 0
  gun.movementAcc = 0.01
  gun.bulletSpread = 0
  gun.recoil = 9
  gun.push = 0.012
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.1
  gun.modifierChest = 1
  gun.modifierLegs = 0.6

  // Rambo Bow with flame
  gun = guns[BOW2]
  gun.hitMultiply = 8
  gun.fireInterval = 10
  gun.ammo = 1
  gun.reloadTime = 39
  gun.speed = 18
  gun.bulletStyle = BULLET_STYLE_FLAMEARROW
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0.01
  gun.bulletSpread = 0
  gun.recoil = 10
  gun.push = 0
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.1
  gun.modifierChest = 1
  gun.modifierLegs = 0.6

  // Rambo Bow
  gun = guns[BOW]
  gun.hitMultiply = 12
  gun.fireInterval = 10
  gun.ammo = 1
  gun.reloadTime = 25
  gun.speed = 21
  gun.bulletStyle = BULLET_STYLE_ARROW
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0.01
  gun.bulletSpread = 0
  gun.recoil = 10
  gun.push = 0.0148
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.1
  gun.modifierChest = 1
  gun.modifierLegs = 0.6

  // Flamethrower
  gun = guns[FLAMER]
  gun.hitMultiply = 12
  gun.fireInterval = 6
  gun.ammo = 200
  gun.reloadTime = 5
  gun.speed = 12.5
  gun.bulletStyle = BULLET_STYLE_FLAME
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0.01
  gun.bulletSpread = 0
  gun.recoil = 10
  gun.push = 0.016
  gun.inheritedVelocity = 0.5
  gun.modifierHead = 1.1
  gun.modifierChest = 1
  gun.modifierLegs = 0.6

  // M2
  gun = guns[M2]
  gun.hitMultiply = 1.55
  gun.fireInterval = 14
  gun.ammo = 100
  gun.reloadTime = 366
  gun.speed = 36
  gun.bulletStyle = BULLET_STYLE_M2
  gun.startUpTime = 21
  gun.bink = 0
  gun.movementAcc = 0.01
  gun.bulletSpread = 0
  gun.recoil = 10
  gun.push = 0.0088
  gun.inheritedVelocity = 0
  gun.modifierHead = 1.1
  gun.modifierChest = 1
  gun.modifierLegs = 0.6

  // No weapon
  gun = guns[NOWEAPON]
  gun.hitMultiply = 330
  gun.fireInterval = 6
  gun.ammo = 1
  gun.reloadTime = 3
  gun.speed = 5
  gun.bulletStyle = BULLET_STYLE_PUNCH
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0.01
  gun.bulletSpread = 0
  gun.recoil = 10
  gun.push = 0
  gun.inheritedVelocity = 0
  gun.modifierHead = 1.1
  gun.modifierChest = 1
  gun.modifierLegs = 0.6

  // Frag grenade
  gun = guns[FRAGGRENADE]
  gun.hitMultiply = 1500
  gun.fireInterval = 80
  gun.ammo = 1
  gun.reloadTime = 20
  gun.speed = 5
  gun.bulletStyle = BULLET_STYLE_FRAGNADE
  gun.startUpTime = 0
  gun.bink = 0
  gun.movementAcc = 0.01
  gun.bulletSpread = 0
  gun.recoil = 10
  gun.push = 0
  gun.inheritedVelocity = 1
  gun.modifierHead = 1.1
  gun.modifierChest = 1
  gun.modifierLegs = 0.6
}

export function buildWeapons(): void {
  // TODO(skoskav): Add a proper entry for cluster nade and thrown knife
  // Cluster grenade
  let gun = guns[CLUSTERGRENADE]
  gun.hitMultiply = guns[FRAGGRENADE].hitMultiply
  gun.fireInterval = guns[FRAGGRENADE].fireInterval
  gun.ammo = guns[FRAGGRENADE].ammo
  gun.reloadTime = guns[FRAGGRENADE].reloadTime
  gun.speed = guns[FRAGGRENADE].speed
  gun.bulletStyle = BULLET_STYLE_CLUSTERNADE
  gun.startUpTime = guns[FRAGGRENADE].startUpTime
  gun.bink = guns[FRAGGRENADE].bink
  gun.movementAcc = guns[FRAGGRENADE].movementAcc
  gun.bulletSpread = guns[FRAGGRENADE].bulletSpread
  gun.recoil = guns[FRAGGRENADE].recoil
  gun.push = guns[FRAGGRENADE].push
  gun.inheritedVelocity = guns[FRAGGRENADE].inheritedVelocity

  // Cluster
  gun = guns[CLUSTER]
  gun.hitMultiply = guns[CLUSTERGRENADE].hitMultiply
  gun.fireInterval = guns[CLUSTERGRENADE].fireInterval
  gun.ammo = guns[CLUSTERGRENADE].ammo
  gun.reloadTime = guns[CLUSTERGRENADE].reloadTime
  gun.speed = guns[CLUSTERGRENADE].speed
  gun.bulletStyle = BULLET_STYLE_CLUSTER
  gun.startUpTime = guns[CLUSTERGRENADE].startUpTime
  gun.bink = guns[CLUSTERGRENADE].bink
  gun.movementAcc = guns[CLUSTERGRENADE].movementAcc
  gun.bulletSpread = guns[CLUSTERGRENADE].bulletSpread
  gun.recoil = guns[CLUSTERGRENADE].recoil
  gun.push = guns[CLUSTERGRENADE].push
  gun.inheritedVelocity = guns[CLUSTERGRENADE].inheritedVelocity

  // Thrown knife
  gun = guns[THROWNKNIFE]
  gun.hitMultiply = guns[KNIFE].hitMultiply
  gun.fireInterval = guns[KNIFE].fireInterval
  gun.ammo = guns[KNIFE].ammo
  gun.reloadTime = guns[KNIFE].reloadTime
  gun.speed = guns[KNIFE].speed
  gun.bulletStyle = BULLET_STYLE_THROWNKNIFE
  gun.startUpTime = guns[KNIFE].startUpTime
  gun.bink = guns[KNIFE].bink
  gun.movementAcc = guns[KNIFE].movementAcc
  gun.bulletSpread = guns[KNIFE].bulletSpread
  gun.recoil = guns[KNIFE].recoil
  gun.push = guns[KNIFE].push
  gun.inheritedVelocity = guns[KNIFE].inheritedVelocity

  for (let weaponIndex = 1; weaponIndex <= TOTAL_WEAPONS; weaponIndex++) {
    const g = guns[weaponIndex]

    g.fireIntervalPrev = g.fireInterval
    g.fireIntervalCount = g.fireInterval
    g.ammoCount = g.ammo
    g.reloadTimePrev = g.reloadTime
    g.reloadTimeCount = g.reloadTime
    g.startUpTimeCount = g.startUpTime

    // Set timings for when to let out and in a magazine, if at all
    if (g.clipReload) {
      g.clipOutTime = trunc(g.reloadTime * 0.8)
      g.clipInTime = trunc(g.reloadTime * 0.3)
    } else {
      g.clipOutTime = 0
      g.clipInTime = 0
    }

    // Set bullet lifetime
    switch (g.bulletStyle) {
      case BULLET_STYLE_FRAGNADE:
      case BULLET_STYLE_CLUSTERNADE:
        g.timeout = GRENADE_TIMEOUT
        break
      case BULLET_STYLE_FLAME:
        g.timeout = FLAMER_TIMEOUT
        break
      case BULLET_STYLE_PUNCH:
      case BULLET_STYLE_KNIFE:
        g.timeout = MELEE_TIMEOUT
        break
      case BULLET_STYLE_M2:
        g.timeout = M2BULLET_TIMEOUT
        break
      default:
        g.timeout = BULLET_TIMEOUT
    }
  }

  // Force M79 reload on spawn
  guns[M79].ammoCount = 0
}

/* ****************************************************************************
 *              CreateWMChecksum (Weapons.pas:1359-1390, djb2)                *
 **************************************************************************** */

// LongWord(32-bit unsigned) 오버플로 해시 — 각 연산 뒤 `>>> 0`으로 wraparound 재현.
// {$Q-}{$R-}로 오버플로/레인지 체크가 꺼진 원본과 동치.
export function createWMChecksum(): number {
  let hash = 5381

  for (let weaponIndex = 1; weaponIndex <= ORIGINAL_WEAPONS; weaponIndex++) {
    const gun = guns[weaponIndex]

    hash = (hash + ((hash << 5) + pascalRound(1000.0 * gun.hitMultiply))) >>> 0
    hash = (hash + ((hash << 5) + pascalRound(1000.0 * gun.fireInterval))) >>> 0
    hash = (hash + ((hash << 5) + pascalRound(1000.0 * gun.ammo))) >>> 0
    hash = (hash + ((hash << 5) + pascalRound(1000.0 * gun.reloadTime))) >>> 0
    hash = (hash + ((hash << 5) + pascalRound(1000.0 * gun.speed))) >>> 0
    hash = (hash + ((hash << 5) + pascalRound(1000.0 * gun.bulletStyle))) >>> 0
    hash = (hash + ((hash << 5) + pascalRound(1000.0 * gun.startUpTime))) >>> 0
    hash = (hash + ((hash << 5) + pascalRound(1000.0 * gun.bink))) >>> 0
    hash = (hash + ((hash << 5) + pascalRound(1000.0 * gun.movementAcc))) >>> 0
    hash = (hash + ((hash << 5) + pascalRound(1000.0 * gun.bulletSpread))) >>> 0
    hash = (hash + ((hash << 5) + pascalRound(1000.0 * gun.recoil))) >>> 0
    hash = (hash + ((hash << 5) + pascalRound(1000.0 * gun.push))) >>> 0
    hash = (hash + ((hash << 5) + pascalRound(1000.0 * gun.inheritedVelocity))) >>> 0
  }

  return hash
}

/* ****************************************************************************
 *                    헬퍼 (Weapons.pas:1394-1516)                             *
 **************************************************************************** */

export function weaponNumToIndex(num: number): number {
  for (let weaponIndex = 1; weaponIndex <= TOTAL_WEAPONS; weaponIndex++) {
    if (num === guns[weaponIndex].num) {
      return weaponIndex
    }
  }
  return -1
}

export function weaponNameToNum(name: string): number {
  for (let i = 1; i <= TOTAL_WEAPONS; i++) {
    if (name === guns[i].name) {
      return guns[i].num
    }
  }
  return -1
}

export function weaponNumToName(num: number): string {
  switch (num) {
    case EAGLE_NUM: return guns[EAGLE].name
    case MP5_NUM: return guns[MP5].name
    case AK74_NUM: return guns[AK74].name
    case STEYRAUG_NUM: return guns[STEYRAUG].name
    case SPAS12_NUM: return guns[SPAS12].name
    case RUGER77_NUM: return guns[RUGER77].name
    case M79_NUM: return guns[M79].name
    case BARRETT_NUM: return guns[BARRETT].name
    case M249_NUM: return guns[M249].name
    case MINIGUN_NUM: return guns[MINIGUN].name
    case COLT_NUM: return guns[COLT].name
    case KNIFE_NUM: return guns[KNIFE].name
    case CHAINSAW_NUM: return guns[CHAINSAW].name
    case LAW_NUM: return guns[LAW].name
    case BOW2_NUM: return guns[BOW2].name
    case BOW_NUM: return guns[BOW].name
    case FLAMER_NUM: return guns[FLAMER].name
    case M2_NUM: return guns[M2].name
    case NOWEAPON_NUM: return guns[NOWEAPON].name
    case FRAGGRENADE_NUM: return guns[FRAGGRENADE].name
    case CLUSTERGRENADE_NUM: return guns[CLUSTERGRENADE].name
    case CLUSTER_NUM: return guns[CLUSTER].name
    case THROWNKNIFE_NUM: return guns[THROWNKNIFE].name
    default: return ''
  }
}

export function weaponNumInternalToExternal(num: number): number {
  switch (num) {
    case KNIFE_NUM: return 14
    case CHAINSAW_NUM: return 15
    case LAW_NUM: return 16
    case FLAMER_NUM: return 11
    case BOW_NUM: return 12
    case BOW2_NUM: return 13
    default: return num
  }
}

export function weaponNumExternalToInternal(num: number): number {
  switch (num) {
    case 11: return FLAMER_NUM
    case 12: return BOW_NUM
    case 13: return BOW2_NUM
    case 14: return KNIFE_NUM
    case 15: return CHAINSAW_NUM
    case 16: return LAW_NUM
    default: return num
  }
}

export function weaponNameByNum(num: number): string {
  for (let weaponIndex = 1; weaponIndex <= TOTAL_WEAPONS; weaponIndex++) {
    if (num === guns[weaponIndex].num) {
      return guns[weaponIndex].name
    }
  }
  return ''
}

export function isMainWeaponIndex(weaponIndex: number): boolean {
  return weaponIndex >= 1 && weaponIndex <= MAIN_WEAPONS
}

export function isSecondaryWeaponIndex(weaponIndex: number): boolean {
  return weaponIndex >= PRIMARY_WEAPONS + 1 && weaponIndex <= MAIN_WEAPONS
}

export function isExtendedWeaponIndex(weaponIndex: number): boolean {
  return weaponIndex >= 1 && weaponIndex <= EXTENDED_WEAPONS
}

export function calculateBink(accumulated: number, bink: number): number {
  // Adding bink has diminishing returns as more gets accumulated
  return accumulated + bink - pascalRound(accumulated * (accumulated / (10 * bink + accumulated)))
}

/* ****************************************************************************
 *     loadWeaponsConfig (SharedConfig.pas:222-291 LoadWeaponsConfig/ReadWMConf) *
 **************************************************************************** */

// ini 섹션 하나에서 나올 수 있는 17개 오버라이드 키 (SharedConfig.pas:258-274 ReadWMConf 목록).
// 값은 T0 파이프라인이 ini→JSON으로 그대로 옮긴 것이라 타입 변환(StrToFloat/StrToInt) 불필요.
export interface WeaponsIniGunFields {
  Damage?: number
  FireInterval?: number
  Ammo?: number
  ReloadTime?: number
  Speed?: number
  BulletStyle?: number
  StartUpTime?: number
  Bink?: number
  MovementAcc?: number
  BulletSpread?: number
  Recoil?: number
  Push?: number
  InheritedVelocity?: number
  ModifierLegs?: number
  ModifierChest?: number
  ModifierHead?: number
  NoCollision?: number
}

export interface WeaponsIniConfig {
  info: { name: string; version: string }
  guns: Record<string, WeaponsIniGunFields>
}

// 파일 IO 없음(M2 규약: 무기 설정은 주입된 JSON 객체를 받는다 — 원본의 FileExists/TMemIniFile
// 로딩은 T0 빌드 타임 변환으로 이미 대체됨). 원본은 파일을 못 찾으면 조용히 Result:=False로
// 스킵하지만, 이 포트는 파서 호출자가 이미 존재를 보장한 JSON을 넘기므로 그 분기는 불필요.
export function loadWeaponsConfig(config: WeaponsIniConfig): void {
  wmName = config.info.name
  wmVersion = config.info.version

  for (let weaponIndex = 1; weaponIndex <= ORIGINAL_WEAPONS; weaponIndex++) {
    const gun = guns[weaponIndex]
    const section = config.guns[gun.iniName]
    if (!section) continue

    if (section.Damage !== undefined) gun.hitMultiply = section.Damage
    if (section.FireInterval !== undefined) gun.fireInterval = section.FireInterval
    if (section.Ammo !== undefined) gun.ammo = section.Ammo
    if (section.ReloadTime !== undefined) gun.reloadTime = section.ReloadTime
    if (section.Speed !== undefined) gun.speed = section.Speed
    if (section.BulletStyle !== undefined) gun.bulletStyle = section.BulletStyle
    if (section.StartUpTime !== undefined) gun.startUpTime = section.StartUpTime
    if (section.Bink !== undefined) gun.bink = section.Bink
    if (section.MovementAcc !== undefined) gun.movementAcc = section.MovementAcc
    if (section.BulletSpread !== undefined) gun.bulletSpread = section.BulletSpread
    if (section.Recoil !== undefined) gun.recoil = section.Recoil
    if (section.Push !== undefined) gun.push = section.Push
    if (section.InheritedVelocity !== undefined) gun.inheritedVelocity = section.InheritedVelocity
    if (section.ModifierLegs !== undefined) gun.modifierLegs = section.ModifierLegs
    if (section.ModifierChest !== undefined) gun.modifierChest = section.ModifierChest
    if (section.ModifierHead !== undefined) gun.modifierHead = section.ModifierHead
    if (section.NoCollision !== undefined) gun.noCollision = section.NoCollision
  }

  buildWeapons()
}
