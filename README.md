# 출결 관리 (관산중)

담임이 출결 기록을 남기고, 그 기록으로 **(결석, 지각, 조퇴, 결과) 신고서**를 원본 한글 양식과 같은 모양으로 출력하는 웹앱.

`kakainfo.com` 계열 앱들과 같은 규격이다 — 빌드 스텝 없음, `public/`이 그대로 배포, `theme.css`는 `Ohweb/design-reference`와 같은 사본.

## 무엇을 하나

- **구글 로그인 + 허용 목록**: 관리자가 앱의 "관리" 탭에서 등록한 Gmail 계정만 사용할 수 있다.
- **반 등록**: 처음 로그인한 선생님이 학년도·학년·반을 고르면 그 반의 담임이 된다. 한 반은 한 계정만 등록할 수 있다.
- **명렬표 CSV**: `학년,반,번호,이름,보호자명`. 학년 전체 파일을 올려도 내 반 학생만 골라 넣는다. 엑셀에서 저장한 CP949 파일도 읽는다.
- **출결 기록**: 나이스 구분대로 결석·지각·조퇴·결과 × 질병·미인정·기타·출석인정(16유형). 사유와 서류는 빠르게 고를 수 있고, 서류 제출·나이스 입력 여부를 목록에서 눌러 바꾼다.
- **결석 일수 자동 계산**: 주말, 공휴일(대체공휴일·선거일 포함), 반 설정에 넣은 재량휴업일·방학을 뺀다. 직접 고칠 수도 있다.
- **결석신고서**: 질병·출석인정 기록만 만든다(양식에 그 둘만 있다). 같은 학생의 기록 여러 건(예: 조퇴 + 결과)을 한 장으로 묶는다. 위 문장의 동그라미는 체크한 칸에 맞춰 자동으로 쳐진다. 보호자 이름을 비우면 빈칸으로 나온다.
- **한 번에 출력**: 여러 장을 골라 한 번에 인쇄(PDF 저장)한다.

## 신고서 글꼴

| 부분 | 글꼴 |
|---|---|
| 1. 기간 ~ 사유명 안내, 1. 확인방법 ~ 2. 첨부 | 함초롬돋움 |
| 나머지 | 굴림 |

굴림은 마이크로소프트 라이선스 글꼴이라 웹에 올려 배포할 수 없다. 그래서 **출력하는 컴퓨터에 설치된 글꼴을 쓴다.**
학교 Windows PC에는 굴림이 있고, 한글(HWP)을 설치하면 함초롬돋움도 같이 깔린다. 즉 **학교 PC에서 출력하면 원본과 같은 글꼴**로 나온다.
글꼴이 없는 기기(폰·맥)에서는 나눔고딕으로 대신 나오고, 미리보기 위에 안내가 뜬다.

글자는 원본 양식 PDF에서 단어마다 측정한 좌표(pt)에 고정해서 그리기 때문에, 대체 글꼴이어도 칸이 밀리지 않는다(`public/form.js`).

## 구조

```
public/
  index.html          화면 틀
  app.js              화면·상태 (탭: 출결 기록 · 신고서 · 명렬표 · 설정 · 관리)
  app.css             페이지 스타일 (theme.css 토큰만 사용)
  form.js             신고서 A4 한 장 그리기 — DOM·Firebase 의존 없음
  sheet.css           신고서 전용 스타일 (흰 종이·검은 글씨 고정)
  model.js            출결 유형, 기록 → 신고서 변환
  dates.js            공휴일 목록, 결석 일수 계산
  csv.js              명렬표 CSV 읽기
  store.js            Firestore 저장 계층
  firebase-config.js  Firebase 설정값 (처음 설정 때 채움)
  theme.css           공용 디자인 시스템 사본
firestore.rules       보안 규칙 — 학생 정보 보호의 핵심
rules-test/           규칙 테스트 (에뮬레이터)
tests/                계산·변환 단위 테스트
```

## 처음 설정 (한 번만)

### 1. Firebase 프로젝트 만들기
1. https://console.firebase.google.com → **프로젝트 추가** → 이름 예: `gwansan-attend` (Google 애널리틱스는 꺼도 된다)
2. 왼쪽 **빌드 → Authentication → 시작하기 → Sign-in method → Google → 사용 설정** → 지원 이메일 고르고 저장
3. 왼쪽 **빌드 → Firestore Database → 데이터베이스 만들기**
   - 위치: **asia-northeast3 (서울)** — 나중에 못 바꾼다
   - **프로덕션 모드**로 시작
4. Firestore → **규칙** 탭 → 이 저장소의 `firestore.rules` 내용을 **전체** 붙여 넣고 **게시**

### 2. 관리자(나) 등록
Firestore → **데이터** 탭에서 직접 만든다(앱에서는 아무도 관리자를 만들 수 없다).
1. **컬렉션 시작** → 컬렉션 ID: `admins`
2. 문서 ID: **내 Gmail 주소를 소문자로** (예: `myname@gmail.com`)
3. 필드는 아무거나 하나(예: `memo` / 문자열 / `관리자`) → 저장

관리자는 따로 허용 목록에 넣지 않아도 앱을 쓸 수 있다.

### 3. 웹 앱 설정값 넣기
1. 프로젝트 설정(톱니바퀴) → **일반** → 아래 "내 앱" → **웹(`</>`)** → 앱 닉네임 입력 → 등록 (Hosting 체크 안 함)
2. 나오는 `firebaseConfig = { ... }` 값을 `public/firebase-config.js`의 같은 이름 칸에 붙여 넣고 커밋
   - 이 값은 공개돼도 되는 식별자다. 보호는 `firestore.rules`가 한다.

### 4. Cloudflare Pages 배포
Ohweb 앱들과 같은 방식이다.
1. Cloudflare → Workers & Pages → Create → Pages → Connect to Git → `RicardoBrian/gwansanattend`
2. Framework preset: `None`, **Build command: 비움**, Build output directory: `public`
3. 배포 후 Custom domains → 예: `attend.kakainfo.com` 연결

### 5. 로그인 허용 도메인 추가 — 빼먹으면 로그인 창이 안 뜬다
Firebase → Authentication → **설정 → 승인된 도메인 → 도메인 추가**
- `attend.kakainfo.com` (연결한 도메인)
- `gwansanattend.pages.dev` (Cloudflare 기본 주소, 미리보기용)

### 6. 선생님 계정 허용
앱에 관리자 계정으로 로그인 → **관리** 탭 → 선생님 Gmail 추가.
선생님은 로그인 → 자기 반 등록 → 명렬표 CSV 올리기 순서로 시작한다.

## 개인정보 보호 — 규칙이 막는 것

- 허용 목록에 없는 계정, 이메일 인증이 안 된 계정은 아무것도 읽고 쓸 수 없다.
- 학생·기록·신고서는 **그 반 담임만** 읽고 쓴다. 다른 담임은 물론 **관리자도 못 본다**.
- 허용 목록에서 빠지면 자기 반 담임이어도 즉시 접근이 끊긴다.
- 명렬표에는 번호·이름·보호자 이름만 저장할 수 있다(연락처 등 다른 필드는 규칙이 거부).
- 관리자의 "등록 해제"는 담임 연결만 끊고 데이터는 남긴다 — 새 담임이 같은 반을 등록하면 이어받는다.
- 담임은 설정 탭의 **학년 말 정리**로 반 데이터를 모두 지울 수 있다.

## 해마다 할 일

- `public/dates.js`의 `HOLIDAYS`에 다음 해 공휴일을 추가한다. 2027년 값은 정부 발표 전 계산값이므로 발표되면 확인한다.
- 학교 재량휴업일·방학은 담임이 앱의 설정 탭에서 넣는다.

## 테스트

```bash
# 계산·변환 (Node 20+)
node --test tests/*.test.mjs

# 보안 규칙 (Java 필요 — Firestore 에뮬레이터)
cd rules-test && npm install && npm test
```

로컬에서 앱을 띄우면(`localhost`) 설정값이 비어 있어도 에뮬레이터(`demo-gwansanattend`)에 붙는다.

```bash
npx firebase-tools emulators:start --only firestore,auth --project demo-gwansanattend
npx http-server public -p 5050 -c-1
```
