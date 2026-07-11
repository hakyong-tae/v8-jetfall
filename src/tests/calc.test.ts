import { describe, it, expect } from 'vitest'
import { vector2 } from '../core/vector'
import {
  distance,
  distanceVec2,
  sqrDist,
  sqrDistVec2,
  angle2Points,
  pointLineDistance,
  roundFair,
  greaterPowerOf2,
  isLineIntersectingCircle,
  lineCircleCollision,
} from '../core/calc'

// distance(X1,Y1,X2,Y2) := Sqrt(Sqr(X1-X2) + Sqr(Y1-Y2))
// classic 3-4-5 right triangle: sqrt(3^2 + 4^2) = sqrt(9+16) = sqrt(25) = 5
describe('distance', () => {
  it('3-4-5 triangle', () => {
    expect(distance(0, 0, 3, 4)).toBe(5)
    expect(distanceVec2(vector2(0, 0), vector2(3, 4))).toBe(5)
  })
})

// SqrDist(X1,Y1,X2,Y2) := Sqr(X1-X2) + Sqr(Y1-Y2) -- no sqrt, so 3-4-5 -> 25
describe('sqrDist', () => {
  it('3-4-5 triangle squared', () => {
    expect(sqrDist(0, 0, 3, 4)).toBe(25)
    expect(sqrDistVec2(vector2(0, 0), vector2(3, 4))).toBe(25)
  })
})

// Angle2Points(P1,P2):
//   if (P2.x - P1.x) <> 0:
//     if P1.x > P2.x: ArcTan((P2.y-P1.y)/(P2.x-P1.x)) + Pi
//     else:           ArcTan((P2.y-P1.y)/(P2.x-P1.x))
//   else:
//     if P2.y > P1.y: Pi/2
//     elif P2.y < P1.y: -Pi/2
//     else: 0
describe('angle2Points (quadrant behavior exactly as Pascal computes it)', () => {
  it('P1=(0,0) P2=(1,0): dx=1<>0, P1.x(0) > P2.x(1)? no -> atan(0/1)=atan(0)=0', () => {
    expect(angle2Points(vector2(0, 0), vector2(1, 0))).toBeCloseTo(0)
  })

  it('P1=(0,0) P2=(-1,0): dx=-1<>0, P1.x(0) > P2.x(-1)? yes -> atan(0/-1)=atan(0)=0, +Pi = Pi', () => {
    expect(angle2Points(vector2(0, 0), vector2(-1, 0))).toBeCloseTo(Math.PI)
  })

  it('P1=(0,0) P2=(1,1): dx=1<>0, P1.x(0) > P2.x(1)? no -> atan(1/1)=atan(1)=Pi/4', () => {
    expect(angle2Points(vector2(0, 0), vector2(1, 1))).toBeCloseTo(Math.PI / 4)
  })

  it('P1=(0,0) P2=(-1,-1): dx=-1<>0, P1.x(0) > P2.x(-1)? yes -> atan((-1)/(-1))=atan(1)=Pi/4, +Pi = 5Pi/4', () => {
    expect(angle2Points(vector2(0, 0), vector2(-1, -1))).toBeCloseTo((5 * Math.PI) / 4)
  })

  it('vertical dx=0: P2.y(1) > P1.y(0) -> Pi/2', () => {
    expect(angle2Points(vector2(0, 0), vector2(0, 1))).toBeCloseTo(Math.PI / 2)
  })

  it('vertical dx=0: P2.y(-1) < P1.y(0) -> -Pi/2', () => {
    expect(angle2Points(vector2(0, 0), vector2(0, -1))).toBeCloseTo(-Math.PI / 2)
  })

  it('dx=0 and dy=0 (P1==P2) -> 0', () => {
    expect(angle2Points(vector2(3, 3), vector2(3, 3))).toBe(0)
  })
})

// PointLineDistance(P1,P2,P3): projects P3 onto infinite line P1-P2, returns perpendicular distance.
// Line (0,0)-(10,0) [the x axis segment], point (5,5):
//   U = ((5-0)*(10-0) + (5-0)*(0-0)) / (Sqr(10-0) + Sqr(0-0)) = (50+0)/100 = 0.5
//   X = 0 + 0.5*10 = 5, Y = 0 + 0.5*0 = 0
//   dist = sqrt(Sqr(5-5) + Sqr(0-5)) = sqrt(25) = 5
describe('pointLineDistance', () => {
  it('perpendicular distance from (5,5) to the segment (0,0)-(10,0) is 5', () => {
    expect(pointLineDistance(vector2(0, 0), vector2(10, 0), vector2(5, 5))).toBeCloseTo(5)
  })
})

// RoundFair(Value) := Floor(Value + 0.5)  -- NOT banker's rounding, unlike pascalRound
//   2.5 -> Floor(3.0) = 3
//   -2.5 -> Floor(-2.0) = -2
//   2.4 -> Floor(2.9) = 2
//   2.6 -> Floor(3.1) = 3
describe('roundFair (plain arithmetic rounding, no banker\'s rule)', () => {
  it('rounds .5 up always (unlike pascalRound)', () => {
    expect(roundFair(2.5)).toBe(3)
    expect(roundFair(-2.5)).toBe(-2)
    expect(roundFair(2.4)).toBe(2)
    expect(roundFair(2.6)).toBe(3)
  })
})

// GreaterPowerOf2(N) := Trunc(Power(2, Ceil(Log2(N))))
//   N=4:  Log2(4)=2, Ceil(2)=2, 2^2=4   (already a power of 2 -> returns itself)
//   N=5:  Log2(5)=2.3219.., Ceil=3, 2^3=8
//   N=1:  Log2(1)=0, Ceil(0)=0, 2^0=1
//   N=17: Log2(17)=4.087.., Ceil=5, 2^5=32
describe('greaterPowerOf2', () => {
  it('matches hand-derived values', () => {
    expect(greaterPowerOf2(4)).toBe(4)
    expect(greaterPowerOf2(5)).toBe(8)
    expect(greaterPowerOf2(1)).toBe(1)
    expect(greaterPowerOf2(17)).toBe(32)
  })
})

// IsLineIntersectingCircle: horizontal line (-10,0)-(10,0), circle center (0,0) r=5.
// diffx=20, diffy=0 -> not flipped. a=0/20=0, b=Line1.y - a*Line1.x = 0.
// a1 = 0+1 = 1
// b1 = 2*(a*b - a*centery - centerx) = 2*(0-0-0) = 0
// c1 = sqr(0) - sqr(5) + sqr(0) - 2*0*0 + sqr(0) = -25
// delta = sqr(0) - 4*1*(-25) = 100, sqrtdelta = 10, a2 = 2
// Intersect1.x = (-0-10)/2 = -5, y = 0
// Intersect2.x = (-0+10)/2 = 5,  y = 0
// both within [minx=-10,maxx=10] x [miny=0,maxy=0] -> 2 intersections: (-5,0) and (5,0)
describe('isLineIntersectingCircle', () => {
  it('horizontal diameter line through a circle yields both intersection points', () => {
    const res = isLineIntersectingCircle(vector2(-10, 0), vector2(10, 0), vector2(0, 0), 5)
    expect(res.numIntersections).toBe(2)
    expect(res.points[0].x).toBeCloseTo(-5)
    expect(res.points[0].y).toBeCloseTo(0)
    expect(res.points[1].x).toBeCloseTo(5)
    expect(res.points[1].y).toBeCloseTo(0)
  })

  it('line entirely outside circle -> 0 intersections (delta < 0)', () => {
    const res = isLineIntersectingCircle(vector2(-10, 100), vector2(10, 100), vector2(0, 0), 5)
    expect(res.numIntersections).toBe(0)
  })

  it('degenerate zero-length line -> 0 intersections (early exit)', () => {
    const res = isLineIntersectingCircle(vector2(1, 1), vector2(1, 1), vector2(0, 0), 5)
    expect(res.numIntersections).toBe(0)
  })
})

// LineCircleCollision: same line/circle as above.
// SqrDist(start,center)=100>25, SqrDist(end,center)=100>25 -> not trivially inside.
// IsLineIntersectingCircle gives points[0]=(-5,0), points[1]=(5,0), numIntersections=2.
// Tie-break: SqrDist(points[0],start) = Sqr(-5-(-10))+Sqr(0-0) = 25
//            SqrDist(points[1],start) = Sqr(5-(-10))+Sqr(0-0) = 225
// 25 > 225 is false, so CollisionPoint stays points[0] = (-5,0) (closest to start).
describe('lineCircleCollision', () => {
  it('picks the intersection point closest to StartPoint', () => {
    const res = lineCircleCollision(vector2(-10, 0), vector2(10, 0), vector2(0, 0), 5)
    expect(res.hit).toBe(true)
    expect(res.collisionPoint.x).toBeCloseTo(-5)
    expect(res.collisionPoint.y).toBeCloseTo(0)
  })

  it('StartPoint already inside circle -> immediate hit at StartPoint', () => {
    const res = lineCircleCollision(vector2(0, 0), vector2(10, 0), vector2(0, 0), 5)
    expect(res.hit).toBe(true)
    expect(res.collisionPoint).toEqual({ x: 0, y: 0 })
  })

  it('no intersection at all -> hit = false', () => {
    const res = lineCircleCollision(vector2(-10, 100), vector2(10, 100), vector2(0, 0), 5)
    expect(res.hit).toBe(false)
  })
})
