# M3 네트워크 체크리스트 (A~E)

작성: 2026-07-12 — 자동 검증 완료분(loopback/유닛) + 실배포 수동 확인 대기분.
배포 절차는 [`DEPLOY-VERSE8.md`](./DEPLOY-VERSE8.md) 참조.

## ✅ 자동 검증 완료 (loopback / 유닛 — 배포·SDK 없이)

| 항목 | 근거 |
|---|---|
| 로비 상태머신 (룸생성/입장/팀/Ready/Start) | lobby-client.test.ts (M3-A) |
| 호스트권위 이동 동기화 (3초 수렴, NaN 0) | net-b-integration.test.ts (M3-B) |
| 전투/탄환/킬피드 diff 브로드캐스트 | net-c-integration.test.ts (M3-C) |
| CTF 깃발 캡처 스코어 전파 (팬텀 0) | net-c-ctf-integration.test.ts (M3-C) |
| 전용 Node 호스트 헤드리스 부팅+틱 | host-boot.test.ts (M3-D, 자가빌드 안전망) |
| **호스트 마이그레이션** (loopback 3자, B 승격, C 지속, NaN 0) | host-migration-integration.test.ts (M3-E) |
| **선출/판단 순수함수** (electHost 4케이스 + decideMigration 4케이스) | host-migration.test.ts (M3-E) |
| **knownSlots 전원기록 + lastSnapshotAt 가짜시계** | host-migration.test.ts (M3-E) |
| **재접속 백오프** (첫성공 / 재시도후성공 / 포기 3분기) | reconnect.test.ts (M3-E) |
| **Session seam** (host-authoritative 어댑터 + peer 스텁, 타입+행위) | session-seam.test.ts (M3-E) |
| `--public-url` 파싱 + own-ws 정직 로깅 | node-transport.test.ts + 코드리뷰 (M3-E) |
| **`npm test` 클린 클론 그린** (285/285) | pretest 자가빌드(beforeAll) — `rm -rf dist-server && npm test` |
| tsc clean · `vite build` OK (server/* 브라우저 번들 제외) | CI |

## 👀 수동 확인 필요 (실 agent8 배포 후, 2인 이상)

- [ ] 실 agent8 룸 생성/입장/매치 시작 (배포 §1~2)
- [ ] **호스트 탭을 실제로 닫아 자동승격 체감** — 남은 참가자에서 위치/체력/스코어가
      순간이동 없이 이어지는지, 콘솔 `[net] promoting to host`
- [ ] 네트워크 오프라인 토글로 **재접속 체감** — 복구 시 스냅샷 이어받기 / 실패 시 봇전 폴백
- [ ] 되살아난 옛 호스트가 강등되는지 (`[net] demoted`) — 스플릿브레인 육안 확인
- [ ] 8인 스냅샷 실측 대역폭 (스펙 §8-리스크2, ≈9KB/s 예측)
- [ ] Cloudflare 터널로 외부인 접속 (배포 §3, Plan-B 수동 dedicatedHostUrl)
- [ ] CTF 8인 풀매치 → 로비 복귀
- [ ] 킬피드/스코어보드 지연 체감

## 알려진 편차 / M4+ 이월

1. **로컬 예측 = 지수 스무딩** (정밀 rollback 아님) — 스펙 허용범위, M4 후보.
2. **탄환 동틱 생성+소멸 미브로드캐스트** — `diffAndBroadcastBullets()`가 `updateFrame()`
   이후 `.active` 집합만 봐서, 생성과 같은 틱에 즉발충돌 사망하면 `MSG.BULLET`이 안 나간다.
   순수 시각 문제(데미지/스코어는 스냅샷이 진실 → 판정 무관). 고치려면 코어 훅 필요 → **무수정
   원칙 위반이라 defer**.
3. **봇+사람 혼합 매치 미지원** (`diffAndBroadcastBullets`가 사람 소유자만 추적).
4. **전용 호스트 자동 로스터 구독 미구현** — `--players` 수동 지정.
5. **peer-session 미구현** (Session seam만 확정 — 스펙 §9 YAGNI).
6. **own-ws(Plan-B) 재접속/마이그레이션 스코프 밖** — 그 경로는 "룸=프로세스 1개, 마이그레이션
   없음" 전제. 필요 확인 시 M4+ 후보.
7. **감시 상수는 추정치** (`HOST_TIMEOUT_MS=3000`, `maxAttempts=3`, `backoffMs=1000`) —
   실배포 레이턴시 실측 후 튜닝.
8. **스플릿브레인 경합 통합테스트 없음** — 깨끗한 호스트 죽음만 검증. 좀비호스트 동시 브로드캐스트
   경합 시나리오 전용 테스트는 후속 후보.

## 알려진 갭 (M4 이월)

- **멀티에서 손에 든 무기 미표시**: SNAPSHOT에 `weaponNum` 필드가 없어(BULLET/KILL엔 있음), 클라가 스냅샷으로 지연생성한 원격 병사는 무기 로드아웃이 없어 `weapon.num=0`(빈총)으로 렌더된다. 로컬 데모(?wshost)/실배포 멀티 모두 해당. **해법**: `SnapshotSprite`에 `weaponNum: Uint8` 추가(protocol.ts), host `broadcastSnapshot`이 `spr.weapon.num` 실음, client `applySnapshot`이 원격 병사에 `applyWeaponByNum(weaponNum, 1)` 적용(또는 gostek 렌더가 스냅샷 weaponNum 직접 참조). 싱글/봇전은 무관(로컬에서 respawn이 무기 지급). 코스메틱 — 게임플레이(호스트 권위 데미지)엔 영향 없음.
