// src/net/respawn-boost.ts — 리워드 광고 "리스폰 부스트" 공유 상수.
// 광고 1회 시청 → BOOST_CHARGES회 충전. 부스트가 남은 동안 죽으면 리스폰 대기가
// BOOST_DIVISOR배 빨라지고(= 절반) 1회 차감된다. 넷(host/client)·웹(main/hud) 공용.
export const BOOST_CHARGES = 5 // 광고 1회 → 리스폰 부스트 충전 횟수
export const BOOST_DIVISOR = 2 // 리스폰 대기 나눗수(2 = 절반 = 2배 빠름)
export const BOOST_MIN_WAIT_TICKS = 240 // 방 리스폰 대기가 4초(240틱) 미만이면 부스트 무의미 → 버튼 미노출
