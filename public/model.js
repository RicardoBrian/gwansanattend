/**
 * 출결 기록·신고서의 모양과 규칙 — DOM·Firebase 의존 없음 (tests/model.test.mjs).
 *
 * 필드 이름과 허용값은 firestore.rules의 검증과 일치해야 한다.
 * 여기서 바꾸면 규칙도 같이 바꾼다.
 */
import { countSchoolDays, today as todayStr } from './dates.js';

/** 나이스 출결 구분: 4종류 × 4사유 = 16유형 */
export const KINDS = ['결석', '지각', '조퇴', '결과'];
export const CAUSES = ['질병', '미인정', '기타', '출석인정'];

/** 신고서 양식에는 "출석인정 · 질병"만 있다. 미인정·기타는 기록만 남긴다. */
export const REPORT_CAUSES = ['질병', '출석인정'];
export const needsReport = cause => REPORT_CAUSES.includes(cause);

/** 신고서 1. 기간의 줄 순서(양식과 같음)와 저장 키 */
export const ITEM_KEYS = { 지각: 'late', 조퇴: 'early', 결과: 'result', 결석: 'absent' };

export const typeLabel = r => `${r.cause} ${r.kind}`;

/** 서류 드롭다운. 앞쪽은 노션 출결 DB 항목, 뒤쪽은 신고서 안내 문구에 있는 것. */
export const DOC_OPTIONS = [
  '진료확인서', '처방전', '진료비 계산서', '담임확인서', '사회봉사 이수 확인서', '체험학습 보고서',
  '약봉투', '공문', '내부결재 서류', '출입국 증빙서류',
];

/** 사유 빠른 입력. 신고서의 "사유명" 안내 문구를 따른다. */
export const REASON_PRESETS = [
  '감기', '두통', '복통', '장염', '발열', '생리통', '치과진료', '병원진료', '건강검진',
  '감염병(인플루엔자)', '감염병(코로나19)', '비자발급',
];

export const CONFIRM_METHODS = ['가정방문', '전화연락', '기타'];

export const TALKER_PRESETS = ['어머님', '아버님', '할머님', '할아버님', '보호자', '본인'];

/** 새 출결 기록 기본값 */
export function emptyRecord(date = todayStr()) {
  return {
    no: null, name: '',
    kind: '결석', cause: '질병',
    start: date, end: date, period: '', days: 1,
    reason: '', docs: [], docsIn: false, neis: false,
    memo: '', reportId: null,
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
  r.written = today;
  r.confirmedOn = today;
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
    const sum = abs.reduce((n, x) => n + (Number(x.days) || 0), 0);
    r.items.absent = { start, end, days: sum || countSchoolDays(start, end, offDays) };
  }

  r.reason = uniq(sorted.filter(x => needsReport(x.cause)).map(x => (x.reason || '').trim())).join(', ');
  r.attach = uniq(sorted.flatMap(x => x.docs || [])).join(', ');
  r.confirmDate = first?.start || '';
  return { report: r, warnings };
}

/** 체크된 칸으로 위 문장 "( 결석 · 지각 · 조퇴 · 결과 )"의 동그라미를 정한다. */
export function circledKinds(report) {
  return KINDS.filter(k => report.items?.[ITEM_KEYS[k]]);
}
