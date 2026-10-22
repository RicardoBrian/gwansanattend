/**
 * 결석신고서 A4 한 장을 그린다 — Firebase 의존 없음.
 * 브라우저에서는 첨부 줄나눔을 위해 canvas로 글자 폭만 잰다(Node 테스트에서는 어림값).
 *
 * 한 장 전체가 SVG 하나다. 좌표는 pt(1/72인치)이고 원본 한글 양식을 PDF로 저장한 파일에서 읽은 값이다.
 *  - 글자는 기준선(baseline) y에 놓는다. HTML 글자처럼 글꼴의 위아래 여백에 따라 줄 높이가
 *    달라지지 않는다 — 어느 컴퓨터·브라우저에서 출력해도 줄 높이가 원본과 같다.
 *  - 선도 SVG다. CSS 테두리는 0.36pt 선이 화면 픽셀(1px = 0.75pt)로 굵어져 출력된다.
 *  - 값이 없는 고정 글자는 글자마다 원본 x에 놓는다.
 *  - 값이 들어가는 줄은 한글처럼 "글자 + 빈칸"으로 이어 그린다. 빈칸 하나는 언제나 글자 크기의
 *    절반이다(원본의 모든 간격이 정확히 그 배수). 한글에서 값을 치면 뒤 글자가 밀리므로,
 *    원본과 같은 글꼴이면 위치도 원본과 같다. 빈칸 개수는 원본 예시 신고서들에서 읽었다(줄마다 주석).
 *  - 첨부는 한글처럼 줄을 나눈다(한글은 글자 단위, 영문·숫자는 단어 단위). 줄 수만큼 아래 칸이 내려간다.
 *
 * 글꼴·크기·색은 원본 PDF 안의 데이터를 그대로 읽은 값이다(눈대중 아님):
 *   g   — 굴림. 한글(HWP)은 굴림을 "채우기 + 윤곽선(글자 크기의 1/100)"으로 찍는다
 *   hb  — 함초롬돋움 Bold (1. 기간 ~ 2. 사유, 1. 확인방법 ~ 2. 첨부, 입력값 포함)
 *   hmb — 함초롬바탕 Bold 9.96pt (※ 사유명 안내 줄, "감염병(종류)"는 빨강 #ff0000)
 *   dot — "출석인정 ․ 질병" 사이 점: 원본은 한컴돋움의 ․(U+2024). 한컴돋움이 없으면 굴림 ·
 *   선  — 0.36pt(사유명 밑줄·동그라미 0.48pt), 절취선은 지름 0.96pt 점을 1.2pt 간격으로
 */
import { parts } from './dates.js?v=2610222350';
import { circledKinds } from './model.js?v=2610222350';

/** 고정 글자 [기준선 y, 크기, 글꼴, 글자, 글자마다 x] — 원본 빈 양식 그대로 */
const STATIC = [
  [72.6,11.04,"g","계학년부장",[421.32,478.18,489.22,500.26,511.19]],
  [78.36,11.04,"g","결",[369.84]],
  [113.64,11.04,"g","재",[369.84]],
  [158.88,17.04,"g","(결석,지각,조퇴,결과)신고서",[163.8,178.56,195.6,212.71,226.79,243.66,260.76,274.84,291.88,308.82,323.06,340.11,365.56,380.32,397.36,414.4]],
  [244.32,12.0,"g","본인은다음과같이(출석인정",[89.52,101.04,112.56,129.84,141.36,152.88,170.16,181.68,198.96,209.04,220.56,232.09,243.61]],
  [244.32,12.0,"dot","․",[260.88]],
  [244.32,12.0,"g","질병)(으)로(결석",[268.69,280.21,297.48,307.56,311.89,323.4,327.73,345.01,355.09,366.61]],
  [244.32,12.0,"dot","․",[383.88]],
  [244.32,12.0,"g","지각",[391.69,403.21]],
  [244.32,12.0,"dot","․",[420.49]],
  [244.32,12.0,"g","조퇴",[428.17,439.69]],
  [244.32,12.0,"dot","․",[456.97]],
  [244.32,12.0,"g","결과)",[464.77,476.29,493.57]],
  [263.52,12.0,"g","하였(겠)기에보호자연서로신고합니다.",[83.52,95.52,107.52,112.08,124.08,128.64,140.64,158.64,170.64,182.64,200.64,212.64,224.65,242.65,254.65,266.65,278.65,290.65,302.65]],
  [280.92,9.96,"g","※해당하는곳에○합니다.",[87.12,102.12,112.18,122.14,132.1,147.14,157.2,172.18,187.18,197.14,207.1,217.16]],
  [307.68,12.0,"hb","1.기간(해당란에☑)",[90.0,96.6,105.84,117.48,135.12,138.96,150.6,162.24,173.88,191.52,203.16]],
  [443.88,9.96,"hmb","※사유명:",[143.52,156.24,166.0,175.66,185.42]],
  [443.88,9.96,"hmb red","감염병(종류)",[193.68,203.44,213.1,222.84,225.95,235.71,245.35]],
  [443.88,9.96,"hmb",",감기,생리통,치과진료,비자발급등",[248.64,256.8,266.56,276.23,284.49,294.25,303.91,313.68,321.84,331.6,341.26,351.03,360.69,368.85,378.62,388.28,398.04,412.78]],
  [546.48,15.96,"g","관산중학교장귀하",[177.6,209.52,241.6,273.52,305.44,337.53,385.57,401.53]],
  [576.96,17.04,"g","확인서",[246.6,289.03,331.63]],
  [603.12,12.0,"g","위신고내용이사실과다름이없음을확인함.",[95.52,113.52,125.52,143.52,155.52,167.52,185.52,197.52,209.52,227.52,239.53,251.53,269.53,281.53,293.53,311.53,323.53,335.53,347.53]],
  [625.92,12.0,"hb","1.확인방법(해당란에☑)",[90.0,96.6,105.84,117.48,129.12,140.76,158.4,162.24,173.88,185.52,197.16,214.8,226.45]],
  [645.12,12.0,"hb","가정방문전화연락",[125.16,136.8,148.44,160.08,201.36,213.0,224.64,236.28]],
  [711.12,11.04,"hb","2",[90.01]],
  [711.12,12.0,"hb",".첨부:",[96.12,105.36,117.0,128.64]],
];

/*
 * "2. 첨부:" 아래쪽(안내 문구·날짜·담임·틀 아랫선)은 첨부가 몇 줄이냐에 따라 통째로 내려간다.
 * 아래 좌표는 첨부가 한 줄일 때 값이고, 늘어난 줄 수 × 줄 간격만큼 더한다.
 */
const MOVING = [
  [728.64,9.96,"g","※진료확인서,약봉투,공문이나내부결재서류,출입국사무소(대사관)증빙서류(여권사본,사진,영수증등)",[94.58,107.88,116.55,125.31,133.88,142.54,151.32,158.48,167.14,175.91,184.59,191.75,200.51,209.18,217.84,230.89,239.56,248.32,256.89,270.03,278.6,287.28,294.64,303.2,311.87,320.63,329.3,337.96,346.64,349.92,358.58,367.35,375.93,383.68,392.25,400.91,409.68,418.36,421.53,430.3,438.96,447.63,456.41,463.56,472.23,481.01,488.17,496.83,505.6,518.55,527.32]],
];

const ATTACH = {
  x: 138.36, y: 711.12, lineGap: 19.2, size: 12,
  right: 536.0,  // 원본 예시 3: 533.3까지 쓴 줄은 들어가고 538.8까지 가야 하는 글자는 다음 줄로 넘어갔다
  maxLines: 3,   // 4줄부터는 틀이 종이 밖으로 나간다 → 글자를 줄여 3줄에 맞춘다
};
const FRAME = { left: 58.20, right: 537.00, top: 126.24, bottom: 782.40, lineLeft: 58.08, lineRight: 537.24 };

/**
 * 위 문장의 동그라미 [x0, x1] — 원본 예시 PDF의 타원 좌표 그대로(높이 229.44~250.08).
 * 예시에 없던 지각·출석인정은 같은 방식(단어 가운데, 단어 폭 + 2.4pt)으로.
 */
const CIRCLES = {
  출석인정: [208.1, 256.5], 질병: [266.40, 292.32],
  결석: [355.92, 382.08], 지각: [390.49, 416.41], 조퇴: [425.88, 452.04], 결과: [463.56, 489.48],
};
const CIRCLE_Y = [229.44, 250.08];

/** 첨부 줄나눔에 쓰는 글꼴 — sheet.css의 .hb와 같아야 한다(tests/model.test.mjs가 확인) */
export const HB_FAMILY = '"함초롬돋움", "HCR Dotum", "HCRDotum", "Nanum Gothic", "NanumGothic", sans-serif';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => +n.toFixed(2);
const len = v => String(v ?? '').length;
// ☑는 아이폰이 컬러 이모지로 바꿔 그린다. 뒤에 U+FE0E(글자 모양으로 표시)를 붙여 막는다.
const CHECK = '☑\uFE0E';
const box = checked => (checked ? CHECK : '□');

/** 굴림·한컴돋움은 윤곽선도 같이(원본 PDF 글자 모드 "채우기+윤곽선", 굵기 = 글자 크기/100) */
const strokeAttr = (cls, size) => (/^(g|hd)\b/.test(cls) ? ` stroke-width="${num(size / 100)}"` : '');

/** 고정 글자 한 덩어리: 글자마다 원본 x */
function fixed([y, size, cls, text, xs], dy = 0, opts = {}) {
  if (cls === 'dot') {
    cls = opts.haansoftDotum ? 'hd' : 'g';
    text = opts.haansoftDotum ? '․' : '·';
  }
  // ☑는 따로 떼어 그린다(글자마다 x를 주는 목록에 FE0E가 끼면 뒤 글자 위치가 밀릴 수 있어서)
  const at = (t, x) => `<text class="${cls}" font-size="${size}"${strokeAttr(cls, size)} x="${x.join(' ')}" y="${num(y + dy)}">${esc(t)}</text>`;
  const i = text.indexOf('☑');
  if (i < 0) return at(text, xs);
  return (i ? at(text.slice(0, i), xs.slice(0, i)) : '') + at(CHECK, [xs[i]]) +
    (i + 1 < text.length ? at(text.slice(i + 1), xs.slice(i + 1)) : '');
}

/**
 * 값이 들어가는 줄. items는 글자 조각과 빈칸 개수(숫자)의 목록이다.
 * 빈칸 하나 = 글자 크기의 절반, 글자 조각 안의 공백도 빈칸 하나로 친다.
 */
function flow(x, y, size, cls, items, anchor = '', attrs = '') {
  // 숫자는 빈칸 개수다 — 값(월·일 등)은 반드시 문자열로 넘긴다
  const segs = [];
  let gap = 0;
  for (const it of items) {
    if (typeof it === 'number') { gap += Math.max(0, it); continue; }
    String(it ?? '').split(' ').forEach((t, i) => {
      if (i) gap += 1;
      if (!t) return;
      if (!gap && segs.length) segs.at(-1)[1] += t;
      else segs.push([gap, t]);
      gap = 0;
    });
  }
  if (!segs.length) return '';
  const half = size / 2;
  const body = esc(segs[0][1]) + segs.slice(1).map(([g, t]) => `<tspan dx="${num(g * half)}">${esc(t)}</tspan>`).join('');
  return `<text class="${cls}" font-size="${size}"${strokeAttr(cls, size)} x="${num(x + segs[0][0] * half)}" y="${num(y)}"${anchor ? ` text-anchor="${anchor}"` : ''}${attrs}>${body}</text>`;
}

/** 칸 n개 중 값이 차지하지 않은 만큼 빈칸 — 원본 예시: 값은 그 자리 빈칸을 한 글자에 하나씩 대신한다 */
const fill = (n, v) => (v === '' || v == null ? [n] : [n - len(v), String(v)]);

// ── 첨부 줄나눔 ──────────────────────────────────────

const HANGUL = 'ᄀ-ᇿ㄰-㆏가-힣一-鿿豈-﫿';
const TOKEN = new RegExp(` +|[${HANGUL}]|[^ ${HANGUL}]+`, 'g');
/** 줄 첫머리에 올 수 없는 글자, 줄 끝에 올 수 없는 글자(한글의 기본 금칙) */
const NO_START = /^[)\]}>.,:;!?%'"’”」』〉》…·․~]/;
const NO_END = /[(\[{<‘“「『〈《]$/;

/** 한글은 글자마다, 영문·숫자·기호는 붙은 덩어리마다 나눈다. sp = 앞 빈칸 수 */
function tokenize(text) {
  const out = [];
  let sp = 0;
  for (const [s] of text.matchAll(TOKEN)) {
    if (s[0] === ' ') { sp += s.length; continue; }
    const prev = out.at(-1);
    if (prev && !sp && (NO_START.test(s) || NO_END.test(prev.t))) prev.t += s;
    else out.push({ t: s, sp });
    sp = 0;
  }
  return out;
}

/** 글자 폭(em). 브라우저면 실제 글꼴로 재고, 아니면 함초롬돋움 Bold 기준 어림값. */
function makeMeasure() {
  let ctx = null;
  try {
    if (typeof document !== 'undefined') {
      ctx = document.createElement('canvas').getContext('2d');
      ctx.font = `700 100px ${HB_FAMILY}`;
      if ('fontKerning' in ctx) ctx.fontKerning = 'none';
    }
  } catch { ctx = null; }
  const memo = new Map();
  return ch => {
    if (memo.has(ch)) return memo.get(ch);
    const em = ctx ? ctx.measureText(ch).width / 100
      : new RegExp(`[${HANGUL}]`).test(ch) ? 0.97 : /[()[\]{}.,:;'"]/.test(ch) ? 0.31 : 0.55;
    memo.set(ch, em);
    return em;
  };
}

/**
 * 첨부를 줄로 나눈다. 괄호 설명(담임확인서(상기명 학생은 …))이면 둘째 줄부터 "(" 아래에서 시작
 * (원본 예시 3 그대로). 괄호 앞부분이 한 줄의 절반을 넘으면 그냥 첫 줄 시작 위치에 맞춘다.
 * @returns {{ size, lineGap, lines: { x, items }[] }}
 */
export function layoutAttach(text, measure = makeMeasure()) {
  text = String(text ?? '').trim();
  if (!text) return { size: ATTACH.size, lineGap: ATTACH.lineGap, lines: [] };
  let best;
  for (const size of [12, 11.5, 11, 10.5, 10, 9.5, 9]) {
    const w = s => [...s].reduce((a, ch) => a + (ch === ' ' ? 0.5 : measure(ch)), 0) * size;
    const open = text.indexOf('(');
    const headW = open > 0 ? w(text.slice(0, open)) : 0;
    const indent = open > 0 && headW < (ATTACH.right - ATTACH.x) / 2 ? ATTACH.x + headW : ATTACH.x;
    const lines = [];
    let cur = { x: ATTACH.x, items: [], w: 0 };
    const newLine = () => { lines.push(cur); cur = { x: indent, items: [], w: 0 }; };
    const put = (sp, t, tw) => { cur.items.push(sp, t); cur.w += sp * size / 2 + tw; };
    for (const { t, sp } of tokenize(text)) {
      const tw = w(t);
      if (cur.items.length && cur.x + cur.w + sp * size / 2 + tw > ATTACH.right) newLine();
      const gap = cur.items.length ? sp : 0;  // 줄 첫머리 빈칸은 버린다(한글과 같음)
      if (cur.x + cur.w + gap * size / 2 + tw <= ATTACH.right) { put(gap, t, tw); continue; }
      // 한 줄보다 긴 덩어리(긴 영문·숫자)는 글자 단위로 자른다
      let piece = '', pw = 0, g = gap;
      for (const ch of t) {
        const cw = w(ch);
        if (piece && cur.x + cur.w + g * size / 2 + pw + cw > ATTACH.right) { put(g, piece, pw); newLine(); piece = ''; pw = 0; g = 0; }
        piece += ch; pw += cw;
      }
      if (piece) put(g, piece, pw);
    }
    lines.push(cur);
    best = { size, lineGap: num(ATTACH.lineGap * size / 12), lines };
    if (lines.length <= ATTACH.maxLines) break;
  }
  return best;
}

/** 굴림 기준 글 폭 어림(em): 한글 1, 대문자 0.68, 그 밖의 영문·숫자 0.55, 공백 0.5, 괄호 0.34 */
function nameEm(v) {
  let em = 0;
  for (const ch of String(v)) {
    em += ch === ' ' ? 0.5 : /[()]/.test(ch) ? 0.34 : /[A-Z]/.test(ch) ? 0.68 : new RegExp(`[${HANGUL}]`).test(ch) ? 1 : 0.55;
  }
  return em;
}
/** 이름이 칸(avail pt)을 넘으면 글자 크기를 줄인다(최소 9pt) */
export function fitNameSize(v, size, avail) {
  const w = nameEm(v) * size;
  return w <= avail ? size : Math.max(9, Math.floor((size * avail / w) * 10) / 10);
}

// ── 선 ───────────────────────────────────────────────

const L = (x1, y1, x2, y2, w = 0.36) => `<line x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}" stroke-width="${w}"/>`;

/** 결재란, 틀, 밑줄, 절취선, 동그라미 — 원본 PDF 좌표 그대로. shift = 첨부가 늘어난 만큼 */
function drawLines(circled, shift) {
  const [cy0, cy1] = CIRCLE_Y;
  const bottom = FRAME.bottom + shift;
  return `<g stroke="#000" fill="none">` +
    L(360.48, 58.08, 537.24, 58.08) + L(390.00, 79.32, 537.24, 79.32) +
    L(360.60, 58.08, 360.60, FRAME.top) + L(390.12, 58.08, 390.12, FRAME.top) + L(463.56, 58.08, 463.56, FRAME.top) +
    L(FRAME.right, 58.08, FRAME.right, bottom) +
    L(FRAME.left, FRAME.top, FRAME.left, bottom) +
    L(FRAME.lineLeft, FRAME.top, FRAME.lineRight, FRAME.top) +
    L(FRAME.lineLeft, bottom, FRAME.lineRight, bottom) +
    L(87.12, 282.60, 220.56, 282.60) +
    L(143.52, 445.92, 422.64, 445.92, 0.48) +
    L(94.56, 730.32 + shift, 531.12, 730.32 + shift) +
    `<line x1="58.02" y1="555.06" x2="537.6" y2="555.06" stroke-width="0.96" stroke-linecap="round" stroke-dasharray="0 1.2"/>` +
    circled.map(w => {
      const [x0, x1] = CIRCLES[w];
      return `<ellipse class="circle" cx="${num((x0 + x1) / 2)}" cy="${num((cy0 + cy1) / 2)}" rx="${num((x1 - x0) / 2)}" ry="${num((cy1 - cy0) / 2)}" stroke-width="0.48"/>`;
    }).join('') +
    `</g>`;
}

/**
 * @param {object} r 신고서(model.emptyReport 모양) + grade, cls
 * @param {{ haansoftDotum?: boolean, stamp?: string, measure?: (ch: string) => number }} opts
 *   haansoftDotum: 이 기기에 한컴돋움이 있으면 true(원본과 같은 점 ․)
 *   measure: 함초롬돋움 Bold 글자 폭(em) — 테스트용. 없으면 브라우저 canvas로 잰다
 * @returns {string} <div class="sheet">…</div>
 */
export function renderSheet(r, opts = {}) {
  const out = [];
  const baseYear = parts(r.written).y || parts(r.confirmedOn).y || '';

  for (const run of STATIC) out.push(fixed(run, 0, opts));

  // ── 학년·반·번호 (굴림 12.96) — 양식 "제····학년·····반······번"
  //    예시 "제··2·학년··1·반···18·번", "…반··5·번" (번호 앞 빈칸 = 1 + 자릿수)
  const g = r.grade, c = r.cls, n = r.no;
  out.push(flow(360.96, 196.20, 12.96, 'g', [
    '제', ...(g ? [2, String(g), 1] : [4]), '학년', ...(c ? [2, String(c), 1] : [5]), '반',
    ...(n ? [1 + len(n), String(n), 1] : [6]), '번',
  ]));
  // ── 성명 — "성·명·:·이름". 영어 이름이면 "영어이름(한글이름)". 너무 길면 이름 칸 안에 들어오게 글자를 줄인다
  out.push(flow(364.08, 217.08, 12.96, 'g', ['성', 1, '명', 1, ':']));
  {
    const shown = r.koName && r.koName !== r.name ? `${r.name}(${r.koName})` : (r.name || '');
    const avail = 534 - 413.86, size = fitNameSize(shown, 12.96, avail);
    // 9pt까지 줄여도 넘치면 글자 폭만 좁힌다
    const squeeze = nameEm(shown) * size > avail ? ` textLength="${num(avail)}" lengthAdjust="spacingAndGlyphs"` : '';
    out.push(flow(413.86, 217.08, size, 'g', [shown], '', squeeze));
  }

  // ── 1. 기간 (함초롬돋움 Bold 12) — 양식 "□·지각·2026년····월·····일·(····교시)·등교"
  //    예시 "☑·조퇴·2026년···3월····5일·(···5교시)·부터", "···11일"
  const rows = [['late', '지각', 326.88, [1, '등교']], ['early', '조퇴', 350.88, [1, '부터']], ['result', '결과', 374.88, []]];
  for (const [key, label, y, tail] of rows) {
    const it = r.items?.[key];
    const p = parts(it?.date);
    out.push(flow(107.52, y, 12, 'hb', [
      box(!!it), 1, label, 1, `${p.y || baseYear}년`, ...fill(4, p.m), '월', ...fill(5, p.d), '일', 1,
      '(', ...fill(4, it?.period ?? ''), '교시)', ...tail,
    ]));
  }
  {
    // 결석 — 예시 "☑·결석·2026년···3월···10일··부터··2026년···3월···10일·까지·(···1·일)"
    const it = r.items?.absent;
    const s0 = parts(it?.start), e0 = parts(it?.end || it?.start);
    const days = it ? String(it.days ?? '') : '';
    out.push(flow(107.04, 398.88, 12, 'hb', [
      box(!!it), 1, '결석', 1, `${s0.y || baseYear}년`, ...fill(4, s0.m), '월', ...fill(5, s0.d), '일', 2, '부터', 2,
      `${e0.y || baseYear}년`, ...fill(4, e0.m), '월', ...fill(5, e0.d), '일', 1, '까지', 1,
      '(', ...(days ? [4 - len(days), days, 1] : [5]), '일)',
    ]));
  }

  // ── 2. 사유 — 양식 "(" + 빈칸 63 + ")". 예시 3장 모두 왼쪽 빈칸 = (63 - 사유 폭)/2 - 2.
  //    오른쪽은 예시마다 달라(+3, +4, +0) 왼쪽 + 2로 둔다.
  {
    const v = String(r.reason || '').trim();
    const u = [...v].reduce((a, ch) => a + (ch === ' ' ? 1 : new RegExp(`[${HANGUL}]`).test(ch) ? 1.94 : 1.1), 0);
    const left = Math.max(1, Math.floor((63 - u) / 2) - 2);
    out.push(flow(92.40, 424.68, 12, 'hb', ['2.', 1, '사유:', 1, '(', ...(v ? [left, v, left + 2] : [63]), ')']));
  }

  // ── 작성일 (굴림 12) — 양식 "2026·년······월······일", 예시 "2026·년···3·월····6·일", "···23·일"
  {
    const w = parts(r.written);
    out.push(flow(234.00, 468.72, 12, 'g', [
      `${w.y || baseYear}`, 1, '년', ...(w.m ? [4 - len(w.m), String(w.m), 1] : [6]), '월', ...(w.d ? [5 - len(w.d), String(w.d), 1] : [6]), '일',
    ]));
  }
  // ── 본인·보호자 — 양식 이름 칸 빈칸 17. 예시 "본··인·····LI·SHIYU···(인)", "본··인·KIM·VIKTORIYA·(인)"
  //    오른쪽 = (17 - 이름 폭)/2 - 1 (최소 1), 왼쪽 = 나머지
  const signName = v => {
    v = String(v || '').trim();
    if (!v) return [17];
    const u = [...v].reduce((a, ch) => a + (ch === ' ' ? 1 : new RegExp(`[${HANGUL}]`).test(ch) ? 2 : 1.1), 0);
    const right = Math.max(1, Math.floor((17 - u) / 2) - 1);
    return [Math.max(1, Math.floor(17 - u - right)), v, right];
  };
  out.push(flow(335.52, 495.84, 12, 'g', ['본', 2, '인', ...signName(r.selfName), '(인)']));
  out.push(flow(335.52, 519.84, 12, 'g', ['보호자', ...signName(r.guardianName), '(인)']));

  // ── 확인서 1. 확인방법 ──
  out.push(flow(107.52, 645.12, 12, 'hb', [box(r.method === '가정방문')]));
  out.push(flow(183.72, 645.12, 12, 'hb', [box(r.method === '전화연락')]));
  // 날짜·시·대화자 — 양식 "2026년····월·····일······시,··대화자·:", 예시 "2026년···3월····5일····13시,··대화자·:·아버님"
  {
    const cd = parts(r.confirmDate);
    out.push(flow(119.52, 663.12, 12, 'hb', [
      `${cd.y || baseYear}년`, ...fill(4, cd.m), '월', ...fill(5, cd.d), '일', ...fill(6, r.confirmHour), '시,', 2, '대화자', 1, ':',
      ...(r.talker ? [1, r.talker] : []),
    ]));
  }
  out.push(flow(107.52, 684.72, 12, 'hb', [
    box(r.method === '기타'), 1, '기', 4, '타', 1, ':', ...(r.method === '기타' && r.methodEtc ? [1, r.methodEtc] : []),
  ]));

  // ── 2. 첨부 — 한글처럼 줄을 나누고, 늘어난 줄만큼 아래를 내린다 ──
  const att = layoutAttach(r.attach, opts.measure);
  att.lines.forEach((ln, i) => out.push(flow(ln.x, ATTACH.y + i * att.lineGap, att.size, 'hb', ln.items)));
  const shift = num(Math.max(0, att.lines.length - 1) * att.lineGap);

  for (const run of MOVING) out.push(fixed(run, shift, opts));
  // 확인서 날짜 — 가운데 맞춤(원본 양식 줄 가운데 297.56). 예시 "2026·년····3·월····9·일", "····13·일"
  {
    const cn = parts(r.confirmedOn);
    out.push(flow(297.56, 750.36 + shift, 12, 'g', [
      `${cn.y || baseYear}`, 1, '년', ...(cn.m ? [4, String(cn.m), 1] : [6]), '월', ...(cn.d ? [4, String(cn.d), 1] : [6]), '일',
    ], 'middle'));
  }
  // 담임 — 양식 "학급·담임" + 빈칸 14 + "(인)", 예시 "학급·담임····오범석·····(인)"
  {
    const t = String(r.teacherName || '').trim();
    const u = [...t].reduce((a, ch) => a + (new RegExp(`[${HANGUL}]`).test(ch) ? 2 : 1.1), 0);
    out.push(flow(341.52, 773.16 + shift, 12, 'g', ['학급', 1, '담임', ...(t ? [4, t, Math.max(1, Math.round(11 - u))] : [14]), '(인)']));
  }

  // 담임 도장 — (인) 위에. 도장 그림은 설정에서 올린 PNG(주소 모양을 다시 확인한 것만 쓴다)
  if (opts.stamp && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(opts.stamp)) {
    out.push(`<image class="stamp" href="${opts.stamp}" x="478.8" y="${num(753.5 + shift)}" width="30" height="30" preserveAspectRatio="xMidYMid meet"/>`);
  }

  const circled = [...(r.cause === '출석인정' || r.cause === '질병' ? [r.cause] : []), ...circledKinds(r)];
  const svg = `<svg class="page" xmlns="http://www.w3.org/2000/svg" width="595.32pt" height="841.92pt" viewBox="0 0 595.32 841.92">` +
    drawLines(circled, shift) + out.join('') + `</svg>`;
  return `<div class="sheet" data-shift="${shift}" data-attach-lines="${att.lines.length}" data-attach-size="${att.size}"><div class="sheet-in">${svg}</div></div>`;
}
