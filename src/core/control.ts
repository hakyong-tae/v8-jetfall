// 1:1 포팅: soldat-ref/soldat/shared/mechanics/Control.pas (2159 lines)
// 입력 → 이동 상태기계. ControlSprite가 곧 Soldat의 조작감(달리기/점프/제트/엎드리기/구르기/
// 백플립)이므로 분기·프레임 번호를 원본 그대로 옮긴다.
//
// 빌드 기준 (constants.ts/sprites.ts와 동일): 이 포트는 권위 로컬 심 = SERVER 변형.
// {$IFDEF SERVER}/{$ELSE} 상호배타 쌍은 SERVER 분기를 채택하고 클라 분기는 주석으로 남긴다.
// 단, 두 가지 "로컬 플레이어" 예외를 명시적으로 채택한다 (원본에서 {$IFNDEF SERVER}이지만
// 네트워크 없는 로컬 심에서는 이 코드가 없으면 인간 조작 자체가 성립하지 않는 부분):
//   1) 동시 키 입력 해석 (Control.pas:139-201) — 좌+우 방향 결정과 nade/change/throw/reload
//      충돌 해소. 원본 클라는 MySprite에 대해서만 수행 → 이 포트는 HUMAN 스프라이트 전부에
//      수행 (모든 인간이 로컬). 상태는 GameState.was* (state.ts 참조).
//   2) `(SpriteC.Num = MySprite) or (ControlMethod = BOT)` 꼴 게이트 (무기 스왑 669,
//      나이프 던지기 719) — 모든 스프라이트가 로컬이므로 항상 참으로 취급.
// 반대로 입력 샘플링(FreeControls+Binds 루프+MouseAim 갱신, 104-137)은 웹 입력 레이어/테스트가
// controlSprite 호출 전에 control 필드를 채우는 것으로 대체되어 미채택.
//
// 총기 식별: M1의 GUN_EQ/GUN_NEQ 자리표시자는 M2 Task 7에서 전부 실제
// `spriteC.weapon.num === guns[X].num` 비교로 교체·삭제되었다 (guns[]는 weapons.ts, T1).
//
// 유닛 전역: Control.pas:25-34의 WasRunningLeft/WasJumping/WasThrowingGrenade/
// WasChangingWeapon/WasThrowingWeapon/WasReloadingWeapon ({$IFNDEF SERVER}) → GameState로 승격
// (state.ts 헤더 참조). FreeCamPressed는 관전 카메라 전용이라 미채택.

import {
  vector2,
  cloneVec2,
  vec2Add,
  vec2Subtract,
  vec2Scale,
  vec2Length,
  vec2Normalize,
  vec2Dot,
} from './vector'
import { pascalRound, random } from './pascal'
import { distanceVec2 } from './calc'
import {
  TSprite,
  cloneAnimation,
  MAX_SPRITES,
  HUMAN,
  BOT,
  SPRITE_RADIUS,
  POS_STAND,
  POS_CROUCH,
  POS_PRONE,
} from './sprites'
import {
  guns,
  NOWEAPON,
  KNIFE,
  CHAINSAW,
  LAW,
  M79,
  SPAS12,
  BOW,
  BOW2,
  BARRETT,
  MINIGUN,
  M249,
  THROWNKNIFE,
} from './weapons'
import { createBullet } from './bullets'
import { type GameState, isTeamGame } from './state'
import {
  RUNSPEED,
  RUNSPEEDUP,
  FLYSPEED,
  JUMPSPEED,
  CROUCHRUNSPEED,
  PRONESPEED,
  ROLLSPEED,
  JUMPDIRSPEED,
  JETSPEED,
  DEFAULTAIMDIST,
  SNIPERAIMDIST,
  CROUCHAIMDIST,
  AIMDISTINCR,
  M2GUN_OVERHEAT,
  BONUS_FLAMEGOD,
  DEFAULT_IDLETIME,
  LONGER_IDLETIME,
  MELEE_DIST,
} from './constants'


// Control.pas:36-59 CheckSpriteLineOfSightVisibility
export function checkSpriteLineOfSightVisibility(
  gs: GameState,
  lookSprite: TSprite,
  spriteToCheck: TSprite,
): boolean {
  let result = false
  // Do we look in the right direction?
  let startPoint = vector2(
    spriteToCheck.skeleton.pos[7].x - lookSprite.skeleton.pos[7].x,
    spriteToCheck.skeleton.pos[7].y - (lookSprite.skeleton.pos[7].y - 2),
  )
  let lookPoint = vector2(
    lookSprite.control.mouseAimX - lookSprite.skeleton.pos[7].x,
    lookSprite.control.mouseAimY - (lookSprite.skeleton.pos[7].y - 2),
  )
  startPoint = vec2Normalize(startPoint)
  lookPoint = vec2Normalize(lookPoint)
  if (vec2Dot(startPoint, lookPoint) > 0.0) {
    // 0.5 = 90 fov, 0.0 = 180 fov, -0.5 = 270 fov
    lookPoint = vector2(lookSprite.skeleton.pos[7].x, lookSprite.skeleton.pos[7].y - 2)
    startPoint = cloneVec2(spriteToCheck.skeleton.pos[7])
    // Is it even possible to see the player
    // (Pascal의 var D2 out-param은 호출부에서 미사용 — 반환 객체의 distance 무시)
    if (!gs.map.rayCast(lookPoint, startPoint, 1001, false, false, false).hit) {
      result = true
    }
  }
  return result
}

// Control.pas:61-66 AreConflictingKeysPressed
export function areConflictingKeysPressed(spriteC: TSprite): boolean {
  // True if more than one of the keys are pressed
  return (
    Number(spriteC.control.throwNade) +
      Number(spriteC.control.changeWeapon) +
      Number(spriteC.control.throwWeapon) +
      Number(spriteC.control.reload) >
    1
  )
}

// Control.pas:68-2159 ControlSprite(var SpriteC: TSprite)
// 원본과 동일하게 단일 프로시저 — 구역 주석(═══)으로만 구분한다.
export function controlSprite(gs: GameState, spriteC: TSprite): void {
  const anims = gs.anims
  const num = spriteC.num

  let b = vector2(0, 0)
  let playerPressedLeftRight = false

  switch (spriteC.style) {
    case 1: {
      // Gostek

      /* ═══════════════ safety (Control.pas:84-100) ═══════════════ */
      if (
        spriteC.weapon.ammoCount > spriteC.weapon.ammo ||
        spriteC.weapon.fireIntervalCount > spriteC.weapon.fireInterval ||
        spriteC.weapon.reloadTimeCount > spriteC.weapon.reloadTime
      ) {
        spriteC.applyWeaponByNum(spriteC.weapon.num, 1)
        spriteC.weapon.ammoCount = 0
        // {$IFNDEF SERVER} if (Num = MySprite) and not DeadMeat then ClientSpriteSnapshot
        //   — 네트워크 스냅샷, 미채택
      }

      if (spriteC.legsAnimation.speed < 1) spriteC.legsAnimation.speed = 1
      if (spriteC.bodyAnimation.speed < 1) spriteC.bodyAnimation.speed = 1

      /* ═══════ {$IFNDEF SERVER} 로컬 입력 해석 (Control.pas:101-294) ═══════
       * 원본 클라는 (Num = MySprite) and not EscMenu.Active일 때 키보드/마우스에서 Control을
       * 채운다. 입력 샘플링(FreeControls + MouseAim + Binds 루프, 104-137)은 입력 레이어
       * 소관이라 미채택. TeamMenu/LimboMenu/ChatText 게이트(109-112)는 이 포트에 메뉴·채팅이
       * 없어 항상 통과. 동시 키 해석(139-201)만 HUMAN 스프라이트에 채택 (파일 헤더 예외 1). */
      if (spriteC.player!.controlMethod === HUMAN) {
        // If both left and right directions are pressed, then decide which direction to go in
        if (spriteC.control.left && spriteC.control.right) {
          // Remember that both directions were pressed, as it's useful for some moves
          playerPressedLeftRight = true

          if (gs.wasJumping) {
            // If jumping, keep going in the old direction
            if (gs.wasRunningLeft) spriteC.control.right = false
            else spriteC.control.left = false
          } else {
            // If not jumping, instead go in the new direction
            if (gs.wasRunningLeft) spriteC.control.left = false
            else spriteC.control.right = false
          }
        } else {
          gs.wasRunningLeft = spriteC.control.left
          gs.wasJumping = spriteC.control.up
        }

        // Handle simultaneous key presses that would conflict
        if (areConflictingKeysPressed(spriteC)) {
          // At least two buttons pressed, so deactivate any previous one
          if (gs.wasThrowingGrenade) spriteC.control.throwNade = false
          else if (gs.wasChangingWeapon) spriteC.control.changeWeapon = false
          else if (gs.wasThrowingWeapon) spriteC.control.throwWeapon = false
          else if (gs.wasReloadingWeapon) spriteC.control.reload = false

          // If simultaneously pressing two or more new buttons, then deactivate them in order
          // of least prefecence
          while (areConflictingKeysPressed(spriteC)) {
            if (spriteC.control.reload) spriteC.control.reload = false
            else if (spriteC.control.changeWeapon) spriteC.control.changeWeapon = false
            else if (spriteC.control.throwWeapon) spriteC.control.throwWeapon = false
            else if (spriteC.control.throwNade) spriteC.control.throwNade = false
          }
        } else {
          // At most one of these will be true
          gs.wasThrowingGrenade = spriteC.control.throwNade
          gs.wasChangingWeapon = spriteC.control.changeWeapon
          gs.wasThrowingWeapon = spriteC.control.throwWeapon
          gs.wasReloadingWeapon = spriteC.control.reload
        }

        // 채팅 발사(205-211) / FreeCam 해제(213-215) / 사망 시 관전 카메라 전환(217-255) /
        // Fog of War 가시성 갱신(257-292, sv_realisticmode + CheckSpriteLineOfSightVisibility)
        // — 전부 클라 UI·카메라·렌더 가시성. 미채택 (시야 판정 함수 자체는 위에 포팅되어 있음).
      }

      // {$IFDEF SERVER} ControlBot(SpriteC) (Control.pas:295-297)
      // TODO(M3): AI.pas ControlBot 포팅 시 BOT 스프라이트의 control 필드를 여기서 채운다
      // (브레인 상태는 TSprite.brain: TBotData로 준비되어 있음).

      /* ═══════════════ 공통 전처리 (Control.pas:299-311) ═══════════════ */
      if (spriteC.deadMeat) spriteC.freeControls()
      if (gs.mapChangeCounter > 0) spriteC.freeControls()

      spriteC.fired = 0

      spriteC.control.mouseAimX = pascalRound(
        spriteC.control.mouseAimX + gs.spriteParts.velocity[num].x,
      )
      spriteC.control.mouseAimY = pascalRound(
        spriteC.control.mouseAimY + gs.spriteParts.velocity[num].y,
      )

      // use weapons
      b.x = 0
      b.y = 0

      /* ═══════════════ Jets / 백플립 (Control.pas:313-388) ═══════════════ */
      if (
        spriteC.control.jetpack &&
        ((spriteC.legsAnimation.id === anims.jumpSide.id &&
          ((spriteC.direction === -1 && spriteC.control.right) ||
            (spriteC.direction === 1 && spriteC.control.left) ||
            playerPressedLeftRight)) ||
          (spriteC.legsAnimation.id === anims.rollBack.id && spriteC.control.up))
      ) {
        spriteC.bodyApplyAnimation(anims.rollBack, 1)
        spriteC.legsApplyAnimation(anims.rollBack, 1)
      } else if (spriteC.control.jetpack && spriteC.jetsCount > 0) {
        // 원본 `iif(GRAV > 0.05, JETSPEED, Grav * 2)` — Pascal은 대소문자 무관이고 Constants에
        // GRAV 상수가 없으므로 GRAV ≡ Grav 전역(= gs.grav). 저중력 모드에서 제트 추력을 줄인다.
        if (spriteC.onGround) {
          gs.spriteParts.forces[num].y = -2.5 * (gs.grav > 0.05 ? JETSPEED : gs.grav * 2)
        }

        if (!spriteC.onGround) {
          if (spriteC.position !== POS_PRONE) {
            gs.spriteParts.forces[num].y =
              gs.spriteParts.forces[num].y - (gs.grav > 0.05 ? JETSPEED : gs.grav * 2)
          } else {
            gs.spriteParts.forces[num].x =
              gs.spriteParts.forces[num].x +
              (spriteC.direction * (gs.grav > 0.05 ? JETSPEED : gs.grav * 2)) / 2
          }
        }

        if (
          spriteC.legsAnimation.id !== anims.getUp.id &&
          spriteC.bodyAnimation.id !== anims.roll.id &&
          spriteC.bodyAnimation.id !== anims.rollBack.id
        ) {
          spriteC.legsApplyAnimation(anims.fall, 1)
        }
        // {$IFNDEF SERVER} 제트 연기/스파크 CreateSpark ×4 (345-371) — TODO(M2/render)
        spriteC.jetsCount--
        // {$IFNDEF SERVER} if (JetsCount = 1) and Control.Jetpack then JetsCount := 0 (375-376)
        //   — 클라 전용 마지막-틱 스냅. 서버 변형에 없음 → 미채택.
        // {$IFNDEF SERVER} PlaySound(SFX_ROCKETZ) — TODO(M2/render)
      } else {
        // {$IFNDEF SERVER} StopSound(JetsSoundChannel) — TODO(M2/render)
      }
      // Jets

      /* ═══════════════ KOLBA — 근접 개머리판 (Control.pas:390-404) ═══════════════ */
      if (spriteC.stat === 0) {
        if (spriteC.position === POS_STAND) {
          if (spriteC.control.fire && spriteC.ceaseFireCounter < 0) {
            if (
              spriteC.weapon.num !== guns[NOWEAPON].num &&
              spriteC.weapon.num !== guns[KNIFE].num &&
              spriteC.weapon.num !== guns[CHAINSAW].num
            ) {
              for (let i = 1; i <= MAX_SPRITES; i++) {
                if (
                  gs.sprite[i].active &&
                  !gs.sprite[i].deadMeat &&
                  gs.sprite[i].position === POS_STAND &&
                  i !== spriteC.num &&
                  gs.sprite[i].isNotSpectator()
                ) {
                  if (distanceVec2(gs.spriteParts.pos[spriteC.num], gs.spriteParts.pos[i]) < MELEE_DIST) {
                    spriteC.bodyApplyAnimation(anims.melee, 1)
                  }
                }
              }
            }
          }
        }
      }

      /* ═══════════════ FIRE!!!! (Control.pas:406-516) ═══════════════ */
      // (not TargetMode or (SpriteC.Num <> MySprite))
      if (spriteC.stat === 0) {
        if (
          spriteC.weapon.num === guns[CHAINSAW].num ||
          (spriteC.bodyAnimation.id !== anims.roll.id &&
            spriteC.bodyAnimation.id !== anims.rollBack.id &&
            spriteC.bodyAnimation.id !== anims.melee.id &&
            spriteC.bodyAnimation.id !== anims.change.id)
        ) {
          if (
            (spriteC.bodyAnimation.id === anims.handsUpAim.id &&
              spriteC.bodyAnimation.currFrame === 11) ||
            spriteC.bodyAnimation.id !== anims.handsUpAim.id
          ) {
            if (spriteC.control.fire && spriteC.ceaseFireCounter < 0) {
              if (
                spriteC.weapon.num === guns[NOWEAPON].num ||
                spriteC.weapon.num === guns[KNIFE].num
              ) {
                spriteC.bodyApplyAnimation(anims.punch, 1)
              } else {
                if (spriteC.weapon.fireIntervalCount === 0 && spriteC.weapon.ammoCount > 0) {
                  if (spriteC.weapon.startUpTime > 0) {
                    // {$IFNDEF SERVER} StopSound(GattlingSoundChannel2) — TODO(M2/render)
                    if (spriteC.weapon.startUpTimeCount > 0) {
                      // {$IFNDEF SERVER} Barrett/Minigun/LAW 와인드업 사운드 (437-461)
                      //   — TODO(M2/render)
                      if (
                        spriteC.weapon.num !== guns[LAW].num ||
                        ((spriteC.onGround || spriteC.onGroundPermanent) &&
                          ((spriteC.legsAnimation.id === anims.crouch.id &&
                            spriteC.legsAnimation.currFrame > 13) ||
                            spriteC.legsAnimation.id === anims.crouchRun.id ||
                            spriteC.legsAnimation.id === anims.crouchRunBack.id ||
                            (spriteC.legsAnimation.id === anims.prone.id &&
                              spriteC.legsAnimation.currFrame > 23)))
                      ) {
                        spriteC.weapon.startUpTimeCount--
                      }
                    } else {
                      spriteC.fire()
                    }
                  } else {
                    spriteC.fire()
                  }
                }
              }
            } else {
              // {$IFNDEF SERVER} 발사키 뗌 (482-503): StopSound + 미니건/LAW 와인드다운 사운드
              //   + Weapon.StartUpTimeCount := Weapon.StartUpTime — 전체가 클라 전용 블록
              //   (StartUpTimeCount 리셋 포함) → 서버 변형 미채택.
            }
          }
        } else {
          if (spriteC.weapon.startUpTimeCount < spriteC.weapon.startUpTime) {
            spriteC.weapon.startUpTimeCount = spriteC.weapon.startUpTime
          }
          spriteC.burstCount = 0
        }
      }

      if (spriteC.player!.controlMethod === HUMAN) {
        if (!spriteC.control.fire) spriteC.burstCount = 0
      }

      // Fire Mode styles (Control.pas:522-536)
      switch (spriteC.weapon.fireMode) {
        case 2: {
          // Single shot
          if (spriteC.player!.controlMethod === HUMAN) {
            if (spriteC.control.fire) {
              if (
                (spriteC.burstCount > 0 || spriteC.control.reload) &&
                spriteC.weapon.fireIntervalCount < 2
              ) {
                spriteC.weapon.fireIntervalCount++
              }
            }
          }
          break
        }
      }

      /* ═══════════════ 깃발/수류탄 던지기 (Control.pas:538-554) ═══════════════ */
      // {$IFNDEF SERVER} TARGET MODE (540-549): 클라 관전 타깃 모드 해제 — 미채택.
      // {$ELSE} — 서버 분기 채택:
      spriteC.throwFlag()

      spriteC.throwGrenade()

      /* ═══════════════ 무기 교체/버리기/장전 애니메이션 (Control.pas:556-745) ═══════════════ */
      // change weapon animation
      if (
        spriteC.bodyAnimation.id !== anims.roll.id &&
        spriteC.bodyAnimation.id !== anims.rollBack.id &&
        spriteC.bonusStyle !== BONUS_FLAMEGOD
      ) {
        if (spriteC.control.changeWeapon) {
          spriteC.bodyApplyAnimation(anims.change, 1)
          // {$IFNDEF SERVER} SetSoundPaused(ReloadSoundChannel, True) — TODO(M2/render)
        }
      }

      // clear dont drop flag if needed
      // {$IFNDEF SERVER} (569-573) — DontDrop은 나이프 던지기(로컬 채택 경로)가 세팅하는
      // 플래그라 해제도 함께 채택 (파일 헤더 예외 2와 짝).
      if (spriteC.dontDrop) {
        if (!spriteC.control.throwWeapon || spriteC.weapon.num === guns[KNIFE].num) {
          spriteC.dontDrop = false
        }
      }

      // throw weapon animation
      if (
        spriteC.control.throwWeapon &&
        !spriteC.control.throwNade &&
        !spriteC.dontDrop &&
        spriteC.bodyAnimation.id !== anims.roll.id &&
        spriteC.bodyAnimation.id !== anims.rollBack.id &&
        (spriteC.bodyAnimation.id !== anims.change.id || spriteC.bodyAnimation.currFrame > 25) &&
        spriteC.bonusStyle !== BONUS_FLAMEGOD &&
        spriteC.weapon.num !== guns[BOW].num &&
        spriteC.weapon.num !== guns[BOW2].num &&
        spriteC.weapon.num !== guns[NOWEAPON].num
      ) {
        spriteC.bodyApplyAnimation(anims.throwWeapon, 1)

        if (spriteC.weapon.num === guns[KNIFE].num) spriteC.bodyAnimation.speed = 2

        // {$IFNDEF SERVER} StopSound(ReloadSoundChannel) — TODO(M2/render)
      }

      // reload
      if (
        spriteC.weapon.num === guns[CHAINSAW].num ||
        (spriteC.bodyAnimation.id !== anims.roll.id &&
          spriteC.bodyAnimation.id !== anims.rollBack.id &&
          spriteC.bodyAnimation.id !== anims.change.id)
      ) {
        if (spriteC.control.reload) {
          if (spriteC.weapon.ammoCount !== spriteC.weapon.ammo) {
            if (spriteC.weapon.num === guns[SPAS12].num) {
              if (spriteC.weapon.ammoCount < spriteC.weapon.ammo) {
                if (spriteC.weapon.fireIntervalCount === 0) {
                  spriteC.bodyApplyAnimation(anims.reload, 1)
                } else {
                  spriteC.autoReloadWhenCanFire = true
                }
              }
            } else {
              spriteC.weapon.ammoCount = 0
              spriteC.weapon.fireIntervalPrev = spriteC.weapon.fireInterval
              spriteC.weapon.fireIntervalCount = spriteC.weapon.fireInterval
            }
            spriteC.burstCount = 0
          }
        }
      }

      // reload shotgun / reload spas (Control.pas:628-645)
      if (spriteC.bodyAnimation.id === anims.reload.id && spriteC.bodyAnimation.currFrame === 7) {
        // {$IFNDEF SERVER} PlaySound(SFX_SPAS12_RELOAD) — TODO(M2/render)
        spriteC.bodyAnimation.currFrame++
      }

      if (!spriteC.control.fire || spriteC.weapon.ammoCount === 0) {
        if (spriteC.bodyAnimation.id === anims.reload.id && spriteC.bodyAnimation.currFrame === 14) {
          spriteC.weapon.ammoCount = spriteC.weapon.ammoCount + 1
          if (spriteC.weapon.ammoCount < spriteC.weapon.ammo) {
            spriteC.bodyAnimation.currFrame = 1
          }
        }
      }

      // Change Weapon
      // sound (Control.pas:648-663)
      if (spriteC.bodyAnimation.id === anims.change.id && spriteC.bodyAnimation.currFrame === 2) {
        // {$IFNDEF SERVER} 보조무기별 체인지 사운드 (653-660) — TODO(M2/render)
        spriteC.bodyAnimation.currFrame++
      }

      if (
        spriteC.bodyAnimation.id === anims.change.id &&
        spriteC.bodyAnimation.currFrame === 25 &&
        spriteC.bonusStyle !== BONUS_FLAMEGOD
      ) {
        // if {$IFNDEF SERVER}(SpriteC.Num = MySprite) or {$ENDIF} (ControlMethod = BOT)
        // — 모든 스프라이트가 로컬(원본의 MySprite 상당)이라 항상 참 → 무조건 실행 (헤더 예외 2).
        {
          // TempGun := Weapon; Weapon := SecondaryWeapon; SecondaryWeapon := TempGun
          // (record 3중 복사 = 순수 스왑 → 참조 스왑으로 관찰 동등)
          const tempGun = spriteC.weapon
          spriteC.weapon = spriteC.secondaryWeapon
          spriteC.secondaryWeapon = tempGun

          spriteC.lastWeaponHM = spriteC.weapon.hitMultiply
          spriteC.lastWeaponStyle = spriteC.weapon.bulletStyle
          spriteC.lastWeaponSpeed = spriteC.weapon.speed
          spriteC.lastWeaponFire = spriteC.weapon.fireInterval
          spriteC.lastWeaponReload = spriteC.weapon.reloadTime

          spriteC.weapon.startUpTimeCount = spriteC.weapon.startUpTime
          spriteC.weapon.reloadTimePrev = spriteC.weapon.reloadTimeCount

          spriteC.burstCount = 0
        }
      }

      if (
        spriteC.bodyAnimation.id === anims.change.id &&
        spriteC.bodyAnimation.currFrame === anims.change.numFrames &&
        spriteC.bonusStyle !== BONUS_FLAMEGOD &&
        spriteC.weapon.ammoCount === 0
      ) {
        spriteC.bodyApplyAnimation(anims.stand, 1)
        // {$IFNDEF SERVER} SetSoundPaused(ReloadSoundChannel, False) — TODO(M2/render)
      }

      // Throw away weapon (Control.pas:699-712)
      // {$IFNDEF SERVER} ThrowWeapon frame 2 → PlaySound(SFX_THROWGUN) — TODO(M2/render)
      if (spriteC.weapon.num !== guns[KNIFE].num) {
        if (
          spriteC.bodyAnimation.id === anims.throwWeapon.id &&
          spriteC.bodyAnimation.currFrame === 19 &&
          spriteC.weapon.num !== guns[NOWEAPON].num
        ) {
          spriteC.dropWeapon()
          spriteC.bodyApplyAnimation(anims.stand, 1)
        }
      }

      // Throw knife (Control.pas:714-745)
      if (
        spriteC.weapon.num === guns[KNIFE].num &&
        spriteC.bodyAnimation.id === anims.throwWeapon.id &&
        (!spriteC.control.throwWeapon || spriteC.bodyAnimation.currFrame === 16)
      ) {
        // (ControlMethod = BOT) or {$IFNDEF SERVER}(Num = MySprite){$ENDIF} — 로컬 심: 항상 참.
        {
          // {$IFNDEF SERVER} DontDrop := True + 강제 스냅샷 전송 플래그 (722-727)
          //   — DontDrop 세팅은 로컬 채택, 스냅샷은 네트워크라 미채택.
          spriteC.dontDrop = true
          b = spriteC.getCursorAimDirection()
          // PlayerVelocity := Velocity * Guns[THROWNKNIFE].InheritedVelocity (Control.pas:728-745)
          const playerVelocity = vec2Scale(
            gs.spriteParts.velocity[num],
            guns[THROWNKNIFE].inheritedVelocity,
          )
          const d = Math.min(Math.max(spriteC.bodyAnimation.currFrame, 8), 16) / 16
          b = vec2Scale(b, guns[THROWNKNIFE].speed * 1.5 * d)
          b = vec2Add(b, playerVelocity)
          const a = cloneVec2(spriteC.skeleton.pos[16])
          createBullet(
            gs, a, b, guns[THROWNKNIFE].num, num, 255,
            guns[THROWNKNIFE].hitMultiply, true, false,
          )
          spriteC.applyWeaponByNum(guns[NOWEAPON].num, 1)
          spriteC.bodyApplyAnimation(anims.stand, 1)
          // {$IFNDEF SERVER} ClientSpriteSnapshot — 미채택
        }
      }

      /* ═══════════════ 펀치/개머리판/탄피 (Control.pas:747-823) ═══════════════ */
      // Punch!
      if (!spriteC.deadMeat) {
        if (
          spriteC.bodyAnimation.id === anims.punch.id &&
          spriteC.bodyAnimation.currFrame === 11 &&
          spriteC.weapon.num !== guns[LAW].num &&
          spriteC.weapon.num !== guns[M79].num
        ) {
          // Control.pas:753-761
          const a = vector2(
            spriteC.skeleton.pos[16].x + 2 * spriteC.direction,
            spriteC.skeleton.pos[16].y + 3,
          )
          const bp = vector2(spriteC.direction * 0.1, 0)
          createBullet(gs, a, bp, spriteC.weapon.num, num, 255, spriteC.weapon.hitMultiply, true, false)
          // {$IFNDEF SERVER} KNIFE → PlaySound(SFX_SLASH) — TODO(M2/render)
          spriteC.bodyAnimation.currFrame++
        }
      }

      // Buttstock!
      if (!spriteC.deadMeat) {
        if (spriteC.bodyAnimation.id === anims.melee.id && spriteC.bodyAnimation.currFrame === 12) {
          // Control.pas:766-777
          const a = vector2(
            spriteC.skeleton.pos[16].x + 2 * spriteC.direction,
            spriteC.skeleton.pos[16].y + 3,
          )
          const bp = vector2(spriteC.direction * 0.1, 0)
          createBullet(gs, a, bp, guns[NOWEAPON].num, num, 255, guns[NOWEAPON].hitMultiply, true, true)
          // {$IFNDEF SERVER} PlaySound(SFX_SLASH) — TODO(M2/render)
        }
      }

      if (spriteC.bodyAnimation.id === anims.melee.id) {
        if (spriteC.bodyAnimation.currFrame > 20) {
          spriteC.bodyApplyAnimation(anims.stand, 1)
        }
      }

      // Shotgun luska
      if (spriteC.bodyAnimation.id === anims.shotgun.id && spriteC.bodyAnimation.currFrame === 24) {
        // {$IFNDEF SERVER} 붉은 탄피 스파크 CreateSpark 51 (795-802) — TODO(M2/render)
        spriteC.bodyAnimation.currFrame++
      }

      // M79 luska
      if (
        spriteC.weapon.num === guns[M79].num &&
        spriteC.weapon.reloadTimeCount === spriteC.weapon.clipOutTime
      ) {
        // {$IFNDEF SERVER} M79 탄피 스파크 CreateSpark 52 (811-820) — TODO(M2/render)
        if (spriteC.weapon.reloadTimeCount > 0) spriteC.weapon.reloadTimeCount--
      }

      /* ═══════════════ Prone / Get up / Unprone (Control.pas:825-918) ═══════════════ */
      // Prone
      if (spriteC.control.prone) {
        if (
          spriteC.legsAnimation.id !== anims.getUp.id &&
          spriteC.legsAnimation.id !== anims.prone.id &&
          spriteC.legsAnimation.id !== anims.proneMove.id
        ) {
          // {$IFNDEF SERVER} PlaySound(SFX_GOPRONE) — TODO(M2/render)
          spriteC.legsApplyAnimation(anims.prone, 1)
          if (
            spriteC.bodyAnimation.id !== anims.reload.id &&
            spriteC.bodyAnimation.id !== anims.change.id &&
            spriteC.bodyAnimation.id !== anims.throwWeapon.id
          ) {
            spriteC.bodyApplyAnimation(anims.prone, 1)
          }
          spriteC.oldDirection = spriteC.direction
          spriteC.control.prone = false
        }
      }

      // Get up
      if (spriteC.position === POS_PRONE) {
        if (spriteC.control.prone || spriteC.direction !== spriteC.oldDirection) {
          if (
            (spriteC.legsAnimation.id === anims.prone.id && spriteC.legsAnimation.currFrame > 23) ||
            spriteC.legsAnimation.id === anims.proneMove.id
          ) {
            if (spriteC.legsAnimation.id !== anims.getUp.id) {
              // SpriteC.LegsAnimation := GetUp (record 대입 — LegsApplyAnimation의 prone 가드를
              // 의도적으로 우회하는 원본 코드)
              spriteC.legsAnimation = cloneAnimation(anims.getUp)
              spriteC.legsAnimation.currFrame = 9
              spriteC.control.prone = false
              // {$IFNDEF SERVER} PlaySound(SFX_STANDUP) — TODO(M2/render)
            }
            if (
              spriteC.bodyAnimation.id !== anims.reload.id &&
              spriteC.bodyAnimation.id !== anims.change.id &&
              spriteC.bodyAnimation.id !== anims.throwWeapon.id
            ) {
              spriteC.bodyApplyAnimation(anims.getUp, 9)
            }
          }
        }
      }

      let unprone = false
      // Immediately switch from unprone to jump/sidejump, because the end of the unprone
      // animation can be seen as the "wind up" for the jump
      if (
        spriteC.legsAnimation.id === anims.getUp.id &&
        spriteC.legsAnimation.currFrame > 23 - (4 - 1) && // Possible during the last 4 frames
        spriteC.onGround &&
        spriteC.control.up &&
        (spriteC.control.right || spriteC.control.left)
      ) {
        // Set sidejump frame 1 to 4 depending on which unprone frame we're in
        spriteC.legsApplyAnimation(anims.jumpSide, spriteC.legsAnimation.currFrame - (23 - (4 - 1)))
        unprone = true
      } else if (
        spriteC.legsAnimation.id === anims.getUp.id &&
        spriteC.legsAnimation.currFrame > 23 - (4 - 1) && // Possible during the last 4 frames
        spriteC.onGround &&
        spriteC.control.up &&
        !(spriteC.control.right || spriteC.control.left)
      ) {
        // Set jump frame 6 to 9 depending on which unprone frame we're in
        spriteC.legsApplyAnimation(anims.jump, spriteC.legsAnimation.currFrame - (23 - (9 - 1)))
        unprone = true
      } else if (spriteC.legsAnimation.id === anims.getUp.id && spriteC.legsAnimation.currFrame > 23) {
        if (spriteC.control.right || spriteC.control.left) {
          // Run back or forward depending on facing direction and direction key pressed
          if ((spriteC.direction === 1) !== spriteC.control.left) {
            spriteC.legsApplyAnimation(anims.run, 1)
          } else {
            spriteC.legsApplyAnimation(anims.runBack, 1)
          }
        } else if (!spriteC.onGround && spriteC.control.up) {
          spriteC.legsApplyAnimation(anims.run, 1)
        } else {
          spriteC.legsApplyAnimation(anims.stand, 1)
        }
        unprone = true
      }

      if (unprone) {
        spriteC.position = POS_STAND

        if (
          spriteC.bodyAnimation.id !== anims.reload.id &&
          spriteC.bodyAnimation.id !== anims.change.id &&
          spriteC.bodyAnimation.id !== anims.throwWeapon.id
        ) {
          spriteC.bodyApplyAnimation(anims.stand, 1)
        }
      }

      /* ═══════════════ 스탯건 과열/바렛 (Control.pas:920-936) ═══════════════ */
      // Stat overheat less
      if (!spriteC.control.fire) {
        if (spriteC.useTime > M2GUN_OVERHEAT + 1) spriteC.useTime = 0
        if (spriteC.useTime > 0) {
          if (gs.mainTickCounter % 8 === 0) spriteC.useTime--
        }
      }

      // Fondle Barrett?!
      if (spriteC.weapon.num === guns[BARRETT].num && spriteC.weapon.fireIntervalCount > 0) {
        if (
          spriteC.bodyAnimation.id === anims.stand.id ||
          spriteC.bodyAnimation.id === anims.crouch.id ||
          spriteC.bodyAnimation.id === anims.prone.id
        ) {
          spriteC.bodyApplyAnimation(anims.barret, 1)
        }
      }

      /* ═══════════════ IDLE 상태기계 (Control.pas:938-1359) ═══════════════ */
      if (spriteC.stat === 0) {
        if (
          (spriteC.bodyAnimation.id === anims.stand.id &&
            spriteC.legsAnimation.id === anims.stand.id &&
            !spriteC.deadMeat &&
            spriteC.idleTime > 0) ||
          spriteC.idleTime > DEFAULT_IDLETIME
        ) {
          // {$IFNDEF SERVER} if (IdleRandom >= 0) 게이트 — 서버 변형은 무조건 감소 (채택).
          spriteC.idleTime--
        } else {
          spriteC.idleTime = DEFAULT_IDLETIME
        }
        // {$IFDEF SERVER} — 서버가 랜덤 idle 선택 (권위 로컬 심 채택).
        if (spriteC.idleTime === 1 && spriteC.idleRandom < 0) {
          spriteC.idleTime = 0
          spriteC.idleRandom = random(4)
        }
      }

      if (spriteC.idleRandom === 0) {
        // STUFF
        if (spriteC.idleTime === 0) {
          spriteC.bodyApplyAnimation(anims.smoke, 1)
          // {$IFDEF SERVER} ServerIdleAnimation(Num, IdleRandom) — TODO(M3): 네트워크 브로드캐스트
          spriteC.idleTime = DEFAULT_IDLETIME
        }

        if (spriteC.bodyAnimation.id === anims.smoke.id && spriteC.bodyAnimation.currFrame === 17) {
          // {$IFNDEF SERVER} PlaySound(SFX_STUFF) — TODO(M2/render)
          spriteC.bodyAnimation.currFrame++
        }

        if (!spriteC.deadMeat) {
          if (
            spriteC.idleTime === 1 &&
            spriteC.bodyAnimation.id !== anims.smoke.id &&
            spriteC.legsAnimation.id === anims.stand.id
          ) {
            // {$IFNDEF SERVER} 침뱉기 스파크 CreateSpark 32 + PlaySound(SFX_SPIT) (991-997)
            //   — TODO(M2/render)
            spriteC.idleTime = DEFAULT_IDLETIME
            spriteC.idleRandom = -1
          }
        }
      } else if (spriteC.idleRandom === 1) {
        // CIGAR
        if (!spriteC.deadMeat) {
          if (spriteC.idleTime === 0) {
            if (spriteC.hasCigar === 0) {
              if (spriteC.bodyAnimation.id === anims.stand.id) {
                // Step 1/8
                spriteC.bodyApplyAnimation(anims.cigar, 1)
                // {$IFDEF SERVER} ServerIdleAnimation — TODO(M3)
                spriteC.idleTime = DEFAULT_IDLETIME
              }
            } else if (spriteC.hasCigar === 5) {
              if (
                spriteC.bodyAnimation.id !== anims.smoke.id &&
                spriteC.bodyAnimation.id !== anims.cigar.id
              ) {
                // Step 4.5/8 (only occurrs if interrupted between step 2 and 5, so redo step 1)
                spriteC.hasCigar = 0
                spriteC.bodyApplyAnimation(anims.cigar, 1)
                spriteC.idleTime = DEFAULT_IDLETIME
              }
            } else if (spriteC.hasCigar === 10) {
              if (spriteC.bodyAnimation.id !== anims.smoke.id) {
                // Step 6/8
                spriteC.bodyApplyAnimation(anims.smoke, 1)
                spriteC.idleTime = DEFAULT_IDLETIME
              }
            }
          }

          if (spriteC.bodyAnimation.id === anims.cigar.id && spriteC.bodyAnimation.currFrame === 37) {
            if (spriteC.hasCigar === 5) {
              // Step 3/8
              spriteC.bodyApplyAnimation(anims.stand, 1)
              spriteC.bodyApplyAnimation(anims.cigar, 1)
            }
          }

          if (spriteC.bodyAnimation.id === anims.cigar.id && spriteC.bodyAnimation.currFrame === 9) {
            if (spriteC.hasCigar === 5) {
              // Step 4/8
              // {$IFNDEF SERVER} PlaySound(SFX_MATCH) — TODO(M2/render)
              spriteC.bodyAnimation.currFrame++
            }
          }

          if (spriteC.bodyAnimation.id === anims.cigar.id && spriteC.bodyAnimation.currFrame === 26) {
            if (spriteC.hasCigar === 5) {
              // Step 5/8
              spriteC.hasCigar = 10
              // {$IFNDEF SERVER} 담배연기/성냥 스파크 + SFX_SMOKE (1070-1082) — TODO(M2/render)
              spriteC.bodyAnimation.currFrame++
              spriteC.idleTime = LONGER_IDLETIME
            } else if (spriteC.hasCigar === 0) {
              // Step 2/8
              spriteC.hasCigar = 5
              spriteC.bodyAnimation.currFrame++
            }
          }

          if (
            spriteC.bodyAnimation.id === anims.smoke.id &&
            (spriteC.bodyAnimation.currFrame === 17 || spriteC.bodyAnimation.currFrame === 37)
          ) {
            // Step 7/8
            // {$IFNDEF SERVER} 연기 스파크 CreateSpark 31 + SFX_SMOKE (1099-1106) — TODO(M2/render)
            spriteC.bodyAnimation.currFrame++
          }

          if (spriteC.bodyAnimation.id === anims.smoke.id && spriteC.bodyAnimation.currFrame === 38) {
            // Step 8/8
            spriteC.hasCigar = 0
            // {$IFNDEF SERVER} 꽁초 스파크 CreateSpark 34 (1116-1119) — TODO(M2/render)
            spriteC.bodyAnimation.currFrame++
            spriteC.idleTime = DEFAULT_IDLETIME
            spriteC.idleRandom = -1
          }
        }
      } else if (spriteC.idleRandom === 2) {
        // WIPE
        if (spriteC.idleTime === 0) {
          spriteC.bodyApplyAnimation(anims.wipe, 1)
          // {$IFDEF SERVER} ServerIdleAnimation — TODO(M3)
          spriteC.idleTime = DEFAULT_IDLETIME
          spriteC.idleRandom = -1
        }
      } else if (spriteC.idleRandom === 3) {
        // EGGS
        if (spriteC.idleTime === 0) {
          spriteC.bodyApplyAnimation(anims.groin, 1)
          // {$IFDEF SERVER} ServerIdleAnimation — TODO(M3)
          spriteC.idleTime = DEFAULT_IDLETIME
          spriteC.idleRandom = -1
        }
      } else if (spriteC.idleRandom === 4) {
        // TAKE OFF HELMET
        if (spriteC.weapon.num !== guns[BOW].num && spriteC.weapon.num !== guns[BOW2].num) {
          if (spriteC.idleTime === 0) {
            if (spriteC.wearHelmet === 1) spriteC.bodyApplyAnimation(anims.takeOff, 1)
            if (spriteC.wearHelmet === 2) spriteC.bodyApplyAnimation(anims.takeOff, 10)
            // {$IFDEF SERVER} ServerIdleAnimation — TODO(M3)
            spriteC.idleTime = DEFAULT_IDLETIME
          }

          if (spriteC.wearHelmet === 1) {
            if (
              spriteC.bodyAnimation.id === anims.takeOff.id &&
              spriteC.bodyAnimation.currFrame === 15
            ) {
              spriteC.wearHelmet = 2
              spriteC.bodyAnimation.currFrame++
            }
          } else if (spriteC.wearHelmet === 2) {
            if (
              spriteC.bodyAnimation.id === anims.takeOff.id &&
              spriteC.bodyAnimation.currFrame === 22
            ) {
              spriteC.bodyApplyAnimation(anims.stand, 1)
              spriteC.idleRandom = -1
            }

            if (
              spriteC.bodyAnimation.id === anims.takeOff.id &&
              spriteC.bodyAnimation.currFrame === 15
            ) {
              spriteC.wearHelmet = 1
              spriteC.bodyAnimation.currFrame++
            }
          }
        }
      } else if (spriteC.idleRandom === 5) {
        // VICTORY
        if (spriteC.idleTime === 0) {
          spriteC.bodyApplyAnimation(anims.victory, 1)
          // {$IFDEF SERVER} ServerIdleAnimation — TODO(M3)
          spriteC.idleTime = DEFAULT_IDLETIME
          spriteC.idleRandom = -1
          // {$IFNDEF SERVER} PlaySound(SFX_ROAR) — TODO(M2/render)
        }
      } else if (spriteC.idleRandom === 6) {
        // PISS...
        if (spriteC.idleTime === 0) {
          spriteC.bodyApplyAnimation(anims.piss, 1)
          // {$IFDEF SERVER} ServerIdleAnimation — TODO(M3)
          spriteC.idleTime = DEFAULT_IDLETIME
          // {$IFNDEF SERVER} PlaySound(SFX_PISS) — TODO(M2/render)
        }

        if (spriteC.bodyAnimation.id === anims.piss.id) {
          if (spriteC.bodyAnimation.currFrame > 8 && spriteC.bodyAnimation.currFrame < 22) {
            // Random 호출은 서버에서도 수행 — RNG 스트림 동등성 유지를 위해 보존.
            if (random(2) === 0) {
              // {$IFNDEF SERVER} 오줌 스파크 CreateSpark 57 (1233-1241) — TODO(M2/render)
            }
          } else if (spriteC.bodyAnimation.currFrame > 21 && spriteC.bodyAnimation.currFrame < 34) {
            if (random(3) === 0) {
              // {$IFNDEF SERVER} 오줌 스파크 (1249-1257) — TODO(M2/render)
            }
          } else if (spriteC.bodyAnimation.currFrame > 33 && spriteC.bodyAnimation.currFrame < 35) {
            if (random(4) === 0) {
              // {$IFNDEF SERVER} 오줌 스파크 (1265-1274) — TODO(M2/render)
            }
          } else if (spriteC.bodyAnimation.currFrame === 37) {
            spriteC.idleRandom = -1
          }
        }
      } else if (spriteC.idleRandom === 7) {
        // SELFKILL
        if (spriteC.idleTime === 0) {
          if (spriteC.canMercy) {
            // Mercy2: M79/M249/SPAS12/LAW/CHAINSAW/BARRETT/MINIGUN (Control.pas:1289-1295)
            if (
              spriteC.weapon.num === guns[M79].num ||
              spriteC.weapon.num === guns[M249].num ||
              spriteC.weapon.num === guns[SPAS12].num ||
              spriteC.weapon.num === guns[LAW].num ||
              spriteC.weapon.num === guns[CHAINSAW].num ||
              spriteC.weapon.num === guns[BARRETT].num ||
              spriteC.weapon.num === guns[MINIGUN].num
            ) {
              spriteC.bodyApplyAnimation(anims.mercy2, 1)
              spriteC.legsApplyAnimation(anims.mercy2, 1)
            } else if (spriteC.weapon.num !== guns[MINIGUN].num) {
              spriteC.bodyApplyAnimation(anims.mercy, 1)
              spriteC.legsApplyAnimation(anims.mercy, 1)
            }

            // {$IFNDEF SERVER} PlaySound(SFX_MERCY / SFX_MINIGUN_START) — TODO(M2/render)
            // {$ELSE} ServerIdleAnimation — TODO(M3)
            spriteC.idleTime = DEFAULT_IDLETIME

            spriteC.canMercy = false
          } else {
            spriteC.idleRandom = -1
            spriteC.canMercy = true
          }
        }

        if (
          spriteC.bodyAnimation.id === anims.mercy.id ||
          spriteC.bodyAnimation.id === anims.mercy2.id
        ) {
          if (spriteC.bodyAnimation.currFrame === 20) {
            spriteC.fire()
            // {$IFNDEF SERVER} 무기별 사운드 + ClientSendStringMessage('kill') (1330-1340)
            //   — 클라 전용, 미채택 (자살 판정은 M2 Fire/Die에서)
            spriteC.bodyAnimation.currFrame++
            spriteC.idleRandom = -1
          }
        }
      } else if (spriteC.idleRandom === 8) {
        // PWN!
        if (spriteC.idleTime === 0) {
          spriteC.bodyApplyAnimation(anims.own, 1)
          spriteC.legsApplyAnimation(anims.own, 1)
          // {$IFDEF SERVER} ServerIdleAnimation — TODO(M3)
          spriteC.idleTime = DEFAULT_IDLETIME
          spriteC.idleRandom = -1
        }
      }

      /* ═══════════════ *CHEAT* 속도핵 방지 (Control.pas:1362-1388) ═══════════════ */
      if (spriteC.legsAnimation.speed > 1) {
        if (
          spriteC.legsAnimation.id === anims.jump.id ||
          spriteC.legsAnimation.id === anims.jumpSide.id ||
          spriteC.legsAnimation.id === anims.roll.id ||
          spriteC.legsAnimation.id === anims.rollBack.id ||
          spriteC.legsAnimation.id === anims.prone.id ||
          spriteC.legsAnimation.id === anims.run.id ||
          spriteC.legsAnimation.id === anims.runBack.id
        ) {
          gs.spriteParts.velocity[num].x = gs.spriteParts.velocity[num].x / spriteC.legsAnimation.speed
          gs.spriteParts.velocity[num].y = gs.spriteParts.velocity[num].y / spriteC.legsAnimation.speed
        }

        if (spriteC.legsAnimation.speed > 2) {
          if (
            spriteC.legsAnimation.id === anims.proneMove.id ||
            spriteC.legsAnimation.id === anims.crouchRun.id
          ) {
            gs.spriteParts.velocity[num].x =
              gs.spriteParts.velocity[num].x / spriteC.legsAnimation.speed
            gs.spriteParts.velocity[num].y =
              gs.spriteParts.velocity[num].y / spriteC.legsAnimation.speed
          }
        }
      }

      // stat gun deactivate if needed (Control.pas:1390-1396)
      if (spriteC.control.up || spriteC.control.jetpack) {
        if (spriteC.stat > 0) {
          gs.thing[spriteC.stat].staticType = false // Control.pas:1393
          spriteC.stat = 0
        }
      }

      /* ═══════════════ AimDistCoef — 바렛 스코프 (Control.pas:1398-1484) ═══════════════ */
      if (spriteC.weapon.num === guns[BARRETT].num) {
        if (
          spriteC.weapon.fireIntervalCount === 0 &&
          (spriteC.bodyAnimation.id === anims.prone.id || spriteC.bodyAnimation.id === anims.aim.id)
        ) {
          if (
            Math.abs(spriteC.control.mouseAimX - gs.spriteParts.pos[num].x) >= 640 / 1.035 ||
            Math.abs(spriteC.control.mouseAimY - gs.spriteParts.pos[num].y) >= 480 / 1.035
          ) {
            if (spriteC.aimDistCoef === DEFAULTAIMDIST) {
              // {$IFNDEF SERVER} PlaySound(SFX_SCOPE) {$ELSE} ServerSpriteDeltasMouse — TODO(M3)
            }

            if (spriteC.bodyAnimation.id === anims.prone.id) {
              if (spriteC.aimDistCoef > SNIPERAIMDIST) {
                spriteC.aimDistCoef = spriteC.aimDistCoef - AIMDISTINCR
                if (gs.mainTickCounter % 27 === 0) {
                  // {$IFNDEF SERVER} PlaySound(SFX_SCOPERUN) {$ELSE} ServerSpriteDeltasMouse
                  //   — TODO(M3)
                }
              }
            }

            if (spriteC.bodyAnimation.id === anims.aim.id) {
              if (spriteC.aimDistCoef > CROUCHAIMDIST) {
                spriteC.aimDistCoef = spriteC.aimDistCoef - 2 * AIMDISTINCR
                if (gs.mainTickCounter % 27 === 0) {
                  // {$IFNDEF SERVER} PlaySound(SFX_SCOPERUN) {$ELSE} ServerSpriteDeltasMouse
                  //   — TODO(M3)
                }
              }
            }
          }

          if (
            Math.abs(spriteC.control.mouseAimX - gs.spriteParts.pos[num].x) < 640 / 1.5 &&
            Math.abs(spriteC.control.mouseAimY - gs.spriteParts.pos[num].y) < 480 / 1.5
          ) {
            if (spriteC.aimDistCoef < DEFAULTAIMDIST) {
              spriteC.aimDistCoef = spriteC.aimDistCoef + AIMDISTINCR
              // {$IFNDEF SERVER} if AimDistCoef = DEFAULTAIMDIST then PlaySound(SFX_SCOPE)
              //   — TODO(M2/render)
              if (gs.mainTickCounter % 27 === 0) {
                // {$IFNDEF SERVER} PlaySound(SFX_SCOPERUN) {$ELSE} ServerSpriteDeltasMouse
                //   — TODO(M3)
              }
            }
          }
        } else {
          if (spriteC.aimDistCoef !== DEFAULTAIMDIST) {
            // {$IFNDEF SERVER} PlaySound(SFX_SCOPEBACK) {$ELSE} ServerSpriteDeltasMouse — TODO(M3)
          }
          spriteC.aimDistCoef = DEFAULTAIMDIST
          spriteC.control.mouseDist = 150
        }
      } else {
        spriteC.aimDistCoef = DEFAULTAIMDIST
        spriteC.control.mouseDist = 150
      }

      /* ═══════════════ 콜라이더 근접 검사 (Control.pas:1486-1557) ═══════════════ */
      // Check if near collider
      if (gs.mainTickCounter % 10 === 0) {
        spriteC.colliderDistance = 255 // not near

        // Pascal은 고정 배열 1..128 순회(미사용 슬롯 Active=False) — 이 포트의 collider 배열은
        // 실제 개수+1이라 length 가드 추가 (관찰 동등, sprites.ts randomizeStart와 동일 규약).
        for (let j = 1; j <= 128 && j < gs.map.collider.length; j++) {
          if (gs.map.collider[j].active) {
            const a = vector2(gs.map.collider[j].x, gs.map.collider[j].y)

            b = vec2Subtract(spriteC.skeleton.pos[15], spriteC.skeleton.pos[16])
            b = vec2Normalize(b)
            b = vec2Scale(b, 8)
            const startPoint = vector2(spriteC.skeleton.pos[12].x, spriteC.skeleton.pos[12].y - 5)
            const lookPoint = vec2Add(startPoint, b)

            b = vec2Subtract(lookPoint, a)
            let d = vec2Length(b)

            if (d < gs.map.collider[j].radius) {
              spriteC.colliderDistance = 1

              if (spriteC.colliderDistance === 1) {
                if (d > 253) d = 253
                spriteC.colliderDistance = pascalRound(d)
              }
              break
            }
          }
        }

        // raise weapon above teammate when crouching
        for (let j = 1; j <= MAX_SPRITES; j++) {
          if (isTeamGame(gs)) {
            if (
              gs.sprite[j].active &&
              gs.sprite[j].isInSameTeam(spriteC) &&
              gs.sprite[j].position === POS_CROUCH &&
              j !== spriteC.num &&
              spriteC.isNotSpectator()
            ) {
              const a = cloneVec2(gs.spriteParts.pos[j])

              b = vec2Subtract(spriteC.skeleton.pos[15], spriteC.skeleton.pos[16])
              b = vec2Normalize(b)
              b = vec2Scale(b, 8)
              const startPoint = vector2(spriteC.skeleton.pos[12].x, spriteC.skeleton.pos[12].y - 5)
              const lookPoint = vec2Add(startPoint, b)

              b = vec2Subtract(lookPoint, a)
              let d = vec2Length(b)

              if (d < SPRITE_RADIUS) {
                spriteC.colliderDistance = 1

                if (spriteC.colliderDistance === 1) {
                  if (d > 253) d = 253
                  spriteC.colliderDistance = pascalRound(d)
                }
                break
              }
            }
          }
        }
      }

      // {$IFNDEF SERVER} TargetMode and (Num = MySprite) → FreeControls (1558-1563)
      //   — 클라 관전 타깃 모드, 미채택.

      // End any ongoing idle animations if a key is pressed (Control.pas:1564-1580)
      if (
        spriteC.bodyAnimation.id === anims.cigar.id ||
        spriteC.bodyAnimation.id === anims.match.id ||
        spriteC.bodyAnimation.id === anims.smoke.id ||
        spriteC.bodyAnimation.id === anims.wipe.id ||
        spriteC.bodyAnimation.id === anims.groin.id
      ) {
        if (
          spriteC.control.left ||
          spriteC.control.right ||
          spriteC.control.up ||
          spriteC.control.down ||
          spriteC.control.fire ||
          spriteC.control.jetpack ||
          spriteC.control.throwNade ||
          spriteC.control.changeWeapon ||
          spriteC.control.throwWeapon ||
          spriteC.control.reload ||
          spriteC.control.prone
        ) {
          spriteC.bodyAnimation.currFrame = spriteC.bodyAnimation.numFrames
        }
      }

      /* ═══════════ make anims out of controls — 이동 캐스케이드 (Control.pas:1582-1984) ═══════════ */
      // rolling
      if (
        spriteC.bodyAnimation.id !== anims.takeOff.id &&
        spriteC.bodyAnimation.id !== anims.piss.id &&
        spriteC.bodyAnimation.id !== anims.mercy.id &&
        spriteC.bodyAnimation.id !== anims.mercy2.id &&
        spriteC.bodyAnimation.id !== anims.victory.id &&
        spriteC.bodyAnimation.id !== anims.own.id
      ) {
        if (
          spriteC.bodyAnimation.id === anims.roll.id ||
          spriteC.bodyAnimation.id === anims.rollBack.id
        ) {
          if (spriteC.legsAnimation.id === anims.roll.id) {
            if (spriteC.onGround) {
              // if staying on ground
              gs.spriteParts.forces[num].x = spriteC.direction * ROLLSPEED
            } else {
              gs.spriteParts.forces[num].x = spriteC.direction * 2 * FLYSPEED
            }
          } else if (spriteC.legsAnimation.id === anims.rollBack.id) {
            if (spriteC.onGround) {
              // if staying on ground
              gs.spriteParts.forces[num].x = -spriteC.direction * ROLLSPEED
            } else {
              gs.spriteParts.forces[num].x = -spriteC.direction * 2 * FLYSPEED
            }

            // if appropriate frames to move
            if (spriteC.legsAnimation.currFrame > 1 && spriteC.legsAnimation.currFrame < 8) {
              if (spriteC.control.up) {
                gs.spriteParts.forces[num].y = gs.spriteParts.forces[num].y - JUMPDIRSPEED * 1.5
                gs.spriteParts.forces[num].x = gs.spriteParts.forces[num].x * 0.5
                gs.spriteParts.velocity[num].x = gs.spriteParts.velocity[num].x * 0.8
              }
            }
          }
        }
        // downright
        else if (spriteC.control.right && spriteC.control.down) {
          if (spriteC.onGround) {
            // if staying on ground
            // roll to the side
            if (
              spriteC.legsAnimation.id === anims.run.id ||
              spriteC.legsAnimation.id === anims.runBack.id ||
              spriteC.legsAnimation.id === anims.fall.id ||
              spriteC.legsAnimation.id === anims.proneMove.id ||
              (spriteC.legsAnimation.id === anims.prone.id && spriteC.legsAnimation.currFrame >= 24)
            ) {
              if (
                spriteC.legsAnimation.id === anims.proneMove.id ||
                (spriteC.legsAnimation.id === anims.prone.id &&
                  spriteC.legsAnimation.currFrame === spriteC.legsAnimation.numFrames)
              ) {
                spriteC.control.prone = false
                spriteC.position = POS_STAND
              }
              // {$IFNDEF SERVER} PlaySound(SFX_ROLL) + SetSoundPaused (1641-1647) — TODO(M2/render)

              if (spriteC.direction === 1) {
                spriteC.bodyApplyAnimation(anims.roll, 1)
                // SpriteC.LegsAnimation := Roll; CurrFrame := 1 (record 대입 — prone 가드 우회)
                spriteC.legsAnimation = cloneAnimation(anims.roll)
                spriteC.legsAnimation.currFrame = 1
              } else {
                spriteC.bodyApplyAnimation(anims.rollBack, 1)
                spriteC.legsAnimation = cloneAnimation(anims.rollBack)
                spriteC.legsAnimation.currFrame = 1
              }
            } else {
              if (spriteC.direction === 1) {
                spriteC.legsApplyAnimation(anims.crouchRun, 1)
              } else {
                spriteC.legsApplyAnimation(anims.crouchRunBack, 1)
              }
            }

            if (
              spriteC.legsAnimation.id === anims.crouchRun.id ||
              spriteC.legsAnimation.id === anims.crouchRunBack.id
            ) {
              gs.spriteParts.forces[num].x = CROUCHRUNSPEED
            } else if (
              spriteC.legsAnimation.id === anims.roll.id ||
              spriteC.legsAnimation.id === anims.rollBack.id
            ) {
              gs.spriteParts.forces[num].x = 2 * CROUCHRUNSPEED
            }
          }
        }
        // downleft
        else if (spriteC.control.left && spriteC.control.down) {
          if (spriteC.onGround) {
            // if staying on ground
            // roll to the side
            if (
              spriteC.legsAnimation.id === anims.run.id ||
              spriteC.legsAnimation.id === anims.runBack.id ||
              spriteC.legsAnimation.id === anims.fall.id ||
              spriteC.legsAnimation.id === anims.proneMove.id ||
              (spriteC.legsAnimation.id === anims.prone.id && spriteC.legsAnimation.currFrame >= 24)
            ) {
              if (
                spriteC.legsAnimation.id === anims.proneMove.id ||
                (spriteC.legsAnimation.id === anims.prone.id &&
                  spriteC.legsAnimation.currFrame === spriteC.legsAnimation.numFrames)
              ) {
                spriteC.control.prone = false
                spriteC.position = POS_STAND
              }
              // {$IFNDEF SERVER} PlaySound(SFX_ROLL) + SetSoundPaused (1698-1704) — TODO(M2/render)

              if (spriteC.direction === 1) {
                spriteC.bodyApplyAnimation(anims.rollBack, 1)
                spriteC.legsAnimation = cloneAnimation(anims.rollBack)
                spriteC.legsAnimation.currFrame = 1
              } else {
                spriteC.bodyApplyAnimation(anims.roll, 1)
                spriteC.legsAnimation = cloneAnimation(anims.roll)
                spriteC.legsAnimation.currFrame = 1
              }
            } else {
              if (spriteC.direction === 1) {
                spriteC.legsApplyAnimation(anims.crouchRunBack, 1)
              } else {
                spriteC.legsApplyAnimation(anims.crouchRun, 1)
              }
            }

            if (
              spriteC.legsAnimation.id === anims.crouchRun.id ||
              spriteC.legsAnimation.id === anims.crouchRunBack.id
            ) {
              gs.spriteParts.forces[num].x = -CROUCHRUNSPEED
            }
          }
        }
        // Proning
        // FIXME(skoskav): The "and Body <> Throw|Punch" check is to keep the grenade tap and
        // punch/stab prone cancel bugs
        else if (
          spriteC.legsAnimation.id === anims.prone.id ||
          spriteC.legsAnimation.id === anims.proneMove.id ||
          (spriteC.legsAnimation.id === anims.getUp.id &&
            spriteC.bodyAnimation.id !== anims.throw.id &&
            spriteC.bodyAnimation.id !== anims.punch.id)
        ) {
          if (spriteC.onGround) {
            if (
              (spriteC.legsAnimation.id === anims.prone.id &&
                spriteC.legsAnimation.currFrame > 25) ||
              spriteC.legsAnimation.id === anims.proneMove.id
            ) {
              if (spriteC.control.left || spriteC.control.right) {
                if (spriteC.legsAnimation.currFrame < 4 || spriteC.legsAnimation.currFrame > 14) {
                  gs.spriteParts.forces[num].x = spriteC.control.left ? -PRONESPEED : PRONESPEED
                }

                spriteC.legsApplyAnimation(anims.proneMove, 1)
                if (
                  spriteC.bodyAnimation.id !== anims.clipIn.id &&
                  spriteC.bodyAnimation.id !== anims.clipOut.id &&
                  spriteC.bodyAnimation.id !== anims.slideBack.id &&
                  spriteC.bodyAnimation.id !== anims.reload.id &&
                  spriteC.bodyAnimation.id !== anims.change.id &&
                  spriteC.bodyAnimation.id !== anims.throw.id &&
                  spriteC.bodyAnimation.id !== anims.throwWeapon.id
                ) {
                  spriteC.bodyApplyAnimation(anims.proneMove, 1)
                }

                if (spriteC.legsAnimation.id !== anims.proneMove.id) {
                  // SpriteC.LegsAnimation := ProneMove (record 대입 — prone 가드 우회)
                  spriteC.legsAnimation = cloneAnimation(anims.proneMove)
                }
              } else {
                if (spriteC.legsAnimation.id !== anims.prone.id) {
                  // SpriteC.LegsAnimation := Prone (record 대입)
                  spriteC.legsAnimation = cloneAnimation(anims.prone)
                }
                spriteC.legsAnimation.currFrame = 26
              }
            }
          }
        }
        // upright
        else if (spriteC.control.right && spriteC.control.up) {
          if (spriteC.onGround) {
            // if staying on ground
            // jump to the side
            if (
              spriteC.legsAnimation.id === anims.run.id ||
              spriteC.legsAnimation.id === anims.runBack.id ||
              spriteC.legsAnimation.id === anims.stand.id ||
              spriteC.legsAnimation.id === anims.crouch.id ||
              spriteC.legsAnimation.id === anims.crouchRun.id ||
              spriteC.legsAnimation.id === anims.crouchRunBack.id
            ) {
              spriteC.legsApplyAnimation(anims.jumpSide, 1)
              // {$IFNDEF SERVER} PlaySound(SFX_JUMP) — TODO(M2/render)
            }

            if (spriteC.legsAnimation.currFrame === spriteC.legsAnimation.numFrames) {
              spriteC.legsApplyAnimation(anims.run, 1)
            }
          } else if (
            spriteC.legsAnimation.id === anims.roll.id ||
            spriteC.legsAnimation.id === anims.rollBack.id
          ) {
            if (spriteC.direction === 1) {
              spriteC.legsApplyAnimation(anims.run, 1)
            } else {
              spriteC.legsApplyAnimation(anims.runBack, 1)
            }
          }

          if (spriteC.legsAnimation.id === anims.jump.id) {
            if (spriteC.legsAnimation.currFrame < 10) {
              spriteC.legsApplyAnimation(anims.jumpSide, 1)
            }
          }

          if (spriteC.legsAnimation.id === anims.jumpSide.id) {
            // if appropriate frames to move
            if (spriteC.legsAnimation.currFrame > 3 && spriteC.legsAnimation.currFrame < 11) {
              gs.spriteParts.forces[num].x = JUMPDIRSPEED
              gs.spriteParts.forces[num].y = -JUMPDIRSPEED / 1.2
            }
          }
        }
        // upleft
        else if (spriteC.control.left && spriteC.control.up) {
          if (spriteC.onGround) {
            // if staying on ground
            // jump to the side
            if (
              spriteC.legsAnimation.id === anims.run.id ||
              spriteC.legsAnimation.id === anims.runBack.id ||
              spriteC.legsAnimation.id === anims.stand.id ||
              spriteC.legsAnimation.id === anims.crouch.id ||
              spriteC.legsAnimation.id === anims.crouchRun.id ||
              spriteC.legsAnimation.id === anims.crouchRunBack.id
            ) {
              spriteC.legsApplyAnimation(anims.jumpSide, 1)
              // {$IFNDEF SERVER} PlaySound(SFX_JUMP) — TODO(M2/render)
            }

            if (spriteC.legsAnimation.currFrame === spriteC.legsAnimation.numFrames) {
              spriteC.legsApplyAnimation(anims.run, 1)
            }
          } else if (
            spriteC.legsAnimation.id === anims.roll.id ||
            spriteC.legsAnimation.id === anims.rollBack.id
          ) {
            if (spriteC.direction === -1) {
              spriteC.legsApplyAnimation(anims.run, 1)
            } else {
              spriteC.legsApplyAnimation(anims.runBack, 1)
            }
          }

          if (spriteC.legsAnimation.id === anims.jump.id) {
            if (spriteC.legsAnimation.currFrame < 10) {
              spriteC.legsApplyAnimation(anims.jumpSide, 1)
            }
          }

          if (spriteC.legsAnimation.id === anims.jumpSide.id) {
            // if appropriate frames to move
            if (spriteC.legsAnimation.currFrame > 3 && spriteC.legsAnimation.currFrame < 11) {
              gs.spriteParts.forces[num].x = -JUMPDIRSPEED
              gs.spriteParts.forces[num].y = -JUMPDIRSPEED / 1.2
            }
          }
        }
        // up
        else if (spriteC.control.up) {
          if (spriteC.onGround) {
            // if staying on ground
            if (spriteC.legsAnimation.id !== anims.jump.id) {
              spriteC.legsApplyAnimation(anims.jump, 1)
              // {$IFNDEF SERVER} PlaySound(SFX_JUMP) — TODO(M2/render)
            }

            if (spriteC.legsAnimation.currFrame === spriteC.legsAnimation.numFrames) {
              spriteC.legsApplyAnimation(anims.stand, 1)
            }
          }

          if (spriteC.legsAnimation.id === anims.jump.id) {
            // if appropriate frames to move
            if (spriteC.legsAnimation.currFrame > 8 && spriteC.legsAnimation.currFrame < 15) {
              gs.spriteParts.forces[num].y = -JUMPSPEED
            }

            if (spriteC.legsAnimation.currFrame === spriteC.legsAnimation.numFrames) {
              spriteC.legsApplyAnimation(anims.fall, 1)
            }
          }
        }
        // down
        else if (spriteC.control.down) {
          if (spriteC.onGround) {
            // if staying on ground
            // {$IFNDEF SERVER} 첫 진입 시 PlaySound(SFX_CROUCH) (1905-1910) — TODO(M2/render)
            spriteC.legsApplyAnimation(anims.crouch, 1)
          }
        }
        // right
        else if (spriteC.control.right) {
          if (spriteC.para === 0) {
            if (spriteC.direction === 1) {
              spriteC.legsApplyAnimation(anims.run, 1)
            } else {
              spriteC.legsApplyAnimation(anims.runBack, 1)
            }
          } else if (spriteC.holdedThing !== 0) {
            // parachute bend (Control.pas:1927-1931)
            gs.thing[spriteC.holdedThing].skeleton.forces[3].y -= 0.5
            gs.thing[spriteC.holdedThing].skeleton.forces[2].y += 0.5
          }

          if (spriteC.onGround) {
            // if staying on ground
            gs.spriteParts.forces[num].x = RUNSPEED
            gs.spriteParts.forces[num].y = -RUNSPEEDUP
          } else {
            gs.spriteParts.forces[num].x = FLYSPEED
          }
        }
        // left
        else if (spriteC.control.left) {
          if (spriteC.para === 0) {
            if (spriteC.direction === -1) {
              spriteC.legsApplyAnimation(anims.run, 1)
            } else {
              spriteC.legsApplyAnimation(anims.runBack, 1)
            }
          } else if (spriteC.holdedThing !== 0) {
            // parachute bend (Control.pas:1954-1958)
            gs.thing[spriteC.holdedThing].skeleton.forces[2].y -= 0.5
            gs.thing[spriteC.holdedThing].skeleton.forces[3].y += 0.5
          }

          if (spriteC.onGround) {
            // if staying on ground
            gs.spriteParts.forces[num].x = -RUNSPEED
            gs.spriteParts.forces[num].y = -RUNSPEEDUP
          } else {
            gs.spriteParts.forces[num].x = -FLYSPEED
          }
        }
        // else all keys not pressed
        else {
          if (spriteC.onGround) {
            // if staying on ground
            // {$IFNDEF SERVER} 정지 시 PlaySound(SFX_STOP) (1974-1978) — TODO(M2/render)
            spriteC.legsApplyAnimation(anims.stand, 1)
          } else {
            spriteC.legsApplyAnimation(anims.fall, 1)
          }
        }
      }

      /* ═══════════════ Body animations (Control.pas:1986-2138) ═══════════════ */
      // reloading
      if (
        spriteC.weapon.reloadTimeCount === spriteC.weapon.clipOutTime &&
        spriteC.bodyAnimation.id !== anims.reload.id &&
        spriteC.bodyAnimation.id !== anims.reloadBow.id &&
        spriteC.bodyAnimation.id !== anims.roll.id &&
        spriteC.bodyAnimation.id !== anims.rollBack.id
      ) {
        spriteC.bodyApplyAnimation(anims.clipIn, 1)
      }
      if (spriteC.weapon.reloadTimeCount === spriteC.weapon.clipInTime) {
        spriteC.bodyApplyAnimation(anims.slideBack, 1)
      }

      // this piece of code fixes the infamous crouch bug
      // how you ask? well once upon time soldat's code decided that
      // randomly the animation for roll for the body and legs will magically
      // go out of sync, which is causing the crouch bug. so this piece of
      // awesome code simply syncs them when they go out of sync <3
      if (spriteC.legsAnimation.id === anims.roll.id && spriteC.bodyAnimation.id !== anims.roll.id) {
        spriteC.bodyApplyAnimation(anims.roll, 1)
      }
      if (spriteC.bodyAnimation.id === anims.roll.id && spriteC.legsAnimation.id !== anims.roll.id) {
        spriteC.legsApplyAnimation(anims.roll, 1)
      }
      if (
        spriteC.legsAnimation.id === anims.rollBack.id &&
        spriteC.bodyAnimation.id !== anims.rollBack.id
      ) {
        spriteC.bodyApplyAnimation(anims.rollBack, 1)
      }
      if (
        spriteC.bodyAnimation.id === anims.rollBack.id &&
        spriteC.legsAnimation.id !== anims.rollBack.id
      ) {
        spriteC.legsApplyAnimation(anims.rollBack, 1)
      }

      if (spriteC.bodyAnimation.id === anims.roll.id || spriteC.bodyAnimation.id === anims.rollBack.id) {
        if (spriteC.legsAnimation.currFrame !== spriteC.bodyAnimation.currFrame) {
          if (spriteC.legsAnimation.currFrame > spriteC.bodyAnimation.currFrame) {
            spriteC.bodyAnimation.currFrame = spriteC.legsAnimation.currFrame
          } else {
            spriteC.legsAnimation.currFrame = spriteC.bodyAnimation.currFrame
          }
        }
      }

      // Gracefully end a roll animation (Control.pas:2028-2075)
      if (
        (spriteC.bodyAnimation.id === anims.roll.id ||
          spriteC.bodyAnimation.id === anims.rollBack.id) &&
        spriteC.bodyAnimation.currFrame === spriteC.bodyAnimation.numFrames
      ) {
        // Was probably a roll
        if (spriteC.onGround) {
          if (spriteC.control.down) {
            if (spriteC.control.left || spriteC.control.right) {
              if (spriteC.bodyAnimation.id === anims.roll.id) {
                spriteC.legsApplyAnimation(anims.crouchRun, 1)
              } else {
                spriteC.legsApplyAnimation(anims.crouchRunBack, 1)
              }
            } else {
              spriteC.legsApplyAnimation(anims.crouch, 15)
            }
          }
        }
        // Was probably a backflip
        else if (spriteC.bodyAnimation.id === anims.rollBack.id && spriteC.control.up) {
          if (spriteC.control.left || spriteC.control.right) {
            // Run back or forward depending on facing direction and direction key pressed
            if ((spriteC.direction === 1) !== spriteC.control.left) {
              spriteC.legsApplyAnimation(anims.run, 1)
            } else {
              spriteC.legsApplyAnimation(anims.runBack, 1)
            }
          } else {
            spriteC.legsApplyAnimation(anims.fall, 1)
          }
        }
        // Was probably a roll (that ended mid-air)
        else if (spriteC.control.down) {
          if (spriteC.control.left || spriteC.control.right) {
            if (spriteC.bodyAnimation.id === anims.roll.id) {
              spriteC.legsApplyAnimation(anims.crouchRun, 1)
            } else {
              spriteC.legsApplyAnimation(anims.crouchRunBack, 1)
            }
          } else {
            spriteC.legsApplyAnimation(anims.crouch, 15)
          }
        }

        spriteC.bodyApplyAnimation(anims.stand, 1)
      }

      // 몸통 애니메이션을 자세 기본값으로 복귀 (Control.pas:2077-2138)
      if (spriteC.weapon.ammoCount > 0) {
        if (
          (!spriteC.control.throwNade &&
            spriteC.bodyAnimation.id !== anims.recoil.id &&
            spriteC.bodyAnimation.id !== anims.smallRecoil.id &&
            spriteC.bodyAnimation.id !== anims.aimRecoil.id &&
            spriteC.bodyAnimation.id !== anims.handsUpRecoil.id &&
            spriteC.bodyAnimation.id !== anims.shotgun.id &&
            spriteC.bodyAnimation.id !== anims.barret.id &&
            spriteC.bodyAnimation.id !== anims.change.id &&
            spriteC.bodyAnimation.id !== anims.throwWeapon.id &&
            spriteC.bodyAnimation.id !== anims.weaponNone.id &&
            spriteC.bodyAnimation.id !== anims.punch.id &&
            spriteC.bodyAnimation.id !== anims.roll.id &&
            spriteC.bodyAnimation.id !== anims.rollBack.id &&
            spriteC.bodyAnimation.id !== anims.reloadBow.id &&
            spriteC.bodyAnimation.id !== anims.cigar.id &&
            spriteC.bodyAnimation.id !== anims.match.id &&
            spriteC.bodyAnimation.id !== anims.smoke.id &&
            spriteC.bodyAnimation.id !== anims.wipe.id &&
            spriteC.bodyAnimation.id !== anims.takeOff.id &&
            spriteC.bodyAnimation.id !== anims.groin.id &&
            spriteC.bodyAnimation.id !== anims.piss.id &&
            spriteC.bodyAnimation.id !== anims.mercy.id &&
            spriteC.bodyAnimation.id !== anims.mercy2.id &&
            spriteC.bodyAnimation.id !== anims.victory.id &&
            spriteC.bodyAnimation.id !== anims.own.id &&
            spriteC.bodyAnimation.id !== anims.reload.id &&
            spriteC.bodyAnimation.id !== anims.prone.id &&
            spriteC.bodyAnimation.id !== anims.getUp.id &&
            spriteC.bodyAnimation.id !== anims.proneMove.id &&
            spriteC.bodyAnimation.id !== anims.melee.id) ||
          (spriteC.bodyAnimation.currFrame === spriteC.bodyAnimation.numFrames &&
            spriteC.bodyAnimation.id !== anims.prone.id) ||
          (spriteC.weapon.fireIntervalCount === 0 && spriteC.bodyAnimation.id === anims.barret.id)
        ) {
          if (spriteC.position !== POS_PRONE) {
            if (spriteC.position === POS_STAND) {
              spriteC.bodyApplyAnimation(anims.stand, 1)
            }

            if (spriteC.position === POS_CROUCH) {
              if (spriteC.colliderDistance < 255) {
                if (spriteC.bodyAnimation.id === anims.handsUpRecoil.id) {
                  spriteC.bodyApplyAnimation(anims.handsUpAim, 11)
                } else {
                  spriteC.bodyApplyAnimation(anims.handsUpAim, 1)
                }
              } else {
                if (spriteC.bodyAnimation.id === anims.aimRecoil.id) {
                  spriteC.bodyApplyAnimation(anims.aim, 6)
                } else {
                  spriteC.bodyApplyAnimation(anims.aim, 1)
                }
              }
            }
          } else {
            spriteC.bodyApplyAnimation(anims.prone, 26)
          }
        }
      }

      /* ═══════════════ Position 상태 확정 (Control.pas:2140-2149) ═══════════════ */
      if (
        spriteC.legsAnimation.id === anims.crouch.id ||
        spriteC.legsAnimation.id === anims.crouchRun.id ||
        spriteC.legsAnimation.id === anims.crouchRunBack.id
      ) {
        spriteC.position = POS_CROUCH
      } else {
        spriteC.position = POS_STAND
      }

      if (
        spriteC.legsAnimation.id === anims.prone.id ||
        spriteC.legsAnimation.id === anims.proneMove.id
      ) {
        spriteC.position = POS_PRONE
      }

      // {$IFNDEF SERVER} if (ClientStopMovingCounter < 1) then FreeControls (2151-2154)
      //   — 클라 유휴 최적화 카운터, 미채택.
      break
    }
  }
}
