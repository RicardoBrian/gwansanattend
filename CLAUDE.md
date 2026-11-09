# gwansanattend 작업 지침 (출결 관리)

담임이 출결 기록을 남기고, 그 기록으로 결석·지각·조퇴·결과 **신고서**를 원본 한글 양식 모양으로 출력하는 앱. 자세한 기능은 `README.md`.

- **업무용 앱**이다(출결·방송부·봉사). 수업용 Ohweb 과는 분리한다. 방학 때 gwansanattend·GWBS·GWVS 를 DB 하나·레포 하나로 합칠 예정이며, **지금은 합치지 않는다**(다른 레포 코드·DB를 끌어오지 않는다).

## 구조
- 빌드 없음. `public/` 이 그대로 배포된다.
- `public/app.js` 화면·흐름, `store.js` Firestore 읽기·쓰기, `model.js` 출결 규칙, `dates.js` 수업일·공휴일 계산, `csv.js` 명렬표 CSV(CP949 포함), `form.js` 신고서 SVG(원본 PDF 좌표 그대로 — 좌표·간격은 근거 없이 바꾸지 않는다).
- `public/firebase-config.js` Firebase 설정, `theme.css` 공통 디자인 사본.

## DB — Firebase `gwansan-work` (업무용 통합 프로젝트, 2026-11-09 전환)
- 출결 데이터: `apps/attend/` 아래 — `allowed/{이메일}`, `requests/{uid}`, `logs`, `classes/{연도-학년-반}`(+ `guardians`, `records`, `reports`).
- 명렬표(이름·번호): 세 앱 공용 `years/{연도}/students/{연도-학년-반-번호}` — 학생 관리 사이트(students.kakainfo.com)·봉사 앱도 쓴다. 출결 화면에는 `store.js` 가 예전 모양 `{no, name, koName, guardian}` 으로 바꿔 넘긴다.
- 보호자명: 반 아래 `guardians/{학생ID}` — **그 반 담임만** 읽는다(관리자도 못 봄).
- 담임 확인은 `ownerEmail`(이메일). uid 는 프로젝트마다 달라서 쓰지 않는다.
- 관리자: 공용 `admins/{이메일}`.
- 규칙: 세 앱 공용 파일 하나 — 원본은 GWVS 레포 `firestore.rules`(사용자 컴퓨터 `~/code/workapps-merge/firestore.rules`, 시험 `rules-test`). 이 레포의 `firestore.rules`·`rules-test/` 는 예전 프로젝트(gwsattend)용으로 남아 있다.
- 예전 프로젝트 `gwsattend` 는 백업으로 남겨 두었다(지우지 않음). 백업: `~/secrets/backup/2026-11-09-출결-1225/`.

## 배포
- Cloudflare Pages(`gwansanattend`), Build command 비움, output `public`.
- 주소: `attend.kakainfo.com` (기본 `gwansanattend.pages.dev`). 새 주소는 `gwansan-work` → Authentication → 승인된 도메인에 추가.
- **배포할 때마다 `node bump-version.mjs` 실행 후 커밋**(파일 주소 `?v=` 갱신 — 아이폰 Safari 캐시 문제 방지).

## 테스트
- 단위: `node --test tests/*.test.mjs` (csv·dates·model)
- 규칙: 공용 규칙 시험 `~/code/workapps-merge/rules-test` 에서 `node attend.rules.test.mjs` (에뮬레이터에 데이터 사본 필요)
- 로컬 확인: `cd public && python3 -m http.server 8000` — localhost 는 항상 에뮬레이터(demo-gwansan-work)에 붙는다

## 작업 원칙
- 고치기 전에 **실제 오류 메시지를 먼저 확보**한다. 메시지 없이 추측으로 고치지 않는다.
  사용자에게 확인을 부탁할 때는 열어볼 주소·볼 곳을 하나로 정확히 준다.
- 잘 되던 기능은 요청 없이 건드리지 않는다. 원인이 확인되면 그 원인만 고치고, "겸사겸사" 개선은 먼저 묻는다.
- 같은 문제로 두 번 고쳐도 안 되면 멈추고, 확인한 사실과 모르는 것을 정리해 보고한다.
- 사용자에게는 한국어로, 짧게, 무엇을 바꿨고 무엇을 확인했는지(확인 못 한 것도) 말한다.
- 전체 DB 지도는 `RicardoBrian/Ohweb` 의 `DB.md`. 컬렉션을 새로 만들면 그 표도 고친다.
