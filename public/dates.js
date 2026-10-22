/**
 * 날짜 계산 — DOM·Firebase 의존 없음 (tests/dates.test.mjs 에서 그대로 불러 쓴다).
 *
 * 날짜는 전부 'YYYY-MM-DD' 문자열로 다룬다. Date 객체로 들고 다니면
 * 시간대(UTC/KST) 때문에 하루씩 밀리는 사고가 나기 쉬워서, 계산할 때만
 * UTC 정오 기준 Date를 잠깐 만들어 쓴다.
 */

/**
 * 법정공휴일 + 대체공휴일 + 선거일.
 * 학년도(3월~이듬해 2월)를 덮도록 두 해치를 넣어 둔다. 매년 초에 다음 해를 추가한다.
 * 학교 재량휴업일·방학은 여기 넣지 않는다 — 학교마다 달라서 반 설정의 offDays로 받는다.
 */
export const HOLIDAYS = {
  // 2026
  '2026-01-01': '신정',
  '2026-02-16': '설날 연휴', '2026-02-17': '설날', '2026-02-18': '설날 연휴',
  '2026-03-01': '삼일절', '2026-03-02': '대체공휴일(삼일절)',
  '2026-05-05': '어린이날',
  '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일(부처님오신날)',
  '2026-06-03': '전국동시지방선거',
  '2026-06-06': '현충일',
  '2026-07-17': '제헌절', // 2026년부터 공휴일 재지정
  '2026-08-15': '광복절', '2026-08-17': '대체공휴일(광복절)',
  '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴', '2026-09-28': '대체공휴일(추석)',
  '2026-10-03': '개천절', '2026-10-05': '대체공휴일(개천절)',
  '2026-10-09': '한글날',
  '2026-12-25': '성탄절',
  // 2027 — 정부 발표 전 계산값. 발표되면 확인할 것.
  '2027-01-01': '신정',
  '2027-02-06': '설날 연휴', '2027-02-07': '설날', '2027-02-08': '설날 연휴', '2027-02-09': '대체공휴일(설날)',
  '2027-03-01': '삼일절',
  '2027-05-05': '어린이날',
  '2027-05-13': '부처님오신날',
  '2027-06-06': '현충일',
  '2027-07-17': '제헌절', '2027-07-19': '대체공휴일(제헌절)',
  '2027-08-15': '광복절', '2027-08-16': '대체공휴일(광복절)',
  '2027-09-14': '추석 연휴', '2027-09-15': '추석', '2027-09-16': '추석 연휴',
  '2027-10-03': '개천절', '2027-10-04': '대체공휴일(개천절)',
  '2027-10-09': '한글날', '2027-10-11': '대체공휴일(한글날)',
  '2027-12-25': '성탄절', '2027-12-27': '대체공휴일(성탄절)',
};

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateStr(s) {
  if (typeof s !== 'string' || !RE.test(s)) return false;
  const d = toDate(s);
  return toStr(d) === s; // 2026-02-30 같은 없는 날짜 거르기
}

function toDate(s) {
  const [, y, m, d] = s.match(RE);
  return new Date(Date.UTC(+y, +m - 1, +d, 12));
}

function toStr(d) {
  return d.toISOString().slice(0, 10);
}

export function addDays(s, n) {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toStr(d);
}

/** 오늘 날짜 — 한국 시간 기준. 해외 기기여도 학교 날짜로 맞춘다. */
export function today() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}

export function parts(s) {
  if (!isDateStr(s)) return { y: '', m: '', d: '' };
  const [, y, m, d] = s.match(RE);
  return { y: +y, m: +m, d: +d };
}

export function weekday(s) {
  return '일월화수목금토'[toDate(s).getUTCDay()];
}

/** 3/5(목) 같은 짧은 표기. 목록 화면용. */
export function shortLabel(s) {
  const p = parts(s);
  return p.m ? `${p.m}/${p.d}(${weekday(s)})` : '';
}

/**
 * 수업이 없는 날이면 이유를, 수업일이면 null을 돌려준다.
 * offDays: [{ date, label }] — 반 설정에 저장된 재량휴업일·방학.
 */
export function offReason(s, offDays = []) {
  const wd = toDate(s).getUTCDay();
  if (wd === 0 || wd === 6) return '주말';
  if (HOLIDAYS[s]) return HOLIDAYS[s];
  const o = offDays.find(x => x.date === s);
  return o ? (o.label || '휴업일') : null;
}

/** 시작~끝(포함) 사이 수업일 수. 순서가 뒤집혀 있거나 날짜가 아니면 0. */
export function countSchoolDays(start, end, offDays = []) {
  if (!isDateStr(start)) return 0;
  if (!end) end = start;
  if (!isDateStr(end) || end < start) return 0;
  let n = 0;
  for (let s = start; s <= end; s = addDays(s, 1)) {
    if (!offReason(s, offDays)) n++;
  }
  return n;
}

/** 학년도: 3월~이듬해 2월. 2027-02-10은 2026학년도. */
export function schoolYearOf(s) {
  const p = parts(s);
  return p.m >= 3 ? p.y : p.y - 1;
}
