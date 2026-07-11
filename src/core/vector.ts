// 범용 2D 벡터 (원본 Vector.pas는 MPL 라이선스라 번역하지 않고 표준 연산 직접 작성)
export interface TVector2 { x: number; y: number }

export function vector2(x: number, y: number): TVector2 { return { x, y } }
export function cloneVec2(v: TVector2): TVector2 { return { x: v.x, y: v.y } }
export function vec2Length(v: TVector2): number { return Math.sqrt(v.x * v.x + v.y * v.y) }
export function vec2Length2(v: TVector2): number { return v.x * v.x + v.y * v.y }
export function vec2Dot(a: TVector2, b: TVector2): number { return a.x * b.x + a.y * b.y }
export function vec2Add(a: TVector2, b: TVector2): TVector2 { return { x: a.x + b.x, y: a.y + b.y } }
export function vec2Subtract(a: TVector2, b: TVector2): TVector2 { return { x: a.x - b.x, y: a.y - b.y } }
export function vec2Scale(v: TVector2, s: number): TVector2 { return { x: v.x * s, y: v.y * s } }
export function vec2Normalize(v: TVector2): TVector2 {
  const len = vec2Length(v)
  if (len < 0.001 && len > -0.001) return { x: 0, y: 0 }
  return { x: v.x / len, y: v.y / len }
}
