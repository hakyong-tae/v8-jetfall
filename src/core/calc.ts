// Faithful 1:1 port of Calc.pas (Soldat) — pure geometry/math functions.
// THE ORIGINAL PASCAL IS THE TRUTH: logic, edge cases and oddities are preserved as-is.
import { sqr, trunc } from './pascal'
import { type TVector2, vector2, cloneVec2 } from './vector'

// Delphi Math.InRange(AValue, AMin, AMax) = (AValue >= AMin) and (AValue <= AMax)
function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max
}

// Pascal: TIntersectionResult = record Points: array[0..1] of TVector2; NumIntersections: Byte; end;
export interface TIntersectionResult {
  points: [TVector2, TVector2]
  numIntersections: number
}

// Pascal: function IsLineIntersectingCircle(Line1, Line2, CircleCenter: TVector2; Radius: Single): TIntersectionResult;
// Line1/Line2/CircleCenter are value params in Pascal (records copied on call), so the internal
// coordinate-flip mutation is purely local there — here we copy the x/y components into local
// mutable numbers instead of mutating the caller's TVector2 objects.
export function isLineIntersectingCircle(
  line1: TVector2,
  line2: TVector2,
  circleCenter: TVector2,
  radius: number,
): TIntersectionResult {
  const result: TIntersectionResult = {
    points: [vector2(0, 0), vector2(0, 0)],
    numIntersections: 0,
  }

  let line1x = line1.x
  let line1y = line1.y
  let line2x = line2.x
  let line2y = line2.y
  let centerx = circleCenter.x
  let centery = circleCenter.y

  let diffx = line2x - line1x
  let diffy = line2y - line1y

  if (Math.abs(diffx) < 0.00001 && Math.abs(diffy) < 0.00001) {
    // The line is a lie! (degenerate zero-length line)
    return result
  }

  // if the angle of the bullet is bigger than 45 degrees, flip the coordinate system.
  let flipped: boolean
  if (Math.abs(diffy) > Math.abs(diffx)) {
    flipped = true
    let temp = line1x
    line1x = line1y
    line1y = temp

    temp = line2x
    line2x = line2y
    line2y = temp

    temp = centerx
    centerx = centery
    centery = temp

    temp = diffx
    diffx = diffy
    diffy = temp
  } else {
    flipped = false
  }

  // Line equation: ax + b - y = 0
  const a = diffy / diffx
  const b = line1y - a * line1x

  // Circle equation intersection solved as standard A x^2 + B x + C = 0
  const a1 = sqr(a) + 1
  const b1 = 2 * (a * b - a * centery - centerx)
  const c1 = sqr(centery) - sqr(radius) + sqr(centerx) - 2 * b * centery + sqr(b)
  const delta = sqr(b1) - 4 * a1 * c1

  if (delta < 0) return result

  let minx: number
  let maxx: number
  if (line1x < line2x) {
    minx = line1x
    maxx = line2x
  } else {
    minx = line2x
    maxx = line1x
  }

  let miny: number
  let maxy: number
  if (line1y < line2y) {
    miny = line1y
    maxy = line2y
  } else {
    miny = line2y
    maxy = line1y
  }

  const sqrtdelta = Math.sqrt(delta)
  const a2 = 2 * a1

  let ix = (-b1 - sqrtdelta) / a2
  let iy = a * ix + b
  if (inRange(ix, minx, maxx) && inRange(iy, miny, maxy)) {
    let px = ix
    let py = iy
    if (flipped) {
      const temp = px
      px = py
      py = temp
    }
    result.points[result.numIntersections] = vector2(px, py)
    result.numIntersections = result.numIntersections + 1
  }

  ix = (-b1 + sqrtdelta) / a2
  iy = a * ix + b
  if (inRange(ix, minx, maxx) && inRange(iy, miny, maxy)) {
    let px = ix
    let py = iy
    if (flipped) {
      const temp = px
      px = py
      py = temp
    }
    result.points[result.numIntersections] = vector2(px, py)
    result.numIntersections = result.numIntersections + 1
  }

  return result
}

// Pascal: function LineCircleCollision(StartPoint, EndPoint, CircleCenter: TVector2;
//   Radius: Single; var CollisionPoint: TVector2): Boolean;
// `var CollisionPoint` (out-param) + Boolean return -> merged into one return object:
//   { hit: boolean; collisionPoint: TVector2 }
// When hit is false, collisionPoint is meaningless (mirrors the Pascal out-param being left
// unassigned in the no-collision path) — do not read it in that case.
export interface LineCircleCollisionResult {
  hit: boolean
  collisionPoint: TVector2
}

export function lineCircleCollision(
  startPoint: TVector2,
  endPoint: TVector2,
  circleCenter: TVector2,
  radius: number,
): LineCircleCollisionResult {
  const r2 = sqr(radius)

  if (sqrDistVec2(startPoint, circleCenter) <= r2) {
    return { hit: true, collisionPoint: cloneVec2(startPoint) }
  }

  if (sqrDistVec2(endPoint, circleCenter) <= r2) {
    return { hit: true, collisionPoint: cloneVec2(endPoint) }
  }

  const intersectionResult = isLineIntersectingCircle(startPoint, endPoint, circleCenter, radius)
  if (intersectionResult.numIntersections > 0) {
    let collisionPoint = intersectionResult.points[0]
    if (
      intersectionResult.numIntersections === 2 &&
      sqrDistVec2(intersectionResult.points[0], startPoint) >
        sqrDistVec2(intersectionResult.points[1], startPoint)
    ) {
      collisionPoint = intersectionResult.points[1]
    }
    return { hit: true, collisionPoint }
  }

  return { hit: false, collisionPoint: vector2(0, 0) }
}

// Pascal: function PointLineDistance(P1, P2, P3: TVector2): Single;
export function pointLineDistance(p1: TVector2, p2: TVector2, p3: TVector2): number {
  const u =
    ((p3.x - p1.x) * (p2.x - p1.x) + (p3.y - p1.y) * (p2.y - p1.y)) /
    (sqr(p2.x - p1.x) + sqr(p2.y - p1.y))

  const x = p1.x + u * (p2.x - p1.x)
  const y = p1.y + u * (p2.y - p1.y)

  return Math.sqrt(sqr(x - p3.x) + sqr(y - p3.y))
}

// Pascal: function Angle2Points(const P1, P2: TVector2): Single;
export function angle2Points(p1: TVector2, p2: TVector2): number {
  if (p2.x - p1.x !== 0) {
    if (p1.x > p2.x) {
      return Math.atan((p2.y - p1.y) / (p2.x - p1.x)) + Math.PI
    } else {
      return Math.atan((p2.y - p1.y) / (p2.x - p1.x))
    }
  } else {
    if (p2.y > p1.y) {
      return Math.PI / 2
    } else if (p2.y < p1.y) {
      return -Math.PI / 2
    } else {
      return 0
    }
  }
}

// Pascal: function Distance(X1, Y1, X2, Y2: Single): Single; overload;
export function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt(sqr(x1 - x2) + sqr(y1 - y2))
}

// Pascal: function Distance(P1, P2: TVector2): Single; overload;
// Pascal overloads dispatch by parameter type; TS has no such dispatch, so the TVector2
// overload gets the distinct name `distanceVec2`.
export function distanceVec2(p1: TVector2, p2: TVector2): number {
  return Math.sqrt(sqr(p1.x - p2.x) + sqr(p1.y - p2.y))
}

// Pascal: function SqrDist(X1, Y1, X2, Y2: Single): Single; overload;
export function sqrDist(x1: number, y1: number, x2: number, y2: number): number {
  return sqr(x1 - x2) + sqr(y1 - y2)
}

// Pascal: function SqrDist(P1, P2: TVector2): Single; overload;
// See distanceVec2 note above re: overload naming.
export function sqrDistVec2(p1: TVector2, p2: TVector2): number {
  return sqr(p1.x - p2.x) + sqr(p1.y - p2.y)
}

// Pascal: function GreaterPowerOf2(N: Integer): Integer;
// Result := Trunc(Power(2, Ceil(Log2(N))));
export function greaterPowerOf2(n: number): number {
  return trunc(Math.pow(2, Math.ceil(Math.log2(n))))
}

// Pascal: function RoundFair(Value: Single): Integer;
// Rounds, but without that "Banker's rule" that prefers even numbers (unlike pascalRound).
export function roundFair(value: number): number {
  return Math.floor(value + 0.5)
}
