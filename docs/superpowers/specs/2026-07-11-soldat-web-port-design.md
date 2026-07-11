# Soldat → Verse8 웹 포팅 설계서

날짜: 2026-07-11 · 상태: 사용자 승인됨 (설계 단계)

## 1. 목표

OpenSoldat(구 Soldat)의 **게임 로직 전체를 그대로** 웹으로 포팅해 Verse8에 멀티플레이 게임으로 런칭한다.
에셋은 원본을 그대로 사용하되, 추후 에셋·맵 교체가 파일 교체만으로 가능하게 한다.

**확정된 스코프 결정:**
- 게임모드: **DM + CTF 먼저** 런칭, 나머지 5개 모드(PM/TM/RM/INF/HTF)는 코어 구조에 자리만 두고 후속
- 멀티: **서버 권위** (원작 방식 — 서버가 물리 시뮬, 클라 예측/보정) + **싱글모드(봇전) 동시 지원**
- 모딩: **매니페스트+폴더 교체** 수준 (원작 .smod 시스템 재현은 안 함)
- 포팅 전략: **A. 충실 포팅** — Pascal 소스를 파일 단위 1:1로 TS 번역 (재해석 금지)

## 2. 라이선스 (검증 완료)

| 구성 | 출처 | 라이선스 | 조건 |
|---|---|---|---|
| 소스코드 | github.com/soldat/soldat (+opensoldat/opensoldat) | MIT (© 2020 Transhuman Design) | 저작권 고지 유지 |
| 에셋 (gfx/sfx/maps/anims) | github.com/opensoldat/base | CC BY-4.0 | **크레딧 표기 의무** |
| 폰트 play-regular.ttf | opensoldat/base | SIL OFL | — |

- 상업적 사용·수익화 합법. 크레딧 화면에 "Based on OpenSoldat by Transhuman Design & contributors (MIT / CC BY 4.0)" 표기.
- ⚠️ **"Soldat" 이름은 Transhuman Design 상표** — Verse8 출시명은 다른 이름 사용 (추후 결정). 로컬 폴더명 soldat-web은 무방.
- ⚠️ base 레포에 커뮤니티 기여 에셋 혼재 가능 → 런칭 전 최종 사용 에셋 목록에 대해 파일별 출처 확인 1회.

## 3. 원본 레퍼런스 환경 (구축 완료)

- `~/Downloads/soldat-ref/` : soldat(원본 소스) + base(에셋) + opensoldat(2024 후속 소스) 클론
- **arm64 네이티브 빌드 성공** → `soldat-ref/opensoldat/build/bin/{opensoldat,opensoldatserver}` — 로컬 플레이 검증 완료
  - 빌드 노하우: FPC 3.2.2 + protobuf@21 (최신 protobuf는 구 GNS와 비호환), `Set8087CW`에 `{$IF DEFINED(CPUI386) OR DEFINED(CPUX86_64)}` 가드, client/server CMakeLists에 `-Fl/opt/homebrew/lib` 추가, `-DBUILD_SCRIPTCORE=False` (pascalscript가 x86 어셈 포함), dylib은 `build/Frameworks/`에 복사
  - 실행: `cd build/bin && ./opensoldatserver &` → `./opensoldat -join 127.0.0.1 23073`
- 용도: 포팅 결과와 나란히 실행하며 움직임·무기 느낌 대조

## 4. 아키텍처

### 4.1 폴더 구조 (CLAUDE.md Vite 표준, 포트 3024)

```
soldat-web/
├── index.html / vite.config.js / package.json / .gitignore
├── src/
│   ├── core/          ← Pascal 1:1 포팅. 순수 로직, DOM/PixiJS 의존 0
│   │   ├── vector.ts calc.ts constants.ts    ← Vector/Calc/Constants.pas
│   │   ├── parts.ts                          ← Parts.pas (Verlet/Euler 파티클+제약 물리)
│   │   ├── polymap.ts                        ← PolyMap.pas (폴리곤 충돌)
│   │   ├── mapfile.ts                        ← MapFile.pas (PMS 바이너리 파서)
│   │   ├── anims.ts                          ← Anims.pas + .poa 로더 (스켈레톤 포즈)
│   │   ├── weapons.ts                        ← Weapons.pas (무기 14종 데이터+로직)
│   │   ├── control.ts                        ← Control.pas (입력→움직임 상태머신)
│   │   ├── sprites.ts                        ← mechanics/Sprites.pas (군인 본체)
│   │   ├── bullets.ts                        ← mechanics/Bullets.pas (탄도·판정)
│   │   ├── things.ts                         ← mechanics/Things.pas (깃발·아이템·무기드롭)
│   │   ├── sparks.ts                         ← mechanics/Sparks.pas (게임플레이 파티클)
│   │   ├── game.ts                           ← Game.pas (틱 루프·모드 룰: DM/CTF 구현, 나머지 스텁)
│   │   ├── ai.ts waypoints.ts                ← AI.pas/Waypoints.pas (봇)
│   │   └── state.ts                          ← 시뮬 전역 상태 컨테이너 (Pascal 전역변수 대응)
│   ├── web/           ← 브라우저 전용: PixiJS 렌더러, WebAudio, 키/마우스 입력, HUD, 메뉴
│   ├── net/           ← Verse8 gameserver 클라이언트 (입력 송신, 스냅샷 수신/보간/예측)
│   └── server/        ← gameserver 배포용 서버 시뮬 엔트리 (core/ 재사용)
├── tools/             ← Node 스크립트: 에셋 파이프라인
└── public/assets/     ← 변환된 에셋 + manifest.json + maps/*.pms
```

### 4.2 포팅 규율 (느낌 보존의 핵심)

- 파일·함수·상수를 원본과 같은 이름(카멜케이스 변환)으로 유지, 주석에 원본 소스 위치 표기하지 않음 (파일 대응이 이미 1:1)
- **1-based 배열 유지**: Pascal `array[1..N]`은 길이 N+1 배열로 잡고 인덱스 0 미사용 → off-by-one 번역 실수 원천 차단
- **record 값 복사 주의**: Pascal record 대입은 깊은 복사 → TS에선 명시적 clone
- 고정 틱 60Hz, 원본 MainLoop의 업데이트 순서 그대로
- Pascal `Single`(f32) vs JS f64: 서버 권위 구조라 크로스엔진 결정론 불요 → 기본 f64로 가되, 느낌 차이 감지 시 해당 경로에 `Math.fround` 적용 (알려진 리스크로 관리)
- `Random`: 원본과 동일 분포면 충분 (시드 일치 불요)

### 4.3 네트워크 (M3)

- Verse8 gameserver SDK (Kart Rush 패턴): 서버가 core/ 시뮬을 60Hz로 실행
- 클라 → 서버: 입력 비트필드 (원작 TMsg_ClientSpritePos 대응)
- 서버 → 클라: 스냅샷 (스프라이트 위치/속도/상태, 탄환 스폰 이벤트)
- 클라: 자기 캐릭터 예측 + 서버 보정, 타 캐릭터 보간 — 원작 netcode 구조 준수
- 싱글모드: net/ 대신 core/를 브라우저에서 직접 구동 (같은 인터페이스)

### 4.4 에셋 파이프라인 (tools/)

1. `soldat-ref/base/`에서 에셋 수집 (git 원본이 곧 .smod 내용물)
2. BMP 그린 컬러키(0,255,0) → 알파 PNG 변환, PNG는 그대로 복사
3. weapons.ini / mod.ini → JSON 변환
4. `manifest.json` 생성: 모든 에셋 경로·무기데이터·맵 목록을 간접 참조
5. 게임 코드는 manifest만 읽음 → **폴더/manifest 교체 = 리스킨 완성**
- 맵: PMS 바이너리를 브라우저에서 직접 파싱 (mapfile.ts) → 원본 맵 99개 그대로 사용, 커스텀 맵은 .pms 추가
- 사운드: WAV 그대로 (WebAudio 디코딩 가능), 필요시 후속으로 ogg 변환

## 5. 마일스톤

| 마일스톤 | 내용 | 완료 기준 |
|---|---|---|
| **M1 이동물리** | vector/calc/parts/polymap/mapfile/anims/control/sprites 포팅 + PixiJS 맵 렌더 + 기본 gostek 렌더 | 원본 맵에서 달리기·점프·제트팩·프론·롤이 원본과 느낌 일치 (나란히 대조) |
| **M2 전투+봇 = 싱글 완성** | weapons/bullets/things/sparks/game(DM·CTF)/ai 포팅 + HUD·사운드 | 봇 상대 DM/CTF 한 판이 온전히 돌아감 |
| **M3 멀티** | gameserver 서버권위 + 클라 예측/보간 | 2인 이상 실제 대전 |
| **M4 런칭** | 메뉴·설정·크레딧(CC BY)·게임명 결정·Verse8 업로드 | verse8.io 페이지 라이브 |

## 6. 검증 전략

- 각 core 모듈: 원본 Pascal을 기준으로 한 수치 스냅샷 테스트 (예: 같은 초기조건에서 N틱 후 위치/속도)
- M1/M2: 원본(arm64 빌드)과 나란히 실행하는 수동 느낌 대조
- 브라우저 검증: Vite dev 서버 + 프리뷰 도구로 콘솔에러·렌더 확인

## 7. Verse8 업로드 원칙

- 이 프로젝트는 전체가 오픈소스 기반 합법 재배포 (Freedoom 케이스와 동일 부류) → 코드+에셋 모두 업로드 가능
- 단, gitlab.verse8.io 업로드 시 LICENSE/CREDITS 파일 포함 필수
- PROJECT/*.md (Verse8 AI 컨텍스트 문서) 작성은 M4에서
