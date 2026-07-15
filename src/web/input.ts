// 키/마우스 입력 → TControl 불리언 + mouseAim(월드좌표) 매핑.
// 바인딩 출처: soldat-ref/base/client/configs/controls.cfg (기본 바인딩 그대로):
//   A=+left  D=+right  W=+jump(up)  S=+crouch(down)  X=+prone
//   MOUSE1(좌클릭)=+fire  MOUSE3(우클릭)=+jet  Q=+changeweapon  R=+reload
//   F=+dropweapon(throwWeapon)  E=+throwgrenade(throwNade)  Space=+flagthrow
// (T/Y/V 채팅, Tab 무기메뉴, F1~F5, CTRL+* 카메라는 UI 계열 — TODO(M2+))
//
// mouseAim: Control.pas의 MouseAimX/Y는 월드 좌표 SmallInt — 커서 스크린 좌표를
// 카메라 기준 월드로 변환해 매 틱 덮어쓴다 (Control.pas:211-215의 관성 보정은
// 원본에서도 입력 샘플링이 다시 덮어쓰는 값).
import type { TControl } from '../core/sprites'

// M7 Task4: "요청 슬롯 ≠ 현재 든 슬롯"일 때만 스왑(코어 changeWeapon 토글을 1회 엣지 발동).
// 순수 함수로 분리해 단위테스트 가능하게 한다(코어 무수정, 값 비교만).
export function shouldSwap(currentNum: number, targetNum: number): boolean {
  return targetNum !== currentNum
}

// M7 Task4: 슬롯 요청(1=주/2=보조)이 가리키는 무기 num을 계산(순수). selWeapon===0(주무기 미선택
// =맨손)이면 실제 든 무기가 NOWEAPON이므로 그 num으로 맞춘다 — 안 그러면 맨손에서 1을 눌렀을 때
// shouldSwap(255,0)=true로 잘못 보조로 스왑됨(리뷰 finding #1). 코어 무수정, 값 계산만.
export function slotTargetNum(
  req: 1 | 2,
  selWeapon: number,
  noWeaponNum: number,
  secondaryNum: number | undefined,
): number | undefined {
  if (req === 1) return selWeapon > 0 ? selWeapon : noWeaponNum
  return secondaryNum
}

export class InputState {
  private keys = new Set<string>()
  private mouseButtons = new Set<number>()
  private menuOpen = false // M5: 무기선택(림보) 메뉴가 열려있는 동안 좌클릭(발사) 억제용 게이트
  // M7 Task4: 1/2 직접 무기전환 요청(엣지 트리거). keydown 전이에서 1회 세팅, consume에서 소비.
  private slotSwitchReq: 1 | 2 | null = null
  mouseX = 0 // 캔버스(스크린) px
  mouseY = 0

  // M5: 로드아웃(림보) 메뉴가 화면 일부만 덮으므로(중앙 하단), 메뉴 바깥 캔버스 클릭이 그대로
  // 발사로 새지 않도록 UI측에서 명시적으로 게이트한다(코어 TControl은 무수정).
  setMenuOpen(open: boolean): void {
    this.menuOpen = open
  }

  // M5: Tab 스코어보드 — 원본 change-weapon 키(Q)와 겹치지 않게 별도 키. attach()에서 이미
  // e.preventDefault()로 브라우저 포커스 이동을 막고 있으므로 keys 세트에 항상 기록된다.
  isTabHeld(): boolean {
    return this.keys.has('Tab')
  }

  // M7 Task4: keydown 처리(엣지 감지 포함). attach()의 실제 이벤트 리스너와 테스트가 공유한다
  // (테스트는 DOM 없이 이 메서드를 직접 호출해 엣지 동작을 검증). keys 세트를 pressed-latch로
  // 사용해 오토리핏(이미 눌려있는 키)은 재트리거하지 않는다.
  noteKeyDown(code: string): void {
    const wasDown = this.keys.has(code)
    this.keys.add(code)
    if (wasDown || this.menuOpen) return // 오토리핏/메뉴열림 중엔 슬롯전환 요청 억제
    if (code === 'Digit1' || code === 'Numpad1') this.slotSwitchReq = 1
    else if (code === 'Digit2' || code === 'Numpad2') this.slotSwitchReq = 2
  }

  noteKeyUp(code: string): void {
    this.keys.delete(code)
  }

  // M7 Task4: 요청된 슬롯을 1회 반환(엣지 소비). 이후 다음 keydown 전까지 null.
  consumeSlotSwitch(): 1 | 2 | null {
    const r = this.slotSwitchReq
    this.slotSwitchReq = null
    return r
  }

  attach(target: HTMLElement): void {
    window.addEventListener('keydown', (e) => {
      this.noteKeyDown(e.code)
      // 스크롤/포커스 이동 방지 (게임 키만)
      if (['Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault()
    })
    window.addEventListener('keyup', (e) => this.noteKeyUp(e.code))
    window.addEventListener('blur', () => {
      this.keys.clear()
      this.mouseButtons.clear()
    })
    target.addEventListener('mousedown', (e) => {
      this.mouseButtons.add(e.button)
      e.preventDefault()
    })
    window.addEventListener('mouseup', (e) => this.mouseButtons.delete(e.button))
    target.addEventListener('mousemove', (e) => {
      const rect = target.getBoundingClientRect()
      this.mouseX = e.clientX - rect.left
      this.mouseY = e.clientY - rect.top
    })
    // 우클릭 = 제트 — 컨텍스트 메뉴 차단
    target.addEventListener('contextmenu', (e) => e.preventDefault())
  }

  // 매 틱 TControl에 반영. cameraX/Y = 카메라 중심 월드좌표, screenW/H = 뷰포트 px.
  applyTo(control: TControl, cameraX: number, cameraY: number, screenW: number, screenH: number): void {
    control.left = this.keys.has('KeyA')
    control.right = this.keys.has('KeyD')
    control.up = this.keys.has('KeyW') // +jump
    control.down = this.keys.has('KeyS') // +crouch
    control.prone = this.keys.has('KeyX')
    control.jetpack = this.mouseButtons.has(2) // MOUSE3 = 우클릭
    control.fire = !this.menuOpen && this.mouseButtons.has(0) // MOUSE1 — 로드아웃 메뉴 열림 중엔 억제
    // M7 Task4: Q의 코어 changeWeapon(주↔보조 토글 스왑) 매핑 제거. Q는 이제 무기창 전용
    // (loadout-menu.ts 자체 리스너). 무기전환은 1/2 직접선택 → main.ts가 슬롯 요청을 읽어
    // 필요한 틱에만 control.changeWeapon=true를 세팅한다. 여기선 항상 false로 초기화.
    control.changeWeapon = false
    control.reload = this.keys.has('KeyR')
    control.throwWeapon = this.keys.has('KeyF')
    control.throwNade = this.keys.has('KeyE')
    control.flagThrow = this.keys.has('Space')

    // 스크린 → 월드 (줌 1 고정: 스크린 px = 월드 단위)
    control.mouseAimX = Math.round(cameraX + this.mouseX - screenW / 2)
    control.mouseAimY = Math.round(cameraY + this.mouseY - screenH / 2)
  }
}
