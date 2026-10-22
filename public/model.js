/**
 * 출결 기록·신고서의 모양과 규칙 — DOM·Firebase 의존 없음 (tests/model.test.mjs).
 *
 * 필드 이름과 허용값은 firestore.rules의 검증과 일치해야 한다.
 * 여기서 바꾸면 규칙도 같이 바꾼다.
 */
import { countSchoolDays, nextSchoolDay, today as todayStr } from './dates.js?v=2610222350';

/** 나이스 출결 구분: 4종류 × 4사유 = 16유형 */
export const KINDS = ['결석', '지각', '조퇴', '결과'];
export const CAUSES = ['질병', '미인정', '기타', '출석인정'];

/** 신고서 양식에는 "출석인정 · 질병"만 있다. 미인정·기타는 기록만 남긴다. */
export const REPORT_CAUSES = ['질병', '출석인정'];
export const needsReport = cause => REPORT_CAUSES.includes(cause);

/** 신고서 1. 기간의 줄 순서(양식과 같음)와 저장 키 */
export const ITEM_KEYS = { 지각: 'late', 조퇴: 'early', 결과: 'result', 결석: 'absent' };

export const typeLabel = r => `${r.cause} ${r.kind}`;

/**
 * 교시: 지각은 "몇 교시에 등교", 조퇴는 "몇 교시부터 조퇴", 결과는 "몇~몇 교시".
 * 저장은 문자열 하나 — 결과는 "3~4"(같으면 "3"). 신고서의 ( 교시) 칸에 그대로 들어간다.
 */
export function periodParts(period) {
  const [from = '', to = ''] = String(period || '').split('~').map(x => x.trim());
  return { from, to: to || from };
}

export function joinPeriod(from, to) {
  from = String(from || '').trim(); to = String(to || '').trim();
  if (!from) return to;
  return to && to !== from ? `${from}~${to}` : from;
}

/** 목록에 보이는 교시 설명 */
export function periodLabel(r) {
  if (!r.period) return '';
  if (r.kind === '지각') return `${r.period}교시 등교`;
  if (r.kind === '조퇴') return `${r.period}교시부터 조퇴`;
  const { from, to } = periodParts(r.period);
  return from === to ? `${from}교시` : `${from}~${to}교시`;
}

export const CONFIRM_METHODS = ['가정방문', '전화연락', '기타'];

/** 새 출결 기록 기본값 */
export function emptyRecord(date = todayStr()) {
  return {
    no: null, name: '',
    kind: '결석', cause: '질병',
    start: date, end: date, period: '', days: 1,
    reason: '', docs: [], docsIn: false, neis: false,
    memo: '', reportId: null,
    // 보호자 확인 — 신고서 아래 "확인서"에 그대로 들어간다
    method: '', methodEtc: '', confirmDate: '', confirmHour: '', talker: '',
  };
}

/** 결석이면 수업일 수를 다시 계산해 넣는다. 지각·조퇴·결과는 하루짜리. */
export function normalizeRecord(r) {
  const out = { ...r };
  if (out.kind === '결석') {
    if (!out.end || out.end < out.start) out.end = out.start;
    out.period = '';
  } else {
    out.end = out.start;
    out.days = null;
  }
  return out;
}

export function emptyReport() {
  return {
    no: null, name: '',
    cause: '질병',
    items: { late: null, early: null, result: null, absent: null },
    reason: '',
    written: todayStr(),
    selfName: '', guardianName: '',
    method: '전화연락', methodEtc: '',
    confirmDate: '', confirmHour: '', talker: '',
    attach: '',
    confirmedOn: todayStr(),
    teacherName: '',
    recordIds: [],
  };
}

/**
 * 결석 일수. 기록마다 일수를 더하되, 날짜가 겹치는 기록(같은 결석을 두 번 입력한 경우 등)은
 * 겹친 부분을 한 번만 센다. 겹침 없이 한 건뿐이면 그 기록의 일수(직접 고친 값 포함)를 그대로 쓴다.
 */
export function absentDays(recs, offDays = []) {
  const list = [...recs].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const groups = [];
  for (const x of list) {
    const end = x.end || x.start, g = groups.at(-1);
    if (g && x.start <= g.end) { g.end = end > g.end ? end : g.end; g.recs.push(x); }
    else groups.push({ start: x.start, end, recs: [x] });
  }
  return groups.reduce((n, g) => n + (g.recs.length === 1
    ? (Number(g.recs[0].days) || countSchoolDays(g.start, g.end, offDays))
    : countSchoolDays(g.start, g.end, offDays)), 0);
}

const uniq = arr => [...new Set(arr.filter(Boolean))];

/**
 * 고른 출결 기록들로 신고서 초안을 만든다.
 * 같은 학생 기록만 넘어온다고 가정한다(호출하는 쪽에서 막음).
 * @returns {{ report, warnings: string[] }}
 */
export function reportFromRecords(recs, { student, teacherName = '', offDays = [], today = todayStr() } = {}) {
  const warnings = [];
  const r = emptyReport();
  const sorted = [...recs].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const first = sorted[0];

  r.no = first?.no ?? student?.no ?? null;
  r.name = first?.name || student?.name || '';
  r.selfName = r.name;
  r.guardianName = student?.guardian || '';
  r.teacherName = teacherName;
  // 작성일은 마지막 출결일의 다음 수업일, 확인서 날짜는 그다음 수업일.
  // 주말·공휴일·재량휴업일은 건너뛴다(금요일 결석 → 월요일 작성 → 화요일 확인).
  const lastDay = sorted.map(x => x.end || x.start).sort().at(-1);
  r.written = lastDay ? nextSchoolDay(lastDay, offDays) : today;
  r.confirmedOn = nextSchoolDay(r.written, offDays);
  r.recordIds = sorted.map(x => x.id).filter(Boolean);

  const causes = uniq(sorted.map(x => x.cause));
  r.cause = causes.includes('질병') ? '질병' : '출석인정';
  if (causes.length > 1) warnings.push('질병과 출석인정 기록이 섞여 있어 "질병"으로 표시했습니다.');
  if (causes.some(c => !needsReport(c))) warnings.push('미인정·기타 기록은 신고서에 넣지 않습니다.');

  for (const kind of ['지각', '조퇴', '결과']) {
    const list = sorted.filter(x => x.kind === kind && needsReport(x.cause));
    if (!list.length) continue;
    if (list.length > 1) warnings.push(`${kind} 기록이 ${list.length}건이라 첫 번째(${list[0].start})만 넣었습니다. 양식에 ${kind} 칸이 하나뿐입니다.`);
    r.items[ITEM_KEYS[kind]] = { date: list[0].start, period: list[0].period || '' };
  }

  const abs = sorted.filter(x => x.kind === '결석' && needsReport(x.cause));
  if (abs.length) {
    const start = abs[0].start;
    const end = abs.map(x => x.end || x.start).sort().at(-1);
    r.items.absent = { start, end, days: absentDays(abs, offDays) || countSchoolDays(start, end, offDays) };
    if (abs.length > 1 && abs.some((x, i) => abs.slice(0, i).some(y => x.start <= (y.end || y.start) && (x.end || x.start) >= y.start))) {
      warnings.push('날짜가 겹치는 결석 기록이 있어 겹친 날은 한 번만 셌습니다. 같은 기록을 두 번 입력하지 않았는지 확인하세요.');
    }
  }

  r.reason = uniq(sorted.filter(x => needsReport(x.cause)).map(x => (x.reason || '').trim())).join(', ');
  r.attach = uniq(sorted.flatMap(x => x.docs || [])).join(', ');

  // 보호자 확인: 기록에 적어 둔 첫 확인을 쓴다. 없으면 날짜만 첫 출결일로.
  const conf = sorted.find(x => x.method);
  if (conf) {
    r.method = conf.method;
    r.methodEtc = conf.methodEtc || '';
    r.confirmDate = conf.confirmDate || conf.start;
    r.confirmHour = conf.confirmHour || '';
    r.talker = conf.talker || '';
  } else {
    r.method = '';
    r.confirmDate = first?.start || '';
  }
  return { report: r, warnings };
}

/**
 * 신고서가 아직 없는 기록들을 "한 장씩" 묶는다.
 * 같은 학생 · 같은 구분(질병/출석인정) · 날짜가 이어지는(다음 수업일 이내) 기록끼리.
 * 지각·조퇴·결과는 양식에 칸이 하나씩이라 같은 종류가 또 나오면 새 장으로 넘긴다.
 * (예: 3/5 조퇴 + 3/6 결과 → 한 장, 3/10~3/11 결석 두 건 → 한 장)
 * @returns {object[][]} 기록 묶음 목록 (학생 번호, 날짜 순)
 */
export function groupForReports(records, offDays = []) {
  const todo = records
    .filter(r => needsReport(r.cause) && !r.reportId)
    .sort((a, b) => a.no - b.no || a.start.localeCompare(b.start) || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
  const groups = [];
  let g = null, gEnd = '';
  for (const r of todo) {
    const fits = g
      && g[0].no === r.no
      && g[0].cause === r.cause
      && r.start <= nextSchoolDay(gEnd, offDays)
      && (r.kind === '결석' || !g.some(x => x.kind === r.kind));
    if (!fits) { g = []; groups.push(g); gEnd = ''; }
    g.push(r);
    const end = r.end || r.start;
    if (end > gEnd) gEnd = end;
  }
  return groups;
}

/** 체크된 칸으로 위 문장 "( 결석 · 지각 · 조퇴 · 결과 )"의 동그라미를 정한다. */
export function circledKinds(report) {
  return KINDS.filter(k => report.items?.[ITEM_KEYS[k]]);
}
