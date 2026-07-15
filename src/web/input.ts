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

export class InputState {
  private keys = new Set<string>()
  private mouseButtons = new Set<number>()
  private menuOpen = false // M5: 무기선택(림보) 메뉴가 열려있는 동안 좌클릭(발사) 억제용 게이트
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

  attach(target: HTMLElement): void {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code)
      // 스크롤/포커스 이동 방지 (게임 키만)
      if (['Space', 'Tab', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) e.preventDefault()
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
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
    control.changeWeapon = this.keys.has('KeyQ')
    control.reload = this.keys.has('KeyR')
    control.throwWeapon = this.keys.has('KeyF')
    control.throwNade = this.keys.has('KeyE')
    control.flagThrow = this.keys.has('Space')

    // 스크린 → 월드 (줌 1 고정: 스크린 px = 월드 단위)
    control.mouseAimX = Math.round(cameraX + this.mouseX - screenW / 2)
    control.mouseAimY = Math.round(cameraY + this.mouseY - screenH / 2)
  }
}
