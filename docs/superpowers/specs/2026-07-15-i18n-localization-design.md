# UI 다국어(i18n) — 설계

## 배경
게임 UI 문구가 각 웹 모듈에 영어로 하드코딩돼 있다. 영어를 기본으로 두고 한국어/중국어(간체)/
스페인어/포르투갈어를 추가한다.

## 스코프
**번역 대상 (UI chrome):**
- 메인 메뉴: Play Online / Offline Bots / Settings / Credits
- 타이틀: PRESS ANY KEY, 태그라인(2D JETPACK COMBAT)
- Offline Bots 화면: OFFLINE BOTS 헤더, MAP 라벨, Random, Deathmatch/Capture the Flag 토글,
  Start Match, Back
- Settings: SFX Volume, Mute, + 새 Language 라벨
- Credits: 화면 제목(라이선스 본문 라인은 원문 유지 — 법적 텍스트)
- 로비/룸: Ready, Deathmatch/Capture the Flag 제목, 관련 라벨
- HUD 스코어보드 헤더: Name / Team / Kills / Deaths / Caps
- HUD 상단: "Kills X / Y"(DM), 팀스코어 라인은 Alpha/Bravo 유지
- 무기창(림보): Primary / Secondary / "Click to equip — Q toggle, Esc close"
- ESC 메뉴: Paused / Menu / Resume / Leave to Menu

**원문 유지 (고유명사·데이터):**
- 게임명 `V8 JETFALL`(브랜드), 무기명(Ak-74 등, weapons.json 데이터), 맵명(ctf_ash 등),
  팀명 Alpha/Bravo(Soldat 고유명사), 크레딧 라이선스 라인(법적 문구).

## 아키텍처
- 새 파일 `src/web/i18n.ts`:
  - `Lang` 타입 = `'en' | 'ko' | 'zh' | 'es' | 'pt'`.
  - `STRINGS: Record<Lang, Record<StringKey, string>>` — en을 기준 키셋으로, 각 언어가 동일 키를
    모두 채운다(누락 시 en 폴백). 키는 `menu.playOnline` 식 네임스페이스.
  - `t(key)` 조회 함수 + 현재 언어 상태(모듈 전역). `setLang(lang)`이 언어 변경 + 저장 + 구독자
    통지(간단한 리스너 배열). `getLang()`.
  - 초기 언어 결정: localStorage(`jetfall.settings.v1`에 lang 필드 추가) → 없으면
    `navigator.language` 접두(ko/zh/es/pt)로 자동감지 → 그 외 en.
- `settings.ts`: `GameSettings`에 `lang: Lang` 추가(기본 자동감지). 기존 저장 포맷 하위호환
  (lang 없으면 자동감지 주입).
- Settings 화면(lobby-ui.ts): SFX Volume/Mute 아래에 Language `<select>` 추가. 변경 시
  `setLang` + 화면 즉시 재렌더(현재 Settings 화면이 새 언어로 다시 그려짐).
- 각 UI 모듈(lobby-ui.ts, hud.ts, loadout-menu.ts, main.ts, brand.ts 태그라인/크레딧 제목)의
  하드코딩 문자열을 `t('...')`로 치환.
  - HUD/무기창은 PIXI/DOM 텍스트를 언어 변경 시 갱신해야 하나, 언어 변경은 인게임이 아니라
    메뉴(Settings)에서만 가능하므로 매치 시작 시점의 언어로 렌더하면 충분(인게임 실시간 전환
    미지원 — 스코프 최소화). 다음 매치/화면부터 반영.

## 검증
- 단위테스트(`src/tests/i18n.test.ts`): 모든 언어가 en과 동일한 키셋을 빠짐없이 보유(키 누락
  가드), 폴백 동작, navigator 자동감지 매핑, setLang 저장/조회.
- 브라우저 눈검증: Settings에서 각 언어 선택 → 메뉴/버튼/스코어보드/무기창 라벨이 해당 언어로
  표시, 새로고침 후 언어 유지, 고유명사(무기명/맵명/게임명) 원문 유지.
- 게이트: tsc clean, 전체 테스트 green, vite build OK, 코어(src/core) 무수정.

## 번역 원칙
- 게임 UI 톤에 맞춘 간결한 번역(장황한 문장 금지). 버튼은 짧게.
- 중국어=간체(zh-CN). 스페인/포르투갈은 중립(특정 지역 속어 회피).
