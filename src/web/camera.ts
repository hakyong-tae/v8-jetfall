// 카메라 — 플레이어 추종 + 마우스 방향 오프셋.
// 원본(client/UpdateFrame.pas:314-341)은 매 틱 Cam += (PlayerPos - Cam)*CAMSPEED + M
// (M = (mouse - 화면중심)/AimDistCoef, CAMSPEED=0.14, DEFAULTAIMDIST=7 — Constants.pas:49,54).
// 이 누적항 방식은 줌/해상도 보정 매직넘버(~6.8)가 얽혀 있어(원본 FIXME 주석 참조),
// 여기선 등가 평형점을 직접 목표로 삼는 단순화 채택:
//   target = player + (mouse - 중심) * AIM_OFFSET, cam += (target - cam) * CAMSPEED
// (원본 평형점 cam ≈ player + M/CAMSPEED 에서 AIM_OFFSET ≈ 1/(7*0.14) ≈ 1.02는 과격해
//  0.3으로 낮춤 — M1 플레이 감 위주. 원본 수식 복원은 TODO(M2) 튜닝.)
const CAMSPEED = 0.14 // Constants.pas:49

export class Camera {
  x = 0
  y = 0
  private initialized = false

  static readonly AIM_OFFSET = 0.3

  update(playerX: number, playerY: number, mouseX: number, mouseY: number, screenW: number, screenH: number): void {
    const targetX = playerX + (mouseX - screenW / 2) * Camera.AIM_OFFSET
    const targetY = playerY + (mouseY - screenH / 2) * Camera.AIM_OFFSET
    if (!this.initialized) {
      this.x = targetX
      this.y = targetY
      this.initialized = true
      return
    }
    this.x += (targetX - this.x) * CAMSPEED
    this.y += (targetY - this.y) * CAMSPEED
  }
}
