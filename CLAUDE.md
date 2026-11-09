# gwansanattend 작업 지침 (출결 관리)

담임이 출결 기록을 남기고, 그 기록으로 결석·지각·조퇴·결과 **신고서**를 원본 한글 양식 모양으로 출력하는 앱. 자세한 기능은 `README.md`.

- **업무용 앱**이다(출결·방송부·봉사). 수업용 Ohweb 과는 분리한다. 방학 때 gwansanattend·GWBS·GWVS 를 DB 하나·레포 하나로 합칠 예정이며, **지금은 합치지 않는다**(다른 레포 코드·DB를 끌어오지 않는다).

## 구조
- 빌드 없음. `public/` 이 그대로 배포된다.
- `public/app.js` 화면·흐름, `store.js` Firestore 읽기·쓰기, `model.js` 출결 규칙, `dates.js` 수업일·공휴일 계산, `csv.js` 명렬표 CSV(CP949 포함), `form.js` 신고서 SVG(원본 PDF 좌표 그대로 — 좌표·간격은 근거 없이 바꾸지 않는다).
- `public/firebase-config.js` Firebase 설정, `theme.css` 공통 디자인 사본.

## DB — Firebase `gwsattend`
- 컬렉션: `students`, `classes`, `records`, `reports`, `requests`, `allowed`, `admins`, `logs`.
- 규칙: `firestore.rules`. **자동 배포 안 됨** — 테스트 통과 후 Firebase 콘솔 → Firestore → 규칙에 붙여넣어 게시(또는 `firebase deploy --only firestore:rules --project gwsattend`). 고쳤으면 사용자에게 꼭 알린다.

## 배포
- Cloudflare Pages(`gwansanattend`), Build command 비움, output `public`.
- 주소: `attend.kakainfo.com` (기본 `gwansanattend.pages.dev`).
- **배포할 때마다 `node bump-version.mjs` 실행 후 커밋**(파일 주소 `?v=` 갱신 — 아이폰 Safari 캐시 문제 방지).

## 테스트
- 단위: `node --test tests/*.test.mjs` (csv·dates·model)
- 규칙: `cd rules-test && npm install && npm test` (Firestore 에뮬레이터, Java 필요)
- 로컬 확인: `cd public && python3 -m http.server 8000`

## 작업 원칙
- 고치기 전에 **실제 오류 메시지를 먼저 확보**한다. 메시지 없이 추측으로 고치지 않는다.
  사용자에게 확인을 부탁할 때는 열어볼 주소·볼 곳을 하나로 정확히 준다.
- 잘 되던 기능은 요청 없이 건드리지 않는다. 원인이 확인되면 그 원인만 고치고, "겸사겸사" 개선은 먼저 묻는다.
- 같은 문제로 두 번 고쳐도 안 되면 멈추고, 확인한 사실과 모르는 것을 정리해 보고한다.
- 사용자에게는 한국어로, 짧게, 무엇을 바꿨고 무엇을 확인했는지(확인 못 한 것도) 말한다.
- 전체 DB 지도는 `RicardoBrian/Ohweb` 의 `DB.md`. 컬렉션을 새로 만들면 그 표도 고친다.
