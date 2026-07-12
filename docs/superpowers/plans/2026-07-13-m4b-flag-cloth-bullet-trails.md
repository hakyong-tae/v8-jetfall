# M4-B: 깃발 천 시뮬 렌더 + 탄환 트레일 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** M2-T13에서 단순화했던 두 렌더를 원본 충실도로 교체 — ① 깃발: 단일 틴트 스프라이트 → 스켈레톤 4점 위 2폴리곤 천(코어 Verlet이 이미 천 시뮬 중, 렌더만 못 따라감) ② 탄환: 회전 스프라이트 → 원본 트레일(OldPos 기반 스트레치+페이드).

**Architecture:** `src/web/bulletsrender.ts`만 수정(+필요시 assets 텍스처 로드 추가). 원본이 스펙: `shared/mechanics/Things.pas`의 `PolygonsRender`(깃발/낙하산 폴리곤 렌더, {$IFNDEF SERVER} 블록)와 `shared/mechanics/Bullets.pas` `TBullet.Render`(740-1058, Trails=1 경로). **코어/넷 무수정.**

**핵심 사실:**
- 깃발 Thing의 skeleton pos[1..4]는 코어가 이미 매 틱 Verlet로 굴리는 진짜 천 물리 — 원본은 이 4점을 (1-2-4, 1-3-4 식) 삼각형 2개로 텍스처 매핑해 그린다. PIXI Mesh(4버텍스/2트라이) 퍼프레임 버텍스 갱신으로 동일 구현. 팀 틴트는 유지(알파 빨강/브라보 파랑 — 현행 규칙).
- 탄환 트레일: 원본 Render는 `BulletParts.OldPos[Num]`↔`Pos[Num]` 구간을 스타일별로 그린다(플레인탄 = 총알 텍스처를 진행방향으로 스트레치+뒤로 갈수록 페이드, 수류탄/기타는 스타일별 분기). Trails=1 케이스들을 스타일별로 발췌 이식(전 스타일 완벽 커버가 목표가 아니라 플레인계+수류탄+로켓류 우선, 나머지는 현행 회전 스프라이트 유지+주석).

## Tasks
1. **원본 렌더 정독**: Things.pas PolygonsRender 구현부(깃발 4점→삼각형 매핑 좌표/UV 정확히), Bullets.pas Render 740-1058(스타일별 트레일 수식 — _p1/_p2 좌표, 페이드 알파, 텍스처 선택). 발췌 수식을 코드 주석에 원본 라인과 함께 기록.
2. **깃발 천 렌더**: bulletsrender.ts things 풀에서 깃발 스타일(OBJECT_ALPHA/BRAVO_FLAG)만 Sprite 대신 전용 FlagMesh(4vert/2tri, textures/objects/flag 텍스처, 팀 틴트)로 교체. 매 프레임 skeleton pos[1..4] → 버텍스. 비깃발 Thing은 현행 유지.
3. **탄환 트레일**: 플레인계(EAGLE/MP5/AK/스테이어/미니미/미니건/콜트 등 BULLET_STYLE_PLAIN)에 원본 스트레치 트레일, 수류탄(작은 회전 스프라이트+미세 트레일), M79/LAW/화살류는 원본 분기 확인 후 합리적 발췌. OldPos는 gs.bulletParts.oldPos 직접 사용.
4. **검증**: tsc clean·290테스트 그린·vite build. 브라우저: CTF 봇전에서 깃발이 출렁이는 천으로 보임(캐리 중 병사에 끌려 나부낌), 사격 시 탄에 트레일. 스크린샷. `?wshost` 회귀 무결.
5. 커밋: `feat(web): flag cloth mesh + faithful bullet trails (M4-B polish)`.
