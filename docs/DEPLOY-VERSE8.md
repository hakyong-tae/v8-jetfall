# Soldat Web — Verse8 배포 가이드 (M3-E)

> 세 가지 배포 모드(스펙 §3.1)를 낮은 설정 순서로 정리한다.
> **0번(오프라인)은 지금 zero-setup으로 작동**하고, 1~3번은 실 멀티플레이용이다.
> Node 경로: `~/.nvm/versions/node/v23.11.0/bin/node`

---

## 0. 지금 되는 것 (설정 0 — 오프라인 봇전)

```bash
npm run assets      # public/assets 심볼릭/복사 (최초 1회)
npm run dev         # → http://localhost:3024
```

- agent8 미배포/오프라인이면 로비가 자동으로 **오프라인 봇전으로 폴백**한다(별도 계정·서버 불필요).
- `http://localhost:3024/?nolobby=1` 로 로비를 건너뛰고 곧장 봇전에 진입할 수도 있다.
- 이 경로는 네트워크가 전혀 없어도 항상 동작한다(회귀 안전망).

---

## 1. agent8 활성화 (실 멀티플레이 전제)

```bash
npm install @agent8/gameserver
npx -y @agent8/deploy      # 계정 로그인 흐름을 따라가면 .env에
                           #   VITE_AGENT8_ACCOUNT / VITE_AGENT8_VERSE 가 자동 생성됨(수동편집 불필요)
npm run dev                # 재기동 — 로비가 online 이면 실 룸에 연결
```

- `.env`가 채워지면 `src/net/transport.ts`의 provider가 실 agent8 릴레이에 붙는다.
- 이후 로비에서 룸 생성/입장 → 팀선택 → Ready → 호스트 Start 흐름은 M3-A에서 완성됨.

---

## 2. 브라우저-호스트 (기본 모드 — 설정 0, 권장)

- **첫 입장 탭이 그 룸의 호스트**가 된다(권위 시뮬을 그 브라우저가 돌림). 다른 참가자는 클라.
- **M3-E 자동 자가치유**: 호스트 탭이 사라지면(닫힘/크래시/네트워크 단절), 남은 참가자 중
  `joinedAt`이 가장 이른 계정이 **자동 승격**한다.
  - 승격 계정 콘솔: `[net] promoting to host`
  - 승격은 **위치/체력/스코어 순간이동 없이** 이어진다(이미 각 클라가 미러링해 온 `gs`를 그대로 승계).
  - 되살아난 옛 호스트는 더 큰 `hostEpoch`를 보고 **스스로 강등**된다(스플릿브레인 가드,
    콘솔 `[net] demoted — …`).
- **클라 연결 끊김**: 최대 3회(1s·2s 백오프) 재접속 시도 → 실패하면 **오프라인 봇전으로 폴백**한다.
- 룸에 탭이 0개가 되면 매치는 종료된다(재생성 필요).
- 감시 상수(`HOST_TIMEOUT_MS=3000`, `maxAttempts=3`, `backoffMs=1000`)는 보수적 추정치 —
  실배포 릴레이 레이턴시 실측 후 튜닝될 수 있다.

---

## 3. 전용 Node 호스트 (선택 — 24/7 서버가 필요할 때)

```bash
npm run build:host
npm run host -- --room r1 --mode dm --players alice,bob
```

- **agent8-in-node 성공 시**: 추가 설정 불필요 — 릴레이가 클라 라우팅을 처리한다.
  (`--public-url`을 줘도 이 모드에선 불필요하므로 무시하고 로그만 남긴다.)
- **실패 시 자동 Plan-B**(자체 ws 서버 `:8765`). 외부 공개는 터널로:

  ```bash
  cloudflared tunnel --url http://localhost:8765
  npm run host -- --room r1 --mode dm --players alice,bob \
      --public-url wss://xxxx.trycloudflare.com/
  ```

- **⚠️ 알려진 제약 (정직하게)**:
  - Plan-B는 **Node 프로세스에 agent8 연결이 없어** `dedicatedHostUrl` 자동기록이 근본적으로 불가능하다
    (`--public-url`은 힌트로 저장/로깅만 됨). 방장이 **브라우저 콘솔에서 1회 수동** 기록한다:

    ```js
    await window.__soldatNet.lobby.net.updateRoomState({
      dedicatedHostUrl: 'wss://xxxx.trycloudflare.com/'
    })
    ```

    (이후 그 룸에 입장하는 브라우저는 매치 트랜스포트를 이 ws로 스위칭한다 — M3-D 배선.)
  - 전용 호스트는 **마이그레이션 없음**(죽으면 매치 종료). pm2/systemd 감시는 스코프 밖.
  - 룸 로스터 **자동구독 미구현** — `--players`로 수동 지정한다.
  - agent8-in-node happy-path 자체는 `@agent8/gameserver` 설치 후에야 실측 가능
    (`resolveHostTransport`의 raw→Transport 어댑터 3~5줄은 설치 시점에 채운다).

---

## 4. gitlab.verse8.io 업로드

이 레포는 `game/` 서브폴더 규약이 **불필요**하다 — 루트에 이미 `index.html`/`vite.config.js`/
`package.json`이 있고 표준 `vite build`로 빌드된다(Man's Panic 자체개발게임 패턴과 동일;
`verse8-starter`의 `game/` 요구는 그 스타터 전용 규약).

1. verse8.io에서 프로젝트 생성 → GitLab 토큰 발급(**1회만 표시**되므로 즉시 보관).
2. 클론:
   ```bash
   git clone -b develop https://oauth2:<token>@gitlab.verse8.io/<user>/<repo>.git
   ```
3. V8 템플릿 파일 제거 후 이 레포 파일로 교체
   (`.env`/`.gitignore`/`@agent8/gameserver` 의존성은 유지).
4. `npm install && npm run build` 로 검증한 뒤 push.
5. V8 AI 첫 프롬프트에 명시:
   > "develop 최신 커밋(해시 명시)과 동기화부터 하고, 로직/구조 변경 없이 그대로 빌드·배포만."

**⚠️ GitLab 단방향 동기화**: 외부 push가 V8 워크스페이스에 자동반영되지 않는다.
V8 AI에게 직접 `git fetch origin && git reset --hard origin/develop`을 시켜야 한다.

---

## 5. 확인

배포 후 검증은 [`m3-net-checklist.md`](./m3-net-checklist.md) 참조 (자동검증 완료분 + 실배포 수동확인분).
