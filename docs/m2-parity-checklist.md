# M2 전투 원본 대조 체크리스트 (ctf_Ash)

작성: 2026-07-12 · M2(전투+봇) 완료 시점

## 실행

```bash
# 원본 (터미널)
cd ~/Downloads/soldat-ref/opensoldat/build/bin && ./opensoldatserver &
./opensoldat -join 127.0.0.1 23073   # 팀선택 1(Alpha) → 무기 3(AK-74)

# 웹 포트 (브라우저)
cd ~/Downloads/soldat-web && npm run assets && npm run dev
#   DM:  http://localhost:3024
#   CTF: http://localhost:3024/?mode=ctf
```
> ⚠️ `public/assets/`는 gitignore라 clone 후 반드시 `npm run assets` 먼저 (sfx 164개 포함 생성).

## ✅ 자동 검증 완료 (헤드리스 + 브라우저 측정)

| 항목 | 결과 | 근거 |
|---|---|---|
| 무기 20종 데이터 | weapons.ini 886개 대입값 원본 일치 | weapons.test + 리뷰 |
| 5종 데미지 공식 | EAGLE 28.5 / BOW 20 / M79 30 / FLAME 2 / KNIFE 0.5 / FRAG@50 29.4 | bullets.test 손계산 |
| 탄도 감쇠 | tick30 ×0.5, tick48 ×0.25 (normative) | bullets.test |
| 봇전 DM 소크 | 4봇 3600틱: 959발·11킬/11데스·리스폰 사이클·NaN 0 | integration.test |
| CTF 소크 | 7200틱: 깃발 무결성(알파1+브라보1 유지)·캡처 시 teamScore+1 | integration.test |
| 킬리밋→맵체인지 | svKilllimit 도달 → mapChangeCounter 무장 → changeMap 리셋 | integration.test |
| 봇 AI | 조준리드 공식·웨이포인트 내비·LOS 사격 원본 일치 | ai.test + 리뷰 |
| 브라우저 DM | 5명 교전, 탄환/HUD(킬수·체력·제트·40/40 탄약) 렌더 | 프리뷰 실측 |
| 브라우저 CTF | gamemode 3, 알파3/브라보2봇, 깃발2개, HUD "Alpha-Bravo" | 프리뷰 실측 |
| 전체 테스트 | 221/221 그린, tsc clean, vite build OK | CI |

## 👀 수동 확인 필요 (원본과 나란히 — 느낌/미세밸런스)

- [ ] 각 무기 발사 간격·반동·정확도(bink) 체감 (AK/Deagle/Barrett/Spas 등)
- [ ] 샷건 펠릿 퍼짐, 미니건/샷건 속도 킥백
- [ ] 수류탄 궤적·폭발 반경·데미지 폴오프
- [ ] 봇 난이도별 반응속도·조준 정확도 (botsDifficulty)
- [ ] 봇 이동 자연스러움 (웨이포인트 따라가기, 낙하 회피)
- [ ] CTF 봇 깃발 운반·귀환 행동
- [ ] 사망 래그돌·피 효과
- [ ] 사운드 밸런스·거리 감쇠 곡선
- [ ] 킬/캡처 시 스코어 갱신 타이밍

## 알려진 편차 / M4 폴리시 이월

1. **깃발** = 단일 텍스처 틴트 (원본은 2폴리곤 천 시뮬 — M4)
2. **탄환 트레일** = 단순 스프라이트 (원본 페이드 트레일 — M4)
3. **스파크** = 스타일 밴드별 단색 quad (전 스타일 텍스처 — M4)
4. **무기 드롭** 콤뱃나이프 = bow gfx 임시 재사용 (전용 인월드 스프라이트 M4)
5. 카메라 게인 0.3 (원본 ~1.02) — M4 튜닝
6. 머리카락/헬멧/등짐 보조무기/수류탄 벨트/부상(ranny) 파트 미표시 — M4
7. RNG 무시드 (Math.random) — 네트리플레이 결정론 M3에서 필요 시 도입
8. INF/HTF/PM/RM/TM 모드 스코어링 구조만(스텁) — DM/CTF만 완성

## M3 예정 (네트워크)
Verse8 gameserver 서버권위 멀티 — 클라 예측/보간. 코어 시뮬이 이미 서버권위 변종으로 포팅돼 있어 net/ 계층만 추가.
