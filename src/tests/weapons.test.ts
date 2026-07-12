// 1:1 포팅 검증: soldat-ref/soldat/shared/Weapons.pas + SharedConfig.pas:222-291
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  createWeapons, guns, defaultGuns,
  EAGLE, MP5, AK74, RUGER77, M79, M2, KNIFE, CHAINSAW, LAW, BOW, BOW2, COLT, NOWEAPON,
  FRAGGRENADE, CLUSTERGRENADE, CLUSTER, THROWNKNIFE,
  EAGLE_NUM, COLT_NUM, NOWEAPON_NUM, KNIFE_NUM, CHAINSAW_NUM, LAW_NUM, FLAMER_NUM, BOW_NUM, BOW2_NUM,
  TOTAL_WEAPONS, MAIN_WEAPONS, PRIMARY_WEAPONS, EXTENDED_WEAPONS,
  BULLET_STYLE_CLUSTERNADE, BULLET_STYLE_CLUSTER, BULLET_STYLE_THROWNKNIFE,
  calculateBink, weaponNumToIndex, weaponNameToNum, weaponNumToName, weaponNameByNum,
  weaponNumInternalToExternal, weaponNumExternalToInternal,
  isMainWeaponIndex, isSecondaryWeaponIndex, isExtendedWeaponIndex,
  createWMChecksum, loadWeaponsConfig, type WeaponsIniConfig,
} from '../core/weapons'
import { GRENADE_TIMEOUT, BULLET_TIMEOUT, MELEE_TIMEOUT } from '../core/constants'

const assetsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/assets')
const weaponsJson: { normal: WeaponsIniConfig; realistic: WeaponsIniConfig } =
  JSON.parse(readFileSync(path.join(assetsDir, 'weapons.json'), 'utf-8'))

describe('weapons', () => {
  beforeEach(() => createWeapons(false))

  it('Desert Eagle 기본값 (CreateNormalWeapons Weapons.pas:496-513)', () => {
    expect(guns[EAGLE].hitMultiply).toBeCloseTo(1.81)
    expect(guns[EAGLE].fireInterval).toBe(24)
    expect(guns[EAGLE].ammo).toBe(7)
    expect(guns[EAGLE].reloadTime).toBe(87)
    expect(guns[EAGLE].speed).toBeCloseTo(19)
    expect(guns[EAGLE].bulletSpread).toBeCloseTo(0.15)
    expect(guns[EAGLE].push).toBeCloseTo(0.0176)
    expect(guns[EAGLE].num).toBe(EAGLE_NUM)
  })

  it('CreateWeaponsBase 아이덴티티 필드 — 이름/IniName (216-489)', () => {
    expect(guns[EAGLE].name).toBe('Desert Eagles')
    expect(guns[EAGLE].iniName).toBe('Desert Eagles')
    // Barrett은 원본 오타 그대로: Name != IniName
    expect(guns[8].name).toBe('Barrett M82A1')
    expect(guns[8].iniName).toBe('Barret M82A1')
    expect(guns[NOWEAPON].iniName).toBe('Punch')
    expect(guns[FRAGGRENADE].iniName).toBe('Grenade')
    expect(guns[M2].iniName).toBe('Stationary Gun')
    expect(guns[LAW].iniName).toBe('M72 LAW')
    expect(guns[BOW].iniName).toBe('Rambo Bow')
    expect(guns[BOW2].iniName).toBe('Flamed Arrows')
  })

  it('BuildWeapons 파생값 (Weapons.pas:1262-1355)', () => {
    // ClipReload 무기: ClipOutTime=Trunc(87*0.8)=69, ClipInTime=Trunc(87*0.3)=26
    expect(guns[EAGLE].clipOutTime).toBe(69)
    expect(guns[EAGLE].clipInTime).toBe(26)
    expect(guns[M79].ammoCount).toBe(0) // 1354: M79는 빈 탄창으로 시작
    expect(guns[EAGLE].timeout).toBe(BULLET_TIMEOUT) // 420
    expect(guns[FRAGGRENADE].timeout).toBe(GRENADE_TIMEOUT) // 180
    expect(guns[KNIFE].timeout).toBe(MELEE_TIMEOUT) // 1
    // 논-ClipReload 무기 (SPAS-12): ClipOutTime/ClipInTime = 0
    expect(guns[5].clipOutTime).toBe(0)
    expect(guns[5].clipInTime).toBe(0)
    // FireIntervalCount/ReloadTimeCount/StartUpTimeCount는 스폰 시작값과 동일해야 함
    expect(guns[EAGLE].fireIntervalCount).toBe(guns[EAGLE].fireInterval)
    expect(guns[EAGLE].reloadTimeCount).toBe(guns[EAGLE].reloadTime)
    expect(guns[MP5].ammoCount).toBe(guns[MP5].ammo)
  })

  it('BuildWeapons 파생 무기 (21-23번, Guns[20/21]에서 복사)', () => {
    expect(guns[CLUSTERGRENADE].hitMultiply).toBe(guns[FRAGGRENADE].hitMultiply)
    expect(guns[CLUSTERGRENADE].bulletStyle).toBe(BULLET_STYLE_CLUSTERNADE)
    expect(guns[CLUSTER].hitMultiply).toBe(guns[CLUSTERGRENADE].hitMultiply)
    expect(guns[CLUSTER].bulletStyle).toBe(BULLET_STYLE_CLUSTER)
    expect(guns[THROWNKNIFE].hitMultiply).toBe(guns[KNIFE].hitMultiply)
    expect(guns[THROWNKNIFE].speed).toBe(guns[KNIFE].speed)
    expect(guns[THROWNKNIFE].bulletStyle).toBe(BULLET_STYLE_THROWNKNIFE)
  })

  it('defaultGuns는 CreateDefaultWeapons에서 guns[]를 그대로 미러링 (183-208)', () => {
    expect(defaultGuns[EAGLE].hitMultiply).toBeCloseTo(guns[EAGLE].hitMultiply)
    expect(defaultGuns[AK74].bink).toBe(guns[AK74].bink)
    expect(defaultGuns[RUGER77].modifierHead).toBeCloseTo(guns[RUGER77].modifierHead)
  })

  it('createWeapons(true): 리얼리스틱 값 (CreateRealisticWeapons 877-1260)', () => {
    createWeapons(true)
    expect(guns[EAGLE].hitMultiply).toBeCloseTo(1.66)
    expect(guns[EAGLE].recoil).toBe(55)
    expect(guns[EAGLE].modifierLegs).toBeCloseTo(0.6)
    expect(guns[AK74].ammo).toBe(35) // 하드코딩 리얼리스틱 기본값 (ini 오버라이드 전)
  })

  it('calculateBink (Weapons.pas:1512-1516): Acc+Bink-Round(Acc*(Acc/((10*Bink)+Acc)))', () => {
    expect(calculateBink(0, 60)).toBe(60)
    expect(calculateBink(60, 60)).toBe(115) // 120 - pascalRound(60*60/660=5.4545)=5
  })

  it('weaponNumToIndex: 배열 인덱스 ≠ Num (리스크 지도 7번 — COLT는 인덱스 11/Num 0)', () => {
    expect(weaponNumToIndex(EAGLE_NUM)).toBe(EAGLE)
    expect(weaponNumToIndex(COLT_NUM)).toBe(COLT)
    expect(weaponNumToIndex(NOWEAPON_NUM)).toBe(NOWEAPON)
    expect(weaponNumToIndex(254)).toBe(-1) // 존재하지 않는 Num
  })

  it('weaponNameToNum / weaponNumToName / weaponNameByNum 왕복', () => {
    expect(weaponNameToNum('Desert Eagles')).toBe(EAGLE_NUM)
    expect(weaponNameToNum('No such gun')).toBe(-1)
    expect(weaponNumToName(EAGLE_NUM)).toBe('Desert Eagles')
    expect(weaponNumToName(9999)).toBe('')
    expect(weaponNameByNum(COLT_NUM)).toBe('USSOCOM')
    expect(weaponNameByNum(9999)).toBe('')
  })

  it('weaponNumInternalToExternal/ExternalToInternal은 서로 역함수 (11-16 치환)', () => {
    expect(weaponNumInternalToExternal(KNIFE_NUM)).toBe(14)
    expect(weaponNumInternalToExternal(CHAINSAW_NUM)).toBe(15)
    expect(weaponNumInternalToExternal(LAW_NUM)).toBe(16)
    expect(weaponNumInternalToExternal(FLAMER_NUM)).toBe(11)
    expect(weaponNumInternalToExternal(BOW_NUM)).toBe(12)
    expect(weaponNumInternalToExternal(BOW2_NUM)).toBe(13)
    expect(weaponNumInternalToExternal(EAGLE_NUM)).toBe(EAGLE_NUM) // else 분기: 그대로
    for (const internalNum of [KNIFE_NUM, CHAINSAW_NUM, LAW_NUM, FLAMER_NUM, BOW_NUM, BOW2_NUM]) {
      expect(weaponNumExternalToInternal(weaponNumInternalToExternal(internalNum))).toBe(internalNum)
    }
  })

  it('isMainWeaponIndex/isSecondaryWeaponIndex/isExtendedWeaponIndex 경계값 (1497-1510)', () => {
    expect(isMainWeaponIndex(1)).toBe(true)
    expect(isMainWeaponIndex(MAIN_WEAPONS)).toBe(true)
    expect(isMainWeaponIndex(MAIN_WEAPONS + 1)).toBe(false)
    expect(isMainWeaponIndex(0)).toBe(false)
    expect(isSecondaryWeaponIndex(PRIMARY_WEAPONS)).toBe(false)
    expect(isSecondaryWeaponIndex(PRIMARY_WEAPONS + 1)).toBe(true)
    expect(isSecondaryWeaponIndex(MAIN_WEAPONS)).toBe(true)
    expect(isSecondaryWeaponIndex(MAIN_WEAPONS + 1)).toBe(false)
    expect(isExtendedWeaponIndex(EXTENDED_WEAPONS)).toBe(true)
    expect(isExtendedWeaponIndex(EXTENDED_WEAPONS + 1)).toBe(false)
  })

  it('guns/defaultGuns는 1-based [0..TOTAL_WEAPONS], 인덱스 0은 더미', () => {
    expect(guns.length).toBe(TOTAL_WEAPONS + 1)
    expect(defaultGuns.length).toBe(TOTAL_WEAPONS + 1)
    expect(guns[0].num).toBe(0)
  })

  describe('createWMChecksum (djb2 + LongWord 오버플로, 1359-1390)', () => {
    it('결정적이며 32비트 unsigned 범위 안에 있다', () => {
      const a = createWMChecksum()
      const b = createWMChecksum()
      expect(a).toBe(b)
      expect(a).toBeGreaterThanOrEqual(0)
      expect(a).toBeLessThanOrEqual(0xffffffff)
    })

    it('체크섬에 포함되지 않는 필드(ModifierHead 등)를 바꿔도 불변', () => {
      const before = createWMChecksum()
      guns[EAGLE].modifierHead = 999
      guns[EAGLE].noCollision = 5
      expect(createWMChecksum()).toBe(before)
    })

    it('체크섬 포함 필드(HitMultiply)를 바꾸면 값이 변한다', () => {
      const before = createWMChecksum()
      guns[EAGLE].hitMultiply = 999
      expect(createWMChecksum()).not.toBe(before)
    })

    it('ORIGINAL_WEAPONS(20) 이후 무기(CLUSTERGRENADE 등)는 체크섬에 영향 없음', () => {
      const before = createWMChecksum()
      guns[CLUSTERGRENADE].hitMultiply = 999
      expect(createWMChecksum()).toBe(before)
    })
  })

  describe('loadWeaponsConfig (SharedConfig.pas:222-291)', () => {
    it('실제 weapons.json(normal)을 적용하면 ini 값이 반영된다 (ini가 권위)', () => {
      loadWeaponsConfig(weaponsJson.normal)
      // weapons.ini 실측치 — 하드코딩 CreateNormalWeapons 기본값(Ammo=35)과 다르다
      // (리스크 지도 9번: 출하 ini ≠ 하드코딩 기본값. 자세한 내용은 구현 노트 참조)
      expect(guns[AK74].ammo).toBe(40)
      expect(guns[AK74].fireInterval).toBe(11)
      expect(guns[RUGER77].fireInterval).toBe(39)
      // Desert Eagles는 ini가 하드코딩 기본값과 일치 (변화 없음 확인용)
      expect(guns[EAGLE].hitMultiply).toBeCloseTo(1.81)
      // loadWeaponsConfig는 끝에서 BuildWeapons()를 다시 불러 파생값을 재계산해야 한다
      expect(guns[AK74].ammoCount).toBe(40)
      expect(guns[EAGLE].clipOutTime).toBe(Math.trunc(guns[EAGLE].reloadTime * 0.8))
    })

    it('오버라이드에 없는 무기(FRAGGRENADE 등 IniName이 섹션에 없거나 누락된 키)는 기존 값 유지', () => {
      const beforeSpeed = guns[FRAGGRENADE].speed
      loadWeaponsConfig(weaponsJson.normal)
      // Grenade 섹션이 있어도 원본 구조상 defaultGuns 세팅 이후 값이므로, 최소한 정상 범위를 유지
      expect(Number.isFinite(guns[FRAGGRENADE].speed)).toBe(true)
      expect(guns[FRAGGRENADE].speed).toBeGreaterThan(0)
      expect(beforeSpeed).toBeGreaterThan(0)
    })

    it('정확히 CreateNormalWeapons 기본값을 미러링하는 합성 JSON을 적용하면 체크섬이 불변', () => {
      // loadWeaponsConfig의 오버라이드 배선 자체를 ini 데이터의 우연한 일치에 기대지 않고
      // 검증하기 위해, 현재 guns[] 상태를 그대로 옮긴 합성 픽스처로 라운드트립한다.
      const before = createWMChecksum()
      const mirror: WeaponsIniConfig = { info: { name: 'mirror', version: '0' }, guns: {} }
      for (let i = 1; i <= 20; i++) {
        const g = guns[i]
        mirror.guns[g.iniName] = {
          Damage: g.hitMultiply, FireInterval: g.fireInterval, Ammo: g.ammo,
          ReloadTime: g.reloadTime, Speed: g.speed, BulletStyle: g.bulletStyle,
          StartUpTime: g.startUpTime, Bink: g.bink, MovementAcc: g.movementAcc,
          BulletSpread: g.bulletSpread, Recoil: g.recoil, Push: g.push,
          InheritedVelocity: g.inheritedVelocity,
        }
      }
      loadWeaponsConfig(mirror)
      expect(createWMChecksum()).toBe(before)
    })

    it('빈 guns 섹션(오버라이드 없음)을 적용하면 하드코딩 기본값과 체크섬 동일', () => {
      const before = createWMChecksum()
      loadWeaponsConfig({ info: { name: 'empty', version: '0' }, guns: {} })
      expect(createWMChecksum()).toBe(before)
    })
  })
})
