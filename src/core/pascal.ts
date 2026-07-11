// Pascal 내장함수 대응 유틸
export function trunc(x: number): number { return Math.trunc(x) }
export function sqr(x: number): number { return x * x }
// Pascal Round = banker's rounding (half to even)
export function pascalRound(x: number): number {
  const f = Math.floor(x)
  const diff = x - f
  if (diff > 0.5) return f + 1
  if (diff < 0.5) return f
  // diff === 0.5, banker's rounding (round to even)
  const result = f % 2 === 0 ? f : f + 1
  // Handle -0 case: if result is 0 and original was negative
  if (result === 0 && x < 0) return -0
  return result
}
export function random(n: number): number { return Math.floor(Math.random() * n) }
export function randomFloat(): number { return Math.random() }
