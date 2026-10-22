/**
 * 명렬표 CSV 읽기 — DOM·Firebase 의존 없음 (tests/csv.test.mjs).
 *
 * 양식: 학년,반,번호,이름,한글이름,보호자명  (한글이름은 영어 이름으로 등록된 학생만 적는다. 열이 없어도 된다)
 * 학년 전체 명렬표를 그대로 올려도 되게, 선택한 반의 줄만 골라낸다.
 * 학년·반 열이 없는 파일이면 전부 이 반 학생으로 본다.
 */

export const TEMPLATE = '﻿학년,반,번호,이름,한글이름,보호자명\n2,1,1,홍길동,,홍판서\n2,1,2,KIM VIKTORIYA,김빅토리야,\n';

/**
 * 엑셀에서 "CSV로 저장"하면 한국어 Windows는 UTF-8이 아니라 CP949(EUC-KR)로 저장한다.
 * UTF-8로 먼저 엄격하게 읽어 보고, 깨지면 EUC-KR로 다시 읽는다.
 */
export function decodeCsv(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('euc-kr').decode(bytes);
  }
}

/** 따옴표("a,b") · 줄바꿈(CRLF) 처리하는 최소 CSV 파서. */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows
    .map(r => r.map(s => s.trim()))
    .filter(r => r.some(s => s !== ''));
}

const COLS = {
  grade: ['학년'],
  cls: ['반'],
  no: ['번호', '번'],
  name: ['이름', '성명', '학생명'],
  koName: ['한글이름', '한글명', '국문이름', '한국이름'],
  guardian: ['보호자명', '보호자', '보호자 이름', '보호자이름'],
};

const num = s => {
  const m = String(s).match(/\d+/);
  return m ? +m[0] : NaN;
};

/**
 * @returns {{ students: {no,name,koName,guardian}[], errors: string[], skipped: number }}
 *   skipped: 다른 학년·반이라 건너뛴 줄 수
 */
export function parseRoster(text, { grade, cls }) {
  const rows = parseCsv(text);
  const errors = [];
  if (!rows.length) return { students: [], errors: ['빈 파일입니다.'], skipped: 0 };

  const head = rows[0].map(h => h.replace(/\s/g, ''));
  const idx = {};
  for (const [k, names] of Object.entries(COLS)) {
    idx[k] = head.findIndex(h => names.map(n => n.replace(/\s/g, '')).includes(h));
  }
  if (idx.no < 0 || idx.name < 0) {
    return { students: [], errors: ['첫 줄에 "번호"와 "이름" 열이 있어야 합니다.'], skipped: 0 };
  }

  const byNo = new Map();
  let skipped = 0;
  rows.slice(1).forEach((r, i) => {
    const line = i + 2;
    if (idx.grade >= 0 && r[idx.grade] && num(r[idx.grade]) !== grade) { skipped++; return; }
    if (idx.cls >= 0 && r[idx.cls] && num(r[idx.cls]) !== cls) { skipped++; return; }
    const no = num(r[idx.no]);
    const name = (r[idx.name] || '').trim();
    if (!name && !r[idx.no]) return;
    if (!Number.isInteger(no) || no < 1 || no > 99) { errors.push(`${line}번째 줄: 번호가 올바르지 않습니다.`); return; }
    if (!name) { errors.push(`${line}번째 줄: 이름이 비어 있습니다.`); return; }
    if (name.length > 40) { errors.push(`${line}번째 줄: 이름이 너무 깁니다.`); return; }
    if (byNo.has(no)) { errors.push(`${line}번째 줄: ${no}번이 중복됩니다.`); return; }
    const guardian = idx.guardian >= 0 ? (r[idx.guardian] || '').trim().slice(0, 40) : '';
    const koName = idx.koName >= 0 ? (r[idx.koName] || '').trim().slice(0, 40) : '';
    byNo.set(no, { no, name, koName, guardian });
  });

  const students = [...byNo.values()].sort((a, b) => a.no - b.no);
  if (!students.length && !errors.length) {
    errors.push(`${grade}학년 ${cls}반 학생이 파일에 없습니다.`);
  }
  return { students, errors, skipped };
}
