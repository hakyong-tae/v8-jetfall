# M1: 이동물리 + 맵 렌더 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원본 Soldat 맵(ctf_Ash) 위에서 군인 1명이 원본과 동일한 느낌으로 달리기·점프·제트팩·프론·롤을 할 수 있는 싱글 웹 빌드.

**Architecture:** `soldat-ref/soldat/shared/`의 Pascal 소스를 파일 1:1로 TypeScript 번역(`src/core/`, 순수 로직). 렌더링은 PixiJS(`src/web/`). 에셋은 Node 파이프라인(`tools/`)이 `soldat-ref/base/`에서 변환·복사하고 manifest.json으로 간접 참조.

**Tech Stack:** Vite + TypeScript + PixiJS v8 + Vitest + jimp(BMP 변환, tools 전용)

**원본 소스 위치(모든 태스크의 번역 원본):** `/Users/hytae/Downloads/soldat-ref/soldat/shared/`
**에셋 원본:** `/Users/hytae/Downloads/soldat-ref/base/`

---

## 공통 포팅 규약 (모든 번역 태스크에 적용 — 위반은 버그)

1. **파일 1:1**: `Parts.pas → src/core/parts.ts`처럼 원본 유닛당 TS 파일 하나. 함수·필드명은 camelCase 변환만 (`SatisfyConstraints → satisfyConstraints`, `OneOverMass → oneOverMass`).
2. **1-based 배열 유지**: `array[1..N]`은 `new Array(N+1)`로 잡고 인덱스 0은 사용 금지. 루프도 `for (let i = 1; i <= n; i++)` 그대로.
3. **record 대입 = 깊은 복사**: Pascal의 `a := b`(record)는 TS에서 `a = cloneX(b)` 명시 호출. TVector2는 `{x, y}` 새 객체 생성.
4. **Pascal 내장함수 대응** (`src/core/pascal.ts`에 유틸 구현, Task 2):
   - `Trunc(x)` → `Math.trunc(x)` / `div` → `Math.trunc(a/b)`
   - `Round(x)` → **banker's rounding** (half-to-even; `Math.round` 금지)
   - `Sqr(x)` → `x*x`, `ArcTan2` → `Math.atan2`
   - `Random` → `Math.random` 계열 래퍼 (`random(n)` = `Math.floor(Math.random()*n)`)
5. **Single(f32)**: 기본 f64로 번역. 느낌 차이 발견 시에만 해당 경로 `Math.fround`. (스펙 4.2)
6. **{$IFDEF SERVER}/{$ELSE}**: M1은 클라이언트 분기만 번역하되, 서버 분기는 `// TODO(M3) SERVER:` 주석으로 위치만 남김.
7. **⚠️ Vector.pas 예외**: 이 파일만 MPL/LGPL(JEDI D3DX 유래)이라 **번역하지 않고** 동일 시그니처의 범용 2D 벡터 연산을 직접 작성한다(수학 연산이라 결과 동일). 나머지 shared/*는 MIT.

## 파일 구조 (M1 산출물)

```
soldat-web/
├── index.html  vite.config.ts  package.json  tsconfig.json  .gitignore
├── tools/build-assets.mjs        ← base/ → public/assets/ 변환+manifest
├── public/assets/                ← (생성물) manifest.json, gostek/, maps/, anims/, textures/, scenery/
├── src/
│   ├── core/
│   │   ├── pascal.ts             ← Pascal 내장함수 유틸 (신규)
│   │   ├── vector.ts             ← 범용 작성 (규약 7)
│   │   ├── calc.ts               ← Calc.pas
│   │   ├── constants.ts          ← Constants.pas
│   │   ├── parts.ts              ← Parts.pas
│   │   ├── mapfile.ts            ← MapFile.pas (PMS 파서)
│   │   ├── polymap.ts            ← PolyMap.pas
│   │   ├── anims.ts              ← Anims.pas (.poa 로더 + 애니 레지스트리)
│   │   ├── control.ts            ← mechanics/Control.pas
│   │   ├── sprites.ts            ← mechanics/Sprites.pas (M1: 이동 관련만)
│   │   └── state.ts              ← Pascal 전역변수 컨테이너 (신규)
│   ├── web/
│   │   ├── main.ts               ← 엔트리: 로딩→게임루프
│   │   ├── assets.ts             ← manifest 로더
│   │   ├── maprender.ts          ← 맵 폴리곤/씬어리 렌더
│   │   ├── gostek.ts             ← 군인 스켈레톤 렌더 (client/GostekGraphics.pas 참조)
│   │   ├── input.ts              ← 키/마우스 → TControl
│   │   └── camera.ts
│   └── tests/                    ← vitest (core 전용, *.test.ts)
```

---

### Task 0: 프로젝트 스캐폴드

**Files:** Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.gitignore`, `src/web/main.ts`(스텁)

- [ ] **Step 1: 파일 생성**

`package.json`:
```json
{
  "name": "soldat-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "assets": "node tools/build-assets.mjs"
  }
}
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vite'

export default defineConfig({
  publicDir: 'public',
  server: { port: 3024 },
  preview: { port: 3024 },
  build: { outDir: 'dist', chunkSizeWarningLimit: 5000 },
})
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler",
    "strict": true, "noUncheckedIndexedAccess": false,
    "types": ["vite/client"], "skipLibCheck": true
  },
  "include": ["src", "tools"]
}
```

`index.html`:
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>soldat-web (M1)</title>
  <style>html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{display:block}</style>
</head>
<body>
  <script type="module" src="/src/web/main.ts"></script>
</body>
</html>
```

`.gitignore`:
```
node_modules/
dist/
public/assets/
.DS_Store
```

`src/web/main.ts` 스텁:
```ts
console.log('soldat-web M1')
```

- [ ] **Step 2: 의존성 설치** — `export PATH="$HOME/.nvm/versions/node/v23.11.0/bin:$PATH" && npm install --save-dev vite typescript vitest && npm install pixi.js && npm install --save-dev jimp`
- [ ] **Step 3: 확인** — `npm run dev` 기동 → localhost:3024 콘솔에 `soldat-web M1`. `npm test` → "no test files" 정상.
- [ ] **Step 4: Commit** — `git add -A && git commit -m "chore: scaffold vite+ts+pixi project (port 3024)"`

### Task 1: 에셋 파이프라인 (tools/build-assets.mjs)

**Files:** Create: `tools/build-assets.mjs`

M1 필요 에셋: `gostek-gfx/`(군인 파츠 BMP→PNG), `maps/ctf_Ash.pms`+전체 99맵, `anims/*.poa`, `textures/`(맵 텍스처), `scenery-gfx/`(맵 소품). BMP는 좌하단 (0,255,0) 그린 컬러키 → 알파 변환.

- [ ] **Step 1: 스크립트 작성**

```js
// tools/build-assets.mjs — soldat-ref/base → public/assets 변환 + manifest.json
import { Jimp } from 'jimp'
import { cp, mkdir, readdir, writeFile } from 'node:fs/promises'
import { join, basename, extname } from 'node:path'

const BASE = '/Users/hytae/Downloads/soldat-ref/base'
const OUT = new URL('../public/assets/', import.meta.url).pathname

async function convertDir(srcDir, outDir, manifest, keyPrefix) {
  await mkdir(outDir, { recursive: true })
  for (const f of await readdir(srcDir, { recursive: true })) {
    const src = join(srcDir, f)
    const ext = extname(f).toLowerCase()
    if (ext === '.png') {
      await cp(src, join(outDir, f))
      manifest[`${keyPrefix}/${f.replace(/\.png$/i, '')}`] = `${keyPrefix}/${f}`
    } else if (ext === '.bmp') {
      const img = await Jimp.read(src)
      // 그린 컬러키(0,255,0) → 투명. Soldat BMP 관례: 순수 녹색 = 배경
      img.scan(0, 0, img.bitmap.width, img.bitmap.height, function (x, y, idx) {
        const d = this.bitmap.data
        if (d[idx] === 0 && d[idx + 1] === 255 && d[idx + 2] === 0) d[idx + 3] = 0
      })
      const out = f.replace(/\.bmp$/i, '.png')
      await img.write(join(outDir, out))
      manifest[`${keyPrefix}/${f.replace(/\.bmp$/i, '')}`] = `${keyPrefix}/${out}`
    }
  }
}

const manifest = { sprites: {}, maps: [], anims: [] }
await convertDir(join(BASE, 'shared/gostek-gfx'), join(OUT, 'gostek'), manifest.sprites, 'gostek')
await convertDir(join(BASE, 'shared/textures'), join(OUT, 'textures'), manifest.sprites, 'textures')
await convertDir(join(BASE, 'shared/scenery-gfx'), join(OUT, 'scenery'), manifest.sprites, 'scenery')

await mkdir(join(OUT, 'maps'), { recursive: true })
for (const f of await readdir(join(BASE, 'shared/maps'))) {
  if (f.endsWith('.pms')) { await cp(join(BASE, 'shared/maps', f), join(OUT, 'maps', f)); manifest.maps.push(basename(f, '.pms')) }
}
await mkdir(join(OUT, 'anims'), { recursive: true })
for (const f of await readdir(join(BASE, 'shared/anims'))) {
  if (f.endsWith('.poa') || f.endsWith('.po')) { await cp(join(BASE, 'shared/anims', f), join(OUT, 'anims', f)); manifest.anims.push(f) }
}
await writeFile(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log('assets built:', Object.keys(manifest.sprites).length, 'sprites,', manifest.maps.length, 'maps,', manifest.anims.length, 'anims')
```

주의: jimp v1 API(`Jimp.read`/`img.write`)가 다르면 설치된 버전 README에 맞춰 조정. `base/shared/anims/`에 `gostek.po`(스켈레톤 정의)가 있는지 확인하고 없으면 `soldat-ref/soldat/client/`나 smod 내부에서 찾아 같은 폴더로 복사한다.

- [ ] **Step 2: 실행** — `npm run assets` → 출력 예상: `assets built: ~1000 sprites, 99 maps, 51+ anims`. `public/assets/gostek/*.png` 몇 개를 열어 투명 배경 확인.
- [ ] **Step 3: Commit** — `git add tools/ && git commit -m "feat: asset pipeline base→public/assets with manifest"` (public/assets는 .gitignore 대상 — 생성물)

### Task 2: core/pascal.ts + core/vector.ts

**Files:** Create: `src/core/pascal.ts`, `src/core/vector.ts`, `src/tests/pascal.test.ts`, `src/tests/vector.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
// src/tests/pascal.test.ts
import { describe, it, expect } from 'vitest'
import { pascalRound, trunc, sqr } from '../core/pascal'

describe('pascalRound (banker\'s rounding)', () => {
  it('rounds half to even', () => {
    expect(pascalRound(0.5)).toBe(0)
    expect(pascalRound(1.5)).toBe(2)
    expect(pascalRound(2.5)).toBe(2)
    expect(pascalRound(-0.5)).toBe(-0)
    expect(pascalRound(-1.5)).toBe(-2)
    expect(pascalRound(2.4)).toBe(2)
    expect(pascalRound(2.6)).toBe(3)
  })
})
describe('trunc/sqr', () => {
  it('behaves like Pascal', () => {
    expect(trunc(2.9)).toBe(2)
    expect(trunc(-2.9)).toBe(-2)
    expect(sqr(3)).toBe(9)
  })
})
```

```ts
// src/tests/vector.test.ts
import { describe, it, expect } from 'vitest'
import { vector2, vec2Length, vec2Add, vec2Subtract, vec2Scale, vec2Normalize, vec2Dot } from '../core/vector'

describe('vector2', () => {
  it('basic ops', () => {
    expect(vec2Length(vector2(3, 4))).toBe(5)
    expect(vec2Add(vector2(1, 2), vector2(3, 4))).toEqual({ x: 4, y: 6 })
    expect(vec2Subtract(vector2(3, 4), vector2(1, 2))).toEqual({ x: 2, y: 2 })
    expect(vec2Scale(vector2(1, 2), 3)).toEqual({ x: 3, y: 6 })
    expect(vec2Dot(vector2(1, 2), vector2(3, 4))).toBe(11)
  })
  it('normalize: len<0.001 → zero vector (원본 Vec2Normalize 동작)', () => {
    expect(vec2Normalize(vector2(0.0005, 0))).toEqual({ x: 0, y: 0 })
    const n = vec2Normalize(vector2(3, 4))
    expect(n.x).toBeCloseTo(0.6); expect(n.y).toBeCloseTo(0.8)
  })
})
```

- [ ] **Step 2: 실패 확인** — `npm test` → import 실패로 FAIL
- [ ] **Step 3: 구현**

```ts
// src/core/pascal.ts — Pascal 내장함수 대응 유틸
export function trunc(x: number): number { return Math.trunc(x) }
export function sqr(x: number): number { return x * x }
// Pascal Round = banker's rounding (half to even)
export function pascalRound(x: number): number {
  const f = Math.floor(x)
  const diff = x - f
  if (diff > 0.5) return f + 1
  if (diff < 0.5) return f
  return f % 2 === 0 ? f : f + 1
}
export function random(n: number): number { return Math.floor(Math.random() * n) }
export function randomFloat(): number { return Math.random() }
```

```ts
// src/core/vector.ts — 범용 2D 벡터 (Vector.pas는 MPL이라 번역하지 않음; 동일 시그니처의 표준 연산을 직접 작성)
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
```

(원본 `Vec2Scale(out vOut,...)` out-param 스타일은 TS에서 반환값 스타일로 통일 — 호출부 번역 시 `Vec2Scale(S, V, k)` → `S = vec2Scale(V, k)`)

- [ ] **Step 4: 통과 확인** — `npm test` → PASS
- [ ] **Step 5: Commit** — `git commit -m "feat(core): pascal builtins + vector2 ops"`

### Task 3: core/calc.ts (Calc.pas 264줄 전체 번역)

**Files:** Create: `src/core/calc.ts`, `src/tests/calc.test.ts` · 원본: `shared/Calc.pas`

- [ ] **Step 1: 원본 읽기** — `soldat-ref/soldat/shared/Calc.pas` 전체 (Distance, PointLineDistance, LineCircleCollision, Angle2Points 등 순수 기하 함수들)
- [ ] **Step 2: 실패 테스트**

```ts
// src/tests/calc.test.ts
import { describe, it, expect } from 'vitest'
import { distance, angle2Points } from '../core/calc'
import { vector2 } from '../core/vector'

describe('calc', () => {
  it('distance', () => { expect(distance(0, 0, 3, 4)).toBe(5) })
  it('angle2Points matches atan2 convention of original', () => {
    const a = angle2Points(vector2(0, 0), vector2(1, 1))
    expect(a).toBeCloseTo(Math.atan2(1, 1))
  })
})
```

(`angle2Points`의 정확한 부호/사분면 규약은 Calc.pas 구현을 그대로 옮긴 뒤 테스트 기대값을 원본 수식으로 계산해 맞춘다 — 기대값이 위와 다르면 **테스트를 원본 동작에 맞게 수정**한다. 원본이 진실.)

- [ ] **Step 3: 전체 번역** — Calc.pas의 모든 함수를 규약대로 번역. 생략 금지.
- [ ] **Step 4: PASS 확인 후 Commit** — `git commit -m "feat(core): port Calc.pas"`

### Task 4: core/parts.ts (Parts.pas — Verlet 물리 코어)

**Files:** Create: `src/core/parts.ts`, `src/tests/parts.test.ts` · 원본: `shared/Parts.pas` (351줄, 전체 이미 분석됨)

- [ ] **Step 1: 실패 테스트** (수치는 Verlet 수식 손계산)

```ts
// src/tests/parts.test.ts
import { describe, it, expect } from 'vitest'
import { ParticleSystem } from '../core/parts'
import { vector2 } from '../core/vector'

describe('ParticleSystem.verlet', () => {
  it('free fall with vDamping=1 (pure Verlet): pos = 2*pos - old + g*dt²', () => {
    const ps = new ParticleSystem()
    ps.timeStep = 1; ps.gravity = 1; ps.vDamping = 1; ps.eDamping = 1
    ps.createPart(vector2(100, 100), vector2(0, 0), 1, 1)
    ps.doVerletTimeStep()  // pos=(100,101), old=(100,100)
    expect(ps.pos[1]).toEqual({ x: 100, y: 101 })
    ps.doVerletTimeStep()  // 2*(100,101)-(100,100)+(0,1) = (100,103)
    expect(ps.pos[1]).toEqual({ x: 100, y: 103 })
    ps.doVerletTimeStep()  // 2*(100,103)-(100,101)+(0,1) = (100,106)
    expect(ps.pos[1]).toEqual({ x: 100, y: 106 })
  })
  it('constraint pulls two particles to rest length', () => {
    const ps = new ParticleSystem()
    ps.timeStep = 1; ps.gravity = 0; ps.vDamping = 1; ps.eDamping = 1
    ps.createPart(vector2(0, 0), vector2(0, 0), 1, 1)
    ps.createPart(vector2(10, 0), vector2(0, 0), 1, 2)
    ps.makeConstraint(1, 2, 5)
    ps.satisfyConstraints()
    // delta=10, diff=(10-5)/10=0.5 → 양쪽 2.5씩 접근
    expect(ps.pos[1].x).toBeCloseTo(2.5)
    expect(ps.pos[2].x).toBeCloseTo(7.5)
  })
  it('euler step: vel += F/m*dt², pos += vel, vel *= eDamping', () => {
    const ps = new ParticleSystem()
    ps.timeStep = 1; ps.gravity = 1; ps.vDamping = 1; ps.eDamping = 0.99
    ps.createPart(vector2(0, 0), vector2(2, 0), 1, 1)
    ps.doEulerTimeStep()
    expect(ps.pos[1]).toEqual({ x: 2, y: 1 })
    expect(ps.velocity[1].x).toBeCloseTo(2 * 0.99)
    expect(ps.velocity[1].y).toBeCloseTo(1 * 0.99)
  })
})
```

- [ ] **Step 2: FAIL 확인**
- [ ] **Step 3: 구현** — Parts.pas 그대로. 뼈대:

```ts
// src/core/parts.ts ← Parts.pas
import { TVector2, vector2, cloneVec2, vec2Add, vec2Subtract, vec2Scale, vec2Dot } from './vector'

export const NUM_PARTICLES = 560

export interface Constraint { active: boolean; partA: number; partB: number; restLength: number }

export class ParticleSystem {
  active = new Array<boolean>(NUM_PARTICLES + 1).fill(false)
  pos = Array.from({ length: NUM_PARTICLES + 1 }, () => vector2(0, 0))
  velocity = Array.from({ length: NUM_PARTICLES + 1 }, () => vector2(0, 0))
  oldPos = Array.from({ length: NUM_PARTICLES + 1 }, () => vector2(0, 0))
  forces = Array.from({ length: NUM_PARTICLES + 1 }, () => vector2(0, 0))
  oneOverMass = new Array<number>(NUM_PARTICLES + 1).fill(0)
  timeStep = 0; gravity = 0; vDamping = 0; eDamping = 0
  constraintCount = 0; partCount = 0
  constraints: Constraint[] = Array.from({ length: NUM_PARTICLES + 1 }, () => ({ active: false, partA: 0, partB: 0, restLength: 0 }))

  doVerletTimeStep(): void { /* Parts.pas:74-84 */ }
  doVerletTimeStepFor(i: number, j: number): void { /* 86-90 */ }
  doEulerTimeStep(): void { /* 97-104 */ }
  doEulerTimeStepFor(i: number): void { /* 92-95 */ }
  private euler(i: number): void { /* 106-124 */ }
  private verlet(i: number): void { /* 126-147 */ }
  satisfyConstraints(): void { /* 149-176 */ }
  private satisfyConstraintsFor(i: number): void { /* 178-201 */ }
  createPart(start: TVector2, vel: TVector2, mass: number, num: number): void { /* 203-212 */ }
  makeConstraint(pa: number, pb: number, rest: number): void { /* 214-224 */ }
  clone(other: ParticleSystem): void { /* 226-251, 깊은복사 주의 */ }
  loadPOObject(lines: string[], scale: number): void { /* 253-끝: PO 텍스트 파싱. PhysFS 대신 문자열 배열 입력 */ }
  stopAllParts(): void
  destroy(): void
}
```

각 메서드 본문은 Parts.pas 해당 라인 그대로 (예: `verlet`: `pos = pos*(1+vDamping) - oldPos*vDamping + F*(1/m)*dt²`; forces는 매 스텝 gravity 누적 후 0으로 리셋). `loadPOObject`는 파일 IO를 떼고 `lines: string[]`를 받게만 변경 — 파싱 로직은 동일.

- [ ] **Step 4: PASS 확인 후 Commit** — `git commit -m "feat(core): port Parts.pas verlet particle system"`

### Task 5: core/constants.ts + core/state.ts

**Files:** Create: `src/core/constants.ts`, `src/core/state.ts` · 원본: `shared/Constants.pas` (587줄)

- [ ] **Step 1: Constants.pas 전체 번역** — 전부 `export const` (M1에 안 쓰여도 전부. 이후 태스크가 참조). 애니메이션 ID, 폴리곤 타입, 팀 상수, 물리 상수(GRAV 등) 포함.
- [ ] **Step 2: state.ts 작성** — Pascal 전역변수 대응 컨테이너. M1 시점 필요 최소:

```ts
// src/core/state.ts — Pascal 전역변수 컨테이너 (Game.pas/Client.pas 전역 대응)
import { TPolyMap } from './polymap'
import { TSprite } from './sprites'
import { TAnimation } from './anims'

export interface GameState {
  map: TPolyMap
  sprite: TSprite[]          // [1..MAX_SPRITES]
  spriteMapColCount: number  // 원본 전역 카운터들 발견 시 여기 추가
  ticks: number
}
export function createGameState(): GameState { /* 초기화 */ }
```

(원본에서 전역을 만나면 이 컨테이너에 필드 추가 — 흩어진 모듈 전역 금지. 시뮬 인스턴스를 여러 개(서버/클라) 못 띄우는 원인이 됨.)

- [ ] **Step 3: 타입체크** — `npx tsc --noEmit` PASS
- [ ] **Step 4: Commit** — `git commit -m "feat(core): constants + game state container"`

### Task 6: core/mapfile.ts (PMS 바이너리 파서)

**Files:** Create: `src/core/mapfile.ts`, `src/tests/mapfile.test.ts` · 원본: `shared/MapFile.pas` (462줄)

- [ ] **Step 1: MapFile.pas 전체 읽기** — 레코드 정의(TMapFile/TMapVertex/TMapPolygon/TMapProp 등, 1~90행)와 `LoadMapFile`(271~450행)의 읽기 순서가 곧 바이너리 포맷 명세.
- [ ] **Step 2: 실패 테스트** (골든 테스트: 첫 성공 파싱값을 스냅샷으로 고정하되, 구조 불변식은 하드코딩)

```ts
// src/tests/mapfile.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { loadMapFile } from '../core/mapfile'

const buf = readFileSync('/Users/hytae/Downloads/soldat-ref/base/shared/maps/ctf_Ash.pms')

describe('PMS parser', () => {
  it('parses ctf_Ash', () => {
    const map = loadMapFile(new Uint8Array(buf).buffer)
    expect(map.polygonCount).toBeGreaterThan(0)
    expect(map.spawnpoints.some(s => s.active)).toBe(true)
    // 모든 폴리곤 정점이 유한값
    for (let i = 1; i <= map.polygonCount; i++)
      for (const v of map.polygons[i].vertices) {
        expect(Number.isFinite(v.x)).toBe(true)
        expect(Number.isFinite(v.y)).toBe(true)
      }
    expect(map.mapInfo?.mapName ?? 'ok').toBeTruthy()
  })
  it('parses all 99 maps without throwing', async () => {
    const { readdirSync } = await import('node:fs')
    const dir = '/Users/hytae/Downloads/soldat-ref/base/shared/maps'
    for (const f of readdirSync(dir).filter(f => f.endsWith('.pms'))) {
      const b = readFileSync(`${dir}/${f}`)
      expect(() => loadMapFile(new Uint8Array(b).buffer)).not.toThrow()
    }
  })
})
```

- [ ] **Step 3: 구현** — `DataView` 기반 리더(readUint8/16/int32/single/string — MapFile.pas 185~257행의 BufferRead 계열 대응, little-endian, `ReadString`은 length-prefixed + 고정폭 skip 주의)로 `LoadMapFile` 읽기 순서 그대로. 반환 타입 `TMapFile`은 원본 레코드 필드 그대로.
- [ ] **Step 4: 99맵 전부 PASS 확인 후 Commit** — `git commit -m "feat(core): PMS map file parser (99 original maps)"`

### Task 7: core/polymap.ts (충돌 지오메트리)

**Files:** Create: `src/core/polymap.ts`, `src/tests/polymap.test.ts` · 원본: `shared/PolyMap.pas` (749줄)

- [ ] **Step 1: 실패 테스트**

```ts
// src/tests/polymap.test.ts
import { describe, it, expect } from 'vitest'
import { TPolyMap } from '../core/polymap'
import { vector2 } from '../core/vector'
import { readFileSync } from 'node:fs'
import { loadMapFile } from '../core/mapfile'

describe('TPolyMap', () => {
  it('pointInPoly: unit triangle', () => {
    const pm = new TPolyMap()
    // 수동 폴리곤 구성: (0,0),(10,0),(0,10)
    const poly = pm.makeTestPolygon([[0, 0], [10, 0], [0, 10]])
    expect(pm.pointInPoly(vector2(2, 2), poly)).toBe(true)
    expect(pm.pointInPoly(vector2(9, 9), poly)).toBe(false)
  })
  it('rayCast on ctf_Ash: 맵 상단→하단 세로 레이는 지형에 막힘', () => {
    const pm = new TPolyMap()
    pm.loadData(loadMapFile(new Uint8Array(readFileSync('/Users/hytae/Downloads/soldat-ref/base/shared/maps/ctf_Ash.pms')).buffer))
    const dist = { value: 0 }
    const hit = pm.rayCast(vector2(0, -1000), vector2(0, 1000), dist, 2001)
    expect(hit).toBe(true)
  })
})
```

(`makeTestPolygon`은 테스트 편의용 헬퍼로 polymap.ts에 추가 허용 — 원본 TMapPolygon 구조를 만들어주는 것뿐. rayCast 시그니처의 `var Distance`는 `{value}` 레퍼런스 객체로 번역.)

- [ ] **Step 2: 구현** — PolyMap.pas의 `Initialize/LoadData/LineInPoly/PointInPolyEdges/PointInPoly/ClosestPerpendicular/CollisionTest/CollisionTestExcept/RayCast/CheckOutOfBounds` 전체 번역. LoadData(162~257행)는 TMapFile → 내부 배열 구축 + 섹터 그리드(공간분할) 생성 포함.
- [ ] **Step 3: PASS 후 Commit** — `git commit -m "feat(core): port PolyMap collision geometry"`

### Task 8: core/anims.ts (.poa 스켈레톤 애니메이션)

**Files:** Create: `src/core/anims.ts`, `src/tests/anims.test.ts` · 원본: `shared/Anims.pas` (403줄)

- [ ] **Step 1: 실패 테스트**

```ts
// src/tests/anims.test.ts
import { describe, it, expect } from 'vitest'
import { TAnimation, loadAnimObjects, animations } from '../core/anims'
import { readFileSync } from 'node:fs'

const read = (f: string) => readFileSync(`/Users/hytae/Downloads/soldat-ref/base/shared/anims/${f}`, 'latin1').split(/\r?\n/)

describe('anims', () => {
  it('loads stoi.poa (Stand)', () => {
    const a = new TAnimation()
    a.loadFromFile(read('stoi.poa'))
    expect(a.numFrames).toBeGreaterThan(0)
    expect(a.frames[1].positions[1]).toBeDefined()
  })
  it('loadAnimObjects registers full set with correct speed/loop flags', () => {
    loadAnimObjects(read)   // 파일명→lines 콜백 주입
    expect(animations.stand.loop).toBe(true)
    expect(animations.run.numFrames).toBeGreaterThan(1)
  })
})
```

- [ ] **Step 2: 구현** — `TAnimation.loadFromFile`(70~126행: NEXTFRAME/POINT 라인 파서), `doAnimation`(55~68행: currFrame 진행/루프), `loadAnimObjects`(147행~: **모든 애니메이션 40여 개**를 원본과 동일한 파일명·speed·looped 값으로 등록 — 하나도 빠뜨리지 말 것, M2 전투 애니도 이때 다 등록). 파일 IO는 `read(filename)→string[]` 콜백 주입.
- [ ] **Step 3: PASS 후 Commit** — `git commit -m "feat(core): port skeleton animations (.poa loader + registry)"`

### Task 9: core/sprites.ts — 1부: 구조·스폰·충돌

**Files:** Create: `src/core/sprites.ts`, `src/tests/sprites.test.ts` · 원본: `shared/mechanics/Sprites.pas`

M1 번역 범위(전투 제외): TSprite 필드 전체(스텁 포함), `CreateSprite`(240~), `TSprite.Update` 중 이동·스켈레톤 부분(438~, 무기/피해 블록은 `// TODO(M2)` 스텁), `LegsApplyAnimation/BodyApplyAnimation`(2395~2434), `MoveSkeleton`(2435~), `CheckRadiusMapCollision/CheckMapCollision/CheckMapVerticesCollision/CheckSkeletonMapCollision`(2462~3020), `HandleSpecialPolyTypes` 중 DEADLY/BOUNCY 등 이동 관련(3021~), `FreeControls`(3378), `CheckOutOfBounds`(3399), `Respawn`(3455~, 무기 지급 부분 스텁), `ResetSpriteOldPos`, `GetMoveacc`, `GetCursorAimDirection/GetHandsAimDirection`.

- [ ] **Step 1: 실패 테스트** — 스폰+낙하 통합 테스트:

```ts
// src/tests/sprites.test.ts
import { describe, it, expect } from 'vitest'
// createSprite로 ctf_Ash에 스폰 → 60틱 update → 스폰 초기 위치에서 이탈(중력 낙하 or 지면 안착) & NaN 없음
// + CheckMapCollision: 지면 폴리곤 위 좌표에서 true
```

(구체 코드는 state.ts/anims/polymap 초기화 헬퍼 `setupTestGame()`을 이 태스크에서 만들어 사용: 맵 로드 + loadAnimObjects + gostek.po 스켈레톤 생성까지 한번에.)

- [ ] **Step 2: 구현** — 위 범위 그대로 번역. Skeleton은 `ParticleSystem` + `loadPOObject(gostek.po, 4.5)` (원본 CreateSprite 참조 — scale 값은 원본에서 확인). `{$IFDEF SERVER}` 분기는 규약 6.
- [ ] **Step 3: PASS 후 Commit** — `git commit -m "feat(core): TSprite structure, spawn, map collision (movement subset)"`

### Task 10: core/control.ts (입력→움직임 상태머신)

**Files:** Create: `src/core/control.ts`, `src/tests/control.test.ts` · 원본: `shared/mechanics/Control.pas` (2159줄)

- [ ] **Step 1: TControl 타입 + ControlSprite 전체 번역** — `ControlSprite`(68행~끝)가 M1의 심장: 키 상태 → 달리기/점프/웅크리기/프론/롤/제트팩 → 애니메이션 적용 + 힘 적용. `CheckSpriteLineOfSightVisibility`(36~), `AreConflictingKeysPressed`(61~) 포함. 봇/멀티 분기(`Sprite.Player.ControlMethod`)는 HUMAN 경로만 살리고 나머지 스텁.
- [ ] **Step 2: 테스트** — 시나리오 단위:

```ts
// 오른쪽 키 60틱 → position.x 증가, legsAnimation이 run 계열
// 점프 키 → 위로 속도 발생 후 착지
// 제트팩 키 → jetsCount 감소 & y속도 상승
// 정지 → stand 애니로 복귀
```

(정확한 수치 비교가 아니라 방향·상태 불변식 검증. 수치 일치는 Task 12 원본 대조에서.)

- [ ] **Step 3: PASS 후 Commit** — `git commit -m "feat(core): port ControlSprite movement state machine"`

### Task 11: core/sprites.ts — 2부: Update 본체 + 60Hz 틱 루프

**Files:** Modify: `src/core/sprites.ts` · Create: `src/core/game.ts`(M1 부분), `src/tests/game.test.ts` · 원본: `Sprites.pas:438~1423`, `client/UpdateFrame.pas:31~90`

- [ ] **Step 1: TSprite.Update 이동 부분 완성** — 스켈레톤 DoVerletTimeStep, OnGround 판정, 애니메이션 프레임 진행(DoAnimation), 방향 전환, 특수 폴리(HandleSpecialPolyTypes) 호출 등 — Update의 전투·무기 블록은 TODO(M2) 스텁 유지.
- [ ] **Step 2: game.ts에 M1 틱 함수** — UpdateFrame.pas의 순서 그대로: sprites → (bullets 스텁) → things 스텁 → ticks++. 60Hz 고정.

```ts
export function updateFrame(st: GameState): void {
  for (let j = 1; j <= MAX_SPRITES; j++)
    if (st.sprite[j].active) st.sprite[j].update(st)
  st.ticks++
}
```

- [ ] **Step 3: 통합 테스트** — 스폰→오른쪽 이동 120틱→점프→착지 시나리오에서 NaN 없음 + 최종 위치가 스폰 오른쪽.
- [ ] **Step 4: Commit** — `git commit -m "feat(core): sprite update loop + 60Hz tick (movement complete)"`

### Task 12: web/ 렌더러 + 입력 + 데모 (M1 완성)

**Files:** Create: `src/web/main.ts`(교체), `src/web/assets.ts`, `src/web/maprender.ts`, `src/web/gostek.ts`, `src/web/input.ts`, `src/web/camera.ts` · 참조: `client/MapGraphics.pas`(맵 렌더 방식), `client/GostekGraphics.pas`(파츠→스켈레톤 매핑 테이블)

- [ ] **Step 1: assets.ts** — manifest.json 로드 + PIXI.Assets로 텍스처 로딩 + .poa/.po/.pms fetch 헬퍼
- [ ] **Step 2: maprender.ts** — TMapFile 폴리곤을 PIXI.Mesh(텍스처+정점색)로: 폴리곤 3정점 각각 (x,y,u,v,rgba) → 단일 Geometry 배치. 배경 그라디언트(맵 bgColorTop/Btm) + scenery props(레벨0만: 이미지 스프라이트 배치·회전·스케일 — TMapProp 필드 그대로)
- [ ] **Step 3: gostek.ts** — GostekGraphics.pas의 파츠 테이블(어느 gostek-gfx 이미지가 스켈레톤 파티클 몇→몇 사이에 어떤 flex로 붙는지)을 데이터로 옮기고, 매 프레임 파티클 위치로 스프라이트 position/rotation 갱신. M1은 기본 몸통 세트(다리/몸/머리/팔)면 충분 — 무기 파츠는 M2.
- [ ] **Step 4: input.ts** — A/D 좌우, W 점프, S 웅크림, X 프론, 마우스=조준(GetCursorAimDirection용 world 좌표), Shift 등 원본 기본 바인딩(`base/client/configs/controls.cfg` 참조) → TControl 필드 세팅
- [ ] **Step 5: main.ts** — 로딩(에셋→맵→애님→스폰) → `requestAnimationFrame` + 60Hz 고정 스텝 누산기 → updateFrame → 렌더 갱신 → camera follow
- [ ] **Step 6: 브라우저 검증** — `npm run dev` → localhost:3024: ctf_Ash 지형 보임, 군인 스폰, 달리기·점프·제트팩·프론·롤 동작, 콘솔 에러 0. 프리뷰 도구로 스크린샷.
- [ ] **Step 7: Commit** — `git commit -m "feat(web): pixi map+gostek renderer, input, 60Hz loop — M1 playable"`

### Task 13: 원본 대조 검증

**Files:** Create: `docs/m1-parity-checklist.md`

- [ ] **Step 1: 원본 실행** — `cd ~/Downloads/soldat-ref/opensoldat/build/bin && ./opensoldatserver & ./opensoldat -join 127.0.0.1 23073` (ctf_Ash)
- [ ] **Step 2: 나란히 대조 후 체크리스트 기록** — 항목: 달리기 가속/최고속, 점프 높이·타이밍, 제트팩 추력·연료 소모·회복, 프론/롤 거리, 경사면 미끄러짐, 벽 충돌 반응, 낙하 가속. 각 항목 ✅/❌ + 차이 시 원인 파일 기록
- [ ] **Step 3: 불일치 수정** — 차이는 항상 번역 버그(상수 누락/순서 뒤바뀜/1-off). 원본 diff로 찾아 수정. **임의 튜닝 금지.**
- [ ] **Step 4: Commit** — `git commit -m "docs: M1 parity checklist vs original build"`

---

## Self-Review 결과

- 스펙 M1 완료 기준("원본 맵에서 달리기·점프·제트팩·프론·롤이 원본과 느낌 일치") ← Task 13이 직접 검증. 커버.
- 에셋 매니페스트 모딩(스펙 4.4) ← Task 1. PMS 직접 파싱(스펙) ← Task 6. 커버.
- 알려진 리스크: jimp API 버전(Task 1에 주의 명시), gostek.po 위치(Task 1에 탐색 지시), GostekGraphics 파츠 테이블 분량(Task 12 — M1은 기본 몸통 세트로 한정 명시).
- M2~M4는 별도 계획서 (M1 완료 후 작성).
