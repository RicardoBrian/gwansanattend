/**
 * 출결 관리 — 화면.
 *
 * 흐름: 구글 로그인 → 허용된 계정인지 확인 → 내 반이 없으면 반 등록
 *       → 탭(출결 기록 · 신고서 · 명렬표 · 설정 · 관리)
 *
 * 데이터는 Firestore onSnapshot으로 구독한다. 다른 기기(폰)에서 고친 내용이
 * 새로고침 없이 바로 반영되고, 화면은 "상태 → 다시 그리기" 한 방향으로만 간다.
 */
import { CONFIGURED } from './firebase-config.js';
import * as store from './store.js';
import { renderSheet } from './form.js';
import { decodeCsv, parseRoster, TEMPLATE } from './csv.js';
import {
  today, shortLabel, countSchoolDays, offReason, addDays, isDateStr, schoolYearOf, HOLIDAYS, nowHour,
} from './dates.js';
import {
  KINDS, ITEM_KEYS, CONFIRM_METHODS,
  needsReport, typeLabel, periodParts, joinPeriod, periodLabel, emptyRecord, normalizeRecord, emptyReport, reportFromRecords, groupForReports,
} from './model.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = $('app');

const S = {
  user: null, admin: false,
  classes: [], cls: null,
  students: [], records: [], reports: [],
  tab: 'records',
  month: today().slice(0, 7), // 'YYYY-MM' 또는 'all'
  filterNo: '', todoOnly: false,
  printSel: new Set(),  // 신고서 선택(출력)
  unsubs: [],
  adminOnly: false,
  requests: [],         // 관리자: 승인 대기 신청
  myRequest: null,      // 담임: 새 학년도 반 신청(대기 중)
  authUnsubs: [],       // 로그인 단위 구독(내 신청서, 관리자 신청 목록) — 반을 바꿔도 유지
  loaded: { students: false, records: false, reports: false },
};

const CLASS_KEY = 'gwansanattend.classId';

// ── 공통 UI ─────────────────────────────────────────

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

function fail(e) {
  console.error(e);
  const msg = e?.code === 'permission-denied'
    ? '권한이 없습니다. 허용된 계정인지, 내 반이 맞는지 확인하세요.'
    : (e?.message || String(e));
  toast(msg);
}

function openModal(html, bind) {
  $('modalCard').innerHTML = html;
  $('modal').classList.remove('hidden');
  bind?.($('modalCard'));
}
function closeModal() {
  $('modal').classList.add('hidden');
  $('modalCard').innerHTML = '';
}
$('modal').addEventListener('mousedown', e => { if (e.target === $('modal')) closeModal(); });
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (!$('modal').classList.contains('hidden')) closeModal();
  else if (!$('editor').classList.contains('hidden')) closeEditor();
});

{
  const setDark = on => { document.body.classList.toggle('dark', on); try { localStorage.setItem('gwansanattend.dark', on ? '1' : '0'); } catch {} };
  let saved = null;
  try { saved = localStorage.getItem('gwansanattend.dark'); } catch {}
  setDark(saved === '1');
  $('darkToggle').onclick = () => setDark(!document.body.classList.contains('dark'));
}

/** 유형 고르기 순서: 신고서를 쓰는 것부터 */
const TYPE_ORDER = ['질병', '출석인정', '미인정', '기타'];

const studentLabel = s => `${s.no}번 ${s.name}`;
const byNo = no => S.students.find(s => s.no === no);
const offDays = () => S.cls?.offDays || [];

function rangeLabel(r) {
  if (r.kind === '결석' && r.end && r.end !== r.start) return `${shortLabel(r.start)}~<br>${shortLabel(r.end)}`;
  return shortLabel(r.start);
}

// ── 시작 ───────────────────────────────────────────

if (!CONFIGURED) {
  app.innerHTML = `<div class="auth-card"><div class="auth-head"><div class="auth-word">설정이 필요합니다</div>
    <div class="auth-sub">public/firebase-config.js 에 Firebase 설정값을 넣어 주세요.<br>README의 "처음 설정" 순서를 따라 하면 됩니다.</div></div></div>`;
} else {
  store.watchAuth(onAuth);
}

$('btnLogout').onclick = async () => {
  await store.signOut();
  location.reload();
};

async function onAuth(user) {
  stopWatching();
  S.authUnsubs.forEach(u => u());
  S.authUnsubs = [];
  S.user = user;
  $('btnLogout').classList.toggle('hidden', !user);
  $('navEmail').textContent = user?.email || '';
  $('classPill').classList.add('hidden');
  if (!user) return renderLogin();

  app.innerHTML = '<div class="center-msg">권한 확인 중…</div>';
  try {
    const acc = await store.checkAccess(user);
    S.admin = acc.admin;
    if (!acc.allowed) return renderRequest();
    if (S.admin) {
      S.authUnsubs.push(store.watchRequests(list => {
        S.requests = list.sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
        render();
      }, fail));
    }
    S.classes = await store.myClasses();
  } catch (e) {
    fail(e);
    app.innerHTML = `<div class="center-msg">불러오지 못했습니다. 새로고침해 주세요.<br><small>${esc(e.message)}</small></div>`;
    return;
  }
  if (!S.classes.length) return renderRequest();
  // 새 학년도 반 신청을 해 둔 경우: 승인되면 반 목록을 새로 받는다.
  let hadReq = false;
  S.authUnsubs.push(store.watchMyRequest(async rq => {
    S.myRequest = rq;
    if (!rq && hadReq) {
      const before = new Set(S.classes.map(c => c.id));
      S.classes = await store.myClasses().catch(() => S.classes);
      const added = S.classes.find(c => !before.has(c.id));
      toast(added ? `${added.grade}학년 ${added.cls}반이 승인되었습니다. 위쪽 반 이름을 눌러 바꿀 수 있습니다.` : '새 반 신청이 거절되었습니다.');
    }
    hadReq = !!rq;
  }, fail));
  let want = null;
  try { want = localStorage.getItem(CLASS_KEY); } catch {}
  enterClass(S.classes.find(c => c.id === want) || S.classes[0]);
}

function renderLogin() {
  app.innerHTML = `
    <div class="auth-card">
      <div class="auth-head">
        <img class="auth-logo" src="logo.png" alt="">
        <div class="auth-word">출결 관리</div>
        <div class="auth-sub">출결 기록 · 결석신고서 출력</div>
      </div>
      <button class="auth-btn" id="btnLogin">Google 계정으로 로그인</button>
      <p class="hint" style="margin-top:16px;text-align:center;">처음이면 로그인 후 학년·반을 적어 승인을 신청합니다.<br>
      카카오톡·네이버 앱 안에서 열었다면 Chrome·Safari로 다시 열어 주세요.</p>
    </div>`;
  $('btnLogin').onclick = () => store.signIn().catch(fail);
}

/**
 * 맡은 반이 없는 계정: 학년·반·이름으로 승인 신청.
 * 반은 관리자 승인으로만 생긴다(규칙도 그렇게 막는다) — 아무 반이나 먼저 차지하거나,
 * 담임 교체로 등록 해제된 반을 다른 선생님이 가로채 학생 기록을 보는 일을 막기 위해서다.
 * 승인되면 신청서가 지워지고(허용 등록 + 반 지정과 같은 배치), 그걸 구독으로 감지해
 * 다시 확인한다 — 새로고침 없이 바로 반 화면으로.
 */
function renderRequest() {
  let had = false;
  S.authUnsubs.push(store.watchMyRequest(async rq => {
    if (!rq && had) {
      // 승인 또는 거절 — 반이 생겼는지로 갈라 준다.
      had = false;
      try {
        const a = await store.checkAccess(S.user);
        const mine = a.allowed ? await store.myClasses() : [];
        if (mine.length) onAuth(S.user);
        else drawRequestForm('신청이 거절되었습니다. 내용을 확인해 다시 신청하거나 관리자에게 문의하세요.');
      } catch (e) { fail(e); }
      return;
    }
    had = !!rq;
    rq ? drawPending(rq) : drawRequestForm();
  }, fail));
}

function drawRequestForm(note = '') {
  app.innerHTML = `
    <div class="auth-card" style="max-width:520px;">
      <div class="auth-head"><div class="auth-word">사용 신청</div>
        <div class="auth-sub">${esc(S.user.email)}</div></div>
      ${note ? `<p class="hint warn" style="text-align:center;">${esc(note)}</p>` : ''}
      ${setupForm()}
      <button class="auth-btn" id="rqGo">승인 신청</button>
      ${S.admin ? '<button class="btn ghost" id="suAdmin" style="display:block;margin:12px auto 0;">반 없이 관리 화면만 보기</button>' : ''}
      <button class="btn ghost" id="rqOut" style="display:block;margin:12px auto 0;">다른 계정으로 로그인</button>
    </div>`;
  $('rqOut').onclick = () => store.signOut();
  $('suAdmin')?.addEventListener('click', () => { S.adminOnly = true; render(); });
  $('rqGo').onclick = async () => {
    const year = +$('suYear').value, grade = +$('suGrade').value, cls = +$('suCls').value;
    const name = $('suName').value.trim();
    if (!name) return toast('담임 이름을 입력하세요.');
    $('rqGo').disabled = true;
    // 이미 등록된 반인지는 여기서 확인하지 않는다 — 승인 전 계정에게 반 등록 현황을
    // 보여 주지 않기 위해서다. 겹치면 관리자 화면에 표시되고 승인 버튼이 막힌다.
    try {
      await store.submitRequest({ year, grade, cls, name });
    } catch (e) { fail(e); $('rqGo').disabled = false; }
  };
}

function drawPending(rq) {
  app.innerHTML = `
    <div class="auth-card" style="max-width:520px;">
      <div class="auth-head"><div class="auth-word">승인 대기 중</div>
        <div class="auth-sub">${esc(S.user.email)}</div></div>
      <p style="text-align:center;font-weight:700;">${rq.year}학년도 ${rq.grade}학년 ${rq.cls}반 · ${esc(rq.name)} 선생님</p>
      <p class="hint" style="text-align:center;">관리자가 승인하면 이 화면이 자동으로 바뀝니다. 창을 닫았다가 나중에 다시 와도 됩니다.<br>
      학생 정보 보호를 위해 승인된 계정만 사용할 수 있습니다.</p>
      <button class="btn" id="rqCancel" style="display:block;margin:16px auto 0;">신청 취소하고 다시 쓰기</button>
      ${S.admin ? '<button class="btn ghost" id="suAdmin" style="display:block;margin:12px auto 0;">관리 화면 보기 (내 신청도 거기서 승인)</button>' : ''}
    </div>`;
  $('suAdmin')?.addEventListener('click', () => { S.adminOnly = true; render(); });
  $('rqCancel').onclick = async () => {
    try {
      // 취소로 지워지는 건 승인과 구분해야 한다 — 구독을 먼저 끊어 승인으로 오인하지 않게.
      S.authUnsubs.forEach(u => u());
      S.authUnsubs = [];
      await store.cancelRequest();
      renderRequest();
    } catch (e) { fail(e); }
  };
}

// ── 반 등록 ─────────────────────────────────────────

function setupForm() {
  const y = schoolYearOf(today());
  const opt = (n, sel) => `<option value="${n}" ${n === sel ? 'selected' : ''}>${n}</option>`;
  return `
    <div class="grid3">
      <div class="field"><label>학년도</label><select class="inp" id="suYear">${[y - 1, y, y + 1].map(v => opt(v, y)).join('')}</select></div>
      <div class="field"><label>학년</label><select class="inp" id="suGrade">${[1, 2, 3].map(v => opt(v, 1)).join('')}</select></div>
      <div class="field"><label>반</label><select class="inp" id="suCls">${Array.from({ length: 15 }, (_, i) => opt(i + 1, 1)).join('')}</select></div>
    </div>
    <div class="field"><label>담임 이름 (확인서에 인쇄)</label><input class="inp" id="suName" maxlength="20" placeholder="예: 홍길동"></div>
    <p class="hint">관리자가 승인하면 그 반의 담임이 됩니다. 한 반은 선생님 한 분만 맡을 수 있고, 담임만 그 반 학생과 출결 기록을 볼 수 있습니다.</p>`;
}

$('classPill').onclick = () => {
  openModal(`
    <h2>반 선택</h2>
    <div class="list">${S.classes.map(c => `
      <div class="row" data-cid="${esc(c.id)}" style="grid-template-columns:1fr auto;">
        <div class="main"><div class="who">${c.year}학년도 ${c.grade}학년 ${c.cls}반</div><div class="sub">${esc(c.teacherName)}</div></div>
        <div class="flags">${c.id === S.cls?.id ? '<span class="chip ok">보는 중</span>' : ''}</div>
      </div>`).join('')}</div>
    <h3>새 반 신청 (새 학년도 등)</h3>
    ${S.myRequest
      ? `<p><b>${S.myRequest.year}학년도 ${S.myRequest.grade}학년 ${S.myRequest.cls}반</b> 승인 대기 중입니다.</p>
         <div class="actions"><button class="btn" id="mClose">닫기</button><button class="btn danger" id="rqCancel2">신청 취소</button></div>`
      : `${setupForm()}
         <div class="actions"><button class="btn" id="mClose">닫기</button><button class="btn accent" id="rqGo2">승인 신청</button></div>`}`,
  root => {
    root.querySelectorAll('[data-cid]').forEach(el => el.onclick = () => {
      closeModal();
      enterClass(S.classes.find(c => c.id === el.dataset.cid));
    });
    root.querySelector('#mClose').onclick = closeModal;
    root.querySelector('#rqCancel2')?.addEventListener('click', () => store.cancelRequest().then(closeModal).catch(fail));
    root.querySelector('#suName')?.setAttribute('value', S.cls?.teacherName || '');
    root.querySelector('#rqGo2')?.addEventListener('click', async e => {
      const v = id => root.querySelector('#' + id).value;
      const name = v('suName').trim();
      if (!name) return toast('담임 이름을 입력하세요.');
      e.target.disabled = true;
      try {
        await store.submitRequest({ year: +v('suYear'), grade: +v('suGrade'), cls: +v('suCls'), name });
        closeModal();
        toast('신청했습니다. 관리자가 승인하면 알려 드립니다.');
      } catch (err) { fail(err); e.target.disabled = false; }
    });
  });
};

// ── 반 들어가기 · 구독 ───────────────────────────────

function stopWatching() {
  S.unsubs.forEach(u => u());
  S.unsubs = [];
}

function enterClass(c, tab) {
  stopWatching();
  S.cls = c;
  S.students = []; S.records = []; S.reports = [];
  S.loaded = { students: false, records: false, reports: false };
  S.printSel.clear();
  if (tab) S.tab = tab;
  try { localStorage.setItem(CLASS_KEY, c.id); } catch {}
  $('classPill').textContent = `${c.grade}학년 ${c.cls}반`;
  $('classPill').classList.remove('hidden');

  const onErr = e => { fail(e); };
  S.unsubs.push(
    store.watchClass(c.id, data => {
      if (!data) { // 관리자가 등록 해제했거나 학년 말 삭제
        toast('이 반 등록이 해제되었습니다.');
        setTimeout(() => location.reload(), 1200);
        return;
      }
      S.cls = data;
      render();
    }, onErr),
    store.watchSub(c.id, 'students', list => { S.students = list.sort((a, b) => a.no - b.no); S.loaded.students = true; render(); }, onErr),
    store.watchSub(c.id, 'records', list => { S.records = list; S.loaded.records = true; render(); }, onErr),
    store.watchSub(c.id, 'reports', list => { S.reports = list; S.loaded.reports = true; render(); }, onErr),
  );
  render();
}

// ── 메인 화면 ───────────────────────────────────────

const TABS = [
  ['records', '출결 기록'],
  ['reports', '신고서'],
  ['students', '명렬표'],
  ['settings', '설정'],
  ['admin', '관리'],
];

/** 아직 만들지 않은 신고서 장수(이어진 기록은 한 장) — 탭 배지와 안내 문구가 같은 숫자를 쓴다 */
function todoCount() {
  return groupForReports(S.records, offDays()).length;
}

let renderQueued = false;
function render() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (!S.cls) {
      // 담임 반이 없는 관리자: 관리 탭만
      if (S.adminOnly) { app.innerHTML = '<div id="tabBody"></div>'; S.tab = 'admin'; renderAdmin($('tabBody')); }
      return;
    }
    const y = window.scrollY;
    const n = todoCount();
    app.innerHTML = `
      <div class="tabs">${TABS.filter(([k]) => k !== 'admin' || S.admin).map(([k, label]) => `
        <button class="tab ${S.tab === k ? 'on' : ''}" data-tab="${k}">${label}${k === 'reports' && n ? ` <span class="badge" title="아직 만들지 않은 신고서">${n}</span>` : ''}${k === 'admin' && S.requests.length ? ` <span class="badge" title="승인 대기">${S.requests.length}</span>` : ''}</button>`).join('')}
      </div>
      <div id="tabBody"></div>`;
    app.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; render(); });
    const body = $('tabBody');
    ({ records: renderRecords, reports: renderReports, students: renderStudents, settings: renderSettings, admin: renderAdmin })[S.tab](body);
    window.scrollTo(0, y);
  });
}

function monthNav() {
  const label = S.month === 'all' ? '전체 기간' : `${+S.month.slice(0, 4)}년 ${+S.month.slice(5)}월`;
  return `<div class="monthnav">
    <button class="icon-btn" data-mon="-1" title="이전 달"><svg width="16" height="16"><use href="#ic-left"/></svg></button>
    <span class="label">${label}</span>
    <button class="icon-btn" data-mon="1" title="다음 달"><svg width="16" height="16"><use href="#ic-right"/></svg></button>
    <button class="btn sm ghost" data-mon="all">${S.month === 'all' ? '이번 달' : '전체'}</button>
  </div>`;
}

function bindMonthNav(root) {
  root.querySelectorAll('[data-mon]').forEach(b => b.onclick = () => {
    const v = b.dataset.mon;
    if (v === 'all') S.month = S.month === 'all' ? today().slice(0, 7) : 'all';
    else {
      const base = S.month === 'all' ? today().slice(0, 7) : S.month;
      let [y, m] = base.split('-').map(Number);
      m += +v;
      if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
      S.month = `${y}-${String(m).padStart(2, '0')}`;
    }
    S.printSel.clear();
    render();
  });
}

/** 기간이 이 달과 겹치면 보인다 (3/30~4/2 결석은 3월·4월 둘 다). */
function inMonth(start, end) {
  if (S.month === 'all') return true;
  const first = `${S.month}-01`, last = `${S.month}-31`;
  return start <= last && (end || start) >= first;
}

function studentOptions(selected, includeName) {
  const opts = S.students.map(s => `<option value="${s.no}" ${s.no === selected ? 'selected' : ''}>${esc(studentLabel(s))}</option>`);
  if (selected && !byNo(selected)) opts.unshift(`<option value="${selected}" selected>${selected}번 ${esc(includeName || '')} (명렬표에 없음)</option>`);
  return `<option value="">학생 선택</option>${opts.join('')}`;
}

// ── 출결 기록 탭 ─────────────────────────────────────

function renderRecords(body) {
  const list = S.records
    .filter(r => inMonth(r.start, r.end))
    .filter(r => !S.filterNo || r.no === +S.filterNo)
    .filter(r => !S.todoOnly || (needsReport(r.cause) && !r.reportId) || !r.neis || (r.docs?.length && !r.docsIn))
    .sort((a, b) => (b.start.localeCompare(a.start)) || (a.no - b.no));

  const noRoster = S.loaded.students && !S.students.length;
  const groups = monthGroups();
  body.innerHTML = `
    ${noRoster ? `<div class="card"><b>명렬표가 비어 있습니다.</b> <span class="hint">명렬표 탭에서 CSV를 먼저 올려 주세요. 등록된 학생만 기록할 수 있습니다.</span>
      <div class="actions" style="justify-content:flex-start;margin-top:10px;"><button class="btn sm accent" data-go="students">명렬표 올리기</button></div></div>` : ''}
    <div class="toolbar">
      <button class="btn accent" id="btnNewRec" ${noRoster ? 'disabled' : ''}><svg width="13" height="13" style="vertical-align:-2px;margin-right:2px;"><use href="#ic-plus"/></svg>기록 추가</button>
      ${monthNav()}
      <span class="grow"></span>
      <select class="inp" id="fNo">${`<option value="">전체 학생</option>` + S.students.map(s => `<option value="${s.no}" ${String(s.no) === String(S.filterNo) ? 'selected' : ''}>${esc(studentLabel(s))}</option>`).join('')}</select>
      <label class="check" style="margin:0;" title="신고서·서류·나이스 중 처리 안 된 것이 있는 기록만"><input type="checkbox" id="fTodo" ${S.todoOnly ? 'checked' : ''}>미처리만</label>
    </div>
    ${groups.length ? `<div class="notice">
      <span><b>신고서 ${groups.length}장</b>을 아직 만들지 않았습니다 <span class="hint">(${S.month === 'all' ? '전체 기간' : '이 달'})</span></span>
      <button class="btn sm accent" id="btnBulk"><svg width="14" height="14" style="vertical-align:-2px;margin-right:3px;"><use href="#ic-doc"/></svg>한 번에 만들기</button>
    </div>` : ''}
    <div class="list">
      ${!S.loaded.records ? '<div class="empty">불러오는 중…</div>' : list.length ? list.map(recordRow).join('') : '<div class="empty">기록이 없습니다.</div>'}
    </div>`;

  body.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { S.tab = b.dataset.go; render(); });
  bindMonthNav(body);
  $('fNo').onchange = e => { S.filterNo = e.target.value; render(); };
  $('fTodo').onchange = e => { S.todoOnly = e.target.checked; render(); };
  $('btnNewRec').onclick = () => openRecord(null);
  $('btnBulk')?.addEventListener('click', () => makeGroups(groups));
  body.querySelectorAll('.row[data-id]').forEach(row => {
    const id = row.dataset.id;
    row.onclick = e => {
      if (e.target.closest('button')) return;
      openRecord(S.records.find(r => r.id === id));
    };
    row.querySelector('[data-neis]')?.addEventListener('click', () => {
      const r = S.records.find(x => x.id === id);
      store.setRecordFlag(S.cls.id, id, { neis: !r.neis }).catch(fail);
    });
    row.querySelector('[data-docs]')?.addEventListener('click', () => {
      const r = S.records.find(x => x.id === id);
      store.setRecordFlag(S.cls.id, id, { docsIn: !r.docsIn }).catch(fail);
    });
    row.querySelector('[data-report]')?.addEventListener('click', () => {
      const r = S.records.find(x => x.id === id);
      const rep = S.reports.find(p => p.id === r.reportId);
      if (rep) openEditor(rep);
      else editForRecord(r);
    });
  });
}

function recordRow(r) {
  const detail = r.kind === '결석' ? `${r.days ?? '?'}일` : periodLabel(r);
  const reportChip = !needsReport(r.cause) ? ''
    : r.reportId && S.reports.some(p => p.id === r.reportId)
      ? '<button class="chip ok" data-report title="신고서 열기"><svg width="12" height="12"><use href="#ic-doc"/></svg>신고서 ✓</button>'
      : '<button class="chip todo" data-report title="이 기록(이어진 기록 포함)으로 신고서 작성"><svg width="12" height="12"><use href="#ic-doc"/></svg>신고서 작성</button>';
  const docsChip = r.docs?.length
    ? `<button class="chip ${r.docsIn ? 'ok' : 'todo'}" data-docs title="눌러서 제출 여부 바꾸기">${r.docsIn ? '서류 ✓' : '서류 미제출'}</button>` : '';
  return `
    <div class="row rec" data-id="${esc(r.id)}">
      <span class="date">${rangeLabel(r)}</span>
      <div class="main">
        <div class="who">${r.no}번 ${esc(r.name)} <span class="chip c-${esc(r.cause)}">${esc(typeLabel(r))}</span> <span class="hint">${esc(detail)}</span></div>
        <div class="sub">${esc(r.reason || '사유 없음')}${r.docs?.length ? ' · ' + esc(r.docs.join(', ')) : ''}${r.memo ? ' · ' + esc(r.memo) : ''}</div>
      </div>
      <div class="flags">${docsChip}${reportChip}
        <button class="chip ${r.neis ? 'ok' : ''}" data-neis title="눌러서 나이스 입력 여부 바꾸기">${r.neis ? '나이스 ✓' : '나이스 미입력'}</button>
      </div>
    </div>`;
}

// ── 출결 기록 편집 ───────────────────────────────────

/** 종류마다 교시 입력 모양이 다르다: 지각 [ ]교시 등교 / 조퇴 [ ]교시부터 조퇴 / 결과 [ ]교시부터 [ ]교시까지 */
function periodInputs(r) {
  const { from, to } = periodParts(r.period);
  const box = (id, v) => `<input class="inp period-inp" id="${id}" maxlength="4" inputmode="numeric" value="${esc(v)}">`;
  if (r.kind === '지각') return `<label>교시</label><div class="period-line">${box('rPFrom', from)}<span>교시에 등교</span></div>`;
  if (r.kind === '조퇴') return `<label>교시</label><div class="period-line">${box('rPFrom', from)}<span>교시부터 조퇴</span></div>`;
  return `<label>교시</label><div class="period-line">${box('rPFrom', from)}<span>교시부터</span>${box('rPTo', from === to ? '' : to)}<span>교시까지</span></div>`;
}

function openRecord(existing) {
  const r = existing ? { ...existing, docs: [...(existing.docs || [])] } : emptyRecord();
  if (!existing && S.filterNo) {
    const s = byNo(+S.filterNo);
    if (s) { r.no = s.no; r.name = s.name; }
  }
  let daysManual = !!existing && existing.kind === '결석' && existing.days !== countSchoolDays(existing.start, existing.end, offDays());

  const html = () => `
    <h2>${existing ? '출결 기록 수정' : '출결 기록 추가'}</h2>
    <div class="field"><label>학생</label><select class="inp" id="rNo">${studentOptions(r.no, r.name)}</select></div>
    <div class="field"><label>유형</label><select class="inp" id="rType">${TYPE_ORDER.map(c => `
      <optgroup label="${c}">${KINDS.map(k => `<option value="${c}|${k}" ${r.cause === c && r.kind === k ? 'selected' : ''}>${c} ${k}</option>`).join('')}</optgroup>`).join('')}
    </select></div>
    ${r.kind === '결석' ? `
      <div class="grid3">
        <div class="field"><label>시작일</label><input class="inp" type="date" id="rStart" value="${esc(r.start)}"></div>
        <div class="field"><label>종료일</label><input class="inp" type="date" id="rEnd" min="${esc(r.start)}" value="${esc(r.end || r.start)}"></div>
        <div class="field"><label>일수</label><input class="inp" type="number" min="0" max="400" id="rDays" value="${esc(r.days ?? '')}"></div>
      </div>
      <p class="hint" id="rDaysNote" style="margin-top:-6px;"></p>` : `
      <div class="grid2">
        <div class="field"><label>날짜</label><input class="inp" type="date" id="rStart" value="${esc(r.start)}"></div>
        <div class="field">${periodInputs(r)}</div>
      </div>
      <p class="hint" id="rDaysNote" style="margin-top:-6px;"></p>`}
    <div class="field"><label>사유</label><input class="inp" id="rReason" maxlength="200" placeholder="예: 감기, 치과진료" value="${esc(r.reason)}"></div>
    ${needsReport(r.cause) ? `
    <section class="sub-box"><div class="zone-title">신고서용 <span class="hint">— 결석신고서 아래 확인서·첨부에 들어갑니다</span></div>
    <div class="field"><span class="lab">보호자 확인</span>
      <div class="seg" id="rMethod">${CONFIRM_METHODS.map(k => `<button data-v="${k}" class="${r.method === k ? 'on' : ''}">${k}</button>`).join('')}</div>
      ${r.method ? `
      ${r.method === '기타' ? `<input class="inp" style="margin-top:8px;" id="rMethodEtc" maxlength="60" placeholder="확인 방법" value="${esc(r.methodEtc)}">` : ''}
      <div class="grid3" style="margin-top:8px;">
        <div><input class="inp" type="date" id="rConfDate" value="${esc(r.confirmDate)}" title="확인 날짜"></div>
        <div class="inline"><input class="inp" id="rConfHour" maxlength="10" inputmode="numeric" value="${esc(r.confirmHour)}" title="확인 시각"><span>시</span></div>
        <div><input class="inp" id="rTalker" maxlength="30" placeholder="대화자" value="${esc(r.talker)}"></div>
      </div>` : ''}
    </div>
    <div class="field" style="margin-bottom:0;"><span class="lab">첨부 서류</span>
      <textarea class="inp" id="rDocs" rows="2" maxlength="400" placeholder="예: 진료확인서 / 담임확인서(상기명 학생은 …)">${esc((r.docs || []).join(', '))}</textarea></div>
    </section>` : ''}
    ${existing?.reportId ? '<p class="hint">이 기록으로 만든 신고서가 있습니다. 기록을 고쳐도 신고서는 따로 고쳐야 합니다.</p>' : ''}
    <div class="actions">
      ${existing ? '<button class="btn danger left" id="rDel">삭제</button>' : ''}
      <button class="btn" id="rCancel">취소</button>
      ${needsReport(r.cause) && !existing?.reportId ? '<button class="btn" id="rSaveRep"><svg width="14" height="14" style="vertical-align:-2px;margin-right:3px;"><use href="#ic-doc"/></svg>저장 후 신고서 작성</button>' : ''}
      <button class="btn accent" id="rSave">저장</button>
    </div>`;

  const read = root => {
    const v = id => root.querySelector('#' + id);
    const no = +v('rNo').value || null;
    r.no = no;
    r.name = byNo(no)?.name || (no === existing?.no ? existing.name : '');
    r.start = v('rStart').value;
    if (r.kind === '결석') { r.end = v('rEnd').value || r.start; r.days = v('rDays').value; }
    else r.period = r.kind === '결과' ? joinPeriod(v('rPFrom').value, v('rPTo').value) : v('rPFrom').value.trim();
    r.reason = v('rReason').value.trim();
    // 신고서용 칸은 질병·출석인정일 때만 화면에 있다 — 없을 때는 값을 그대로 둔다.
    if (v('rDocs')) {
      const docs = v('rDocs').value.trim();
      r.docs = docs ? [docs] : [];
    }
    if (r.method && v('rConfDate')) {
      r.methodEtc = v('rMethodEtc')?.value.trim() || '';
      r.confirmDate = v('rConfDate').value;
      r.confirmHour = v('rConfHour').value.trim();
      r.talker = v('rTalker').value.trim();
    }
  };

  const draw = () => openModal(html(), bind);

  function updateDays(root) {
    const note = root.querySelector('#rDaysNote');
    const start = root.querySelector('#rStart').value;
    if (r.kind !== '결석') {
      const why = isDateStr(start) && offReason(start, offDays());
      note.textContent = why ? `※ ${shortLabel(start)}은(는) ${why}입니다.` : '';
      return;
    }
    const end = root.querySelector('#rEnd').value || start;
    if (!isDateStr(start) || !isDateStr(end) || end < start) { note.textContent = '종료일이 시작일보다 빠릅니다.'; return; }
    const auto = countSchoolDays(start, end, offDays());
    if (!daysManual) root.querySelector('#rDays').value = auto;
    const skipped = [];
    for (let d = start; d <= end && skipped.length < 40; d = addDays(d, 1)) {
      const why = offReason(d, offDays());
      if (why && why !== '주말') skipped.push(`${shortLabel(d)} ${why}`);
    }
    note.textContent = `주말·공휴일 빼고 ${auto}일` + (skipped.length ? ` (제외: ${skipped.join(', ')})` : '') + (daysManual ? ' — 직접 입력한 값을 씁니다.' : '');
  }

  function bind(root) {
    const q = s => root.querySelector(s);
    q('#rType').onchange = e => {
      read(root);
      const [cause, kind] = e.target.value.split('|');
      const kindChanged = kind !== r.kind;
      r.cause = cause; r.kind = kind;
      if (kindChanged) {
        daysManual = false;
        Object.assign(r, normalizeRecord(r));
        if (r.kind === '결석') r.days = countSchoolDays(r.start, r.end, offDays());
      }
      draw();
    };
    // 시작일을 바꾸면 종료일·보호자 확인 날짜를 같이 옮긴다 — 지난 기록을 쓸 때 종료일 달력이
    // 오늘 달에서 열리지 않도록. 종료일을 따로 고쳐 둔 경우(시작일과 달랐던 경우)는 그대로 둔다.
    let prevStart = q('#rStart').value;
    q('#rStart').oninput = () => {
      const start = q('#rStart').value;
      const e = q('#rEnd');
      if (e) {
        if (!e.value || e.value < start || e.value === prevStart) e.value = start;
        e.min = start;
      }
      const c = q('#rConfDate');
      if (c && (!c.value || c.value === prevStart)) c.value = start;
      prevStart = start;
      updateDays(root);
    };
    q('#rEnd')?.addEventListener('input', () => updateDays(root));
    q('#rDays')?.addEventListener('input', () => { daysManual = true; updateDays(root); });
    // 확인 방법을 누르면 날짜는 시작일로, 시각은 오늘 기록이면 "지금"으로 채운다. 다시 누르면 해제.
    q('#rMethod')?.querySelectorAll('button').forEach(b => b.onclick = () => {
      read(root);
      if (r.method === b.dataset.v) {
        Object.assign(r, { method: '', methodEtc: '', confirmDate: '', confirmHour: '', talker: '' });
      } else {
        if (!r.method) {
          r.confirmDate = r.start || today();
          r.confirmHour = r.confirmDate === today() ? nowHour() : '';
        }
        r.method = b.dataset.v;
      }
      draw();
    });
    q('#rCancel').onclick = closeModal;
    q('#rDel')?.addEventListener('click', async () => {
      const linked = existing.reportId && S.reports.some(p => p.id === existing.reportId);
      if (!confirm(`${existing.name} ${rangeLabel(existing).replace('<br>', '')} ${typeLabel(existing)} 기록을 삭제할까요?`
        + (linked ? '\n\n이 기록으로 만든 신고서는 지워지지 않으니, 필요 없으면 신고서 탭에서 따로 지우세요.' : ''))) return;
      try { await store.deleteRecord(S.cls.id, existing.id); closeModal(); toast('삭제했습니다.'); }
      catch (e) { fail(e); }
    });
    const save = async thenReport => {
      read(root);
      if (!r.no) return toast('학생을 선택하세요.');
      if (!r.name) return toast('명렬표에 없는 학생입니다.');
      if (!isDateStr(r.start)) return toast('날짜를 입력하세요.');
      if (r.kind === '결석' && (!isDateStr(r.end) || r.end < r.start)) return toast('종료일을 확인하세요.');
      const rec = normalizeRecord(r);
      if (rec.kind === '결석' && (rec.days === '' || rec.days == null)) rec.days = countSchoolDays(rec.start, rec.end, offDays());
      try {
        const id = await store.saveRecord(S.cls.id, rec);
        closeModal();
        toast('저장했습니다.');
        if (thenReport) editForRecord({ ...rec, id });
      } catch (e) { fail(e); }
    };
    q('#rSave').onclick = () => save(false);
    q('#rSaveRep')?.addEventListener('click', () => save(true));
    updateDays(root);
  }

  draw();
}

// ── 신고서 탭 ───────────────────────────────────────

function reportDates(p) {
  const it = p.items || {};
  return [it.late?.date, it.early?.date, it.result?.date, it.absent?.start, it.absent?.end].filter(Boolean).sort();
}

/** 신고서 목록의 날짜 칸: 출결 날짜(기간이면 시작~끝) */
function reportDateLabel(p) {
  const d = reportDates(p);
  if (!d.length) return shortLabel(p.written);
  return d[0] === d.at(-1) ? shortLabel(d[0]) : `${shortLabel(d[0])}~<br>${shortLabel(d.at(-1))}`;
}

function reportSummary(p) {
  const it = p.items || {};
  const parts_ = [];
  if (it.late) parts_.push(`지각 ${shortLabel(it.late.date)}`);
  if (it.early) parts_.push(`조퇴 ${shortLabel(it.early.date)}`);
  if (it.result) parts_.push(`결과 ${shortLabel(it.result.date)}`);
  if (it.absent) parts_.push(`결석 ${shortLabel(it.absent.start)}${it.absent.end !== it.absent.start ? '~' + shortLabel(it.absent.end) : ''} (${it.absent.days}일)`);
  return parts_.join(', ') || '기간 없음';
}

function renderReports(body) {
  const list = S.reports
    .filter(p => { const d = reportDates(p); return d.length ? inMonth(d[0], d.at(-1)) : inMonth(p.written, p.written); })
    .filter(p => !S.filterNo || p.no === +S.filterNo)
    .sort((a, b) => (reportDates(b)[0] || b.written).localeCompare(reportDates(a)[0] || a.written) || a.no - b.no);
  const todo = todoCount();

  body.innerHTML = `
    <div class="toolbar">
      ${monthNav()}
      <span class="grow"></span>
      <select class="inp" id="fNo">${`<option value="">전체 학생</option>` + S.students.map(s => `<option value="${s.no}" ${String(s.no) === String(S.filterNo) ? 'selected' : ''}>${esc(studentLabel(s))}</option>`).join('')}</select>
      <button class="btn sm" id="btnAllPrint" ${list.length ? '' : 'disabled'}><svg width="14" height="14" style="vertical-align:-2px;margin-right:3px;"><use href="#ic-print"/></svg>이 목록 모두 출력</button>
    </div>
    ${todo ? `<div class="notice">
      <span><b>신고서 ${todo}장</b>을 아직 만들지 않았습니다 <span class="hint">(전체 기간, 이어진 기록은 한 장으로)</span></span>
      <button class="btn sm accent" id="todoBulk"><svg width="14" height="14" style="vertical-align:-2px;margin-right:3px;"><use href="#ic-doc"/></svg>모두 만들기</button>
    </div>` : ''}
    <div class="list">
      ${!S.loaded.reports ? '<div class="empty">불러오는 중…</div>' : list.length ? list.map(p => `
        <div class="row" data-id="${esc(p.id)}">
          <span><input type="checkbox" ${S.printSel.has(p.id) ? 'checked' : ''} title="출력할 신고서 선택"></span>
          <span class="date">${reportDateLabel(p)}</span>
          <div class="main">
            <div class="who">${p.no}번 ${esc(p.name)} <span class="chip c-${esc(p.cause)}">${esc(p.cause)}</span></div>
            <div class="sub">${esc(reportSummary(p))} · ${esc(p.reason || '사유 없음')} · <span class="hint">작성 ${shortLabel(p.written)}</span></div>
          </div>
          <div class="flags"><button class="chip" data-print title="이 신고서 출력"><svg width="12" height="12"><use href="#ic-print"/></svg>출력</button></div>
        </div>`).join('') : '<div class="empty">신고서가 없습니다.</div>'}
    </div>
    <p class="hint" style="margin-top:14px;">출결 기록 없이 신고서만 만들려면 <button class="linkish" id="btnNewRep">빈 신고서</button></p>
    ${S.printSel.size ? `<div class="selbar"><span>${S.printSel.size}장 선택</span>
      <span><button class="btn sm ghost" id="selClear">선택 해제</button>
      <button class="btn sm accent" id="selPrint">한 번에 출력</button></span></div>` : ''}`;

  bindMonthNav(body);
  $('todoBulk')?.addEventListener('click', () => makeGroups(groupForReports(S.records, offDays())));
  $('fNo').onchange = e => { S.filterNo = e.target.value; render(); };
  $('btnAllPrint').onclick = () => printReports(list);
  $('btnNewRep').onclick = pickStudentForReport;
  body.querySelectorAll('.row[data-id]').forEach(row => {
    const p = S.reports.find(x => x.id === row.dataset.id);
    row.onclick = e => { if (!e.target.closest('input,button')) openEditor(p); };
    row.querySelector('input[type=checkbox]').onchange = e => { e.target.checked ? S.printSel.add(p.id) : S.printSel.delete(p.id); render(); };
    row.querySelector('[data-print]').onclick = () => printReports([p]);
  });
  $('selClear')?.addEventListener('click', () => { S.printSel.clear(); render(); });
  $('selPrint')?.addEventListener('click', () => printReports(list.filter(p => S.printSel.has(p.id))));
}

function pickStudentForReport() {
  if (!S.students.length) return toast('명렬표를 먼저 올려 주세요.');
  openModal(`
    <h2>빈 신고서</h2>
    <div class="field"><label>학생</label><select class="inp" id="pNo">${studentOptions(null)}</select></div>
    <p class="hint">출결 기록 없이 신고서만 만듭니다. 기록과 연결하려면 출결 기록 탭에서 만드세요.</p>
    <div class="actions"><button class="btn" id="pCancel">취소</button><button class="btn accent" id="pGo">만들기</button></div>`,
  root => {
    root.querySelector('#pCancel').onclick = closeModal;
    root.querySelector('#pGo').onclick = () => {
      const s = byNo(+root.querySelector('#pNo').value);
      if (!s) return toast('학생을 선택하세요.');
      closeModal();
      const r = emptyReport();
      Object.assign(r, { no: s.no, name: s.name, selfName: s.name, guardianName: s.guardian || '', teacherName: S.cls.teacherName || '' });
      openEditor(r);
    };
  });
}

/** 지금 보고 있는 달(또는 전체)에 걸친 "아직 신고서 없는" 묶음 */
function monthGroups() {
  return groupForReports(S.records, offDays())
    .filter(g => g.some(r => inMonth(r.start, r.end)))
    .filter(g => !S.filterNo || g[0].no === +S.filterNo);
}

/**
 * 기록 하나에서 신고서 작성으로: 그 기록과 이어진 기록들까지 한 장으로 채운 작성 화면을 연다.
 * 바로 출력하지 않는다 — 작성일 같은 칸을 확인·수정한 뒤 저장·출력한다.
 */
function editForRecord(rec) {
  const all = [...S.records.filter(x => x.id !== rec.id), rec];
  const g = groupForReports(all, offDays()).find(x => x.some(r => r.id === rec.id));
  if (!g) return;
  const { report, warnings } = reportFromRecords(g, { student: byNo(g[0].no), teacherName: S.cls.teacherName || '', offDays: offDays() });
  openEditor(report, warnings);
}

let making = false;
/**
 * 밀린 묶음마다 신고서를 만들어 저장한다(기록에 "신고서 ✓"가 붙는다). 출력은 하지 않고
 * 신고서 탭으로 옮겨 방금 만든 것들을 골라 둔다 — 확인·수정한 뒤 "한 번에 출력".
 */
async function makeGroups(groups) {
  if (!groups.length || making) return;
  const people = new Set(groups.map(g => g[0].no)).size;
  if (!confirm(`신고서 ${groups.length}장(학생 ${people}명)을 만들까요? 만든 뒤 신고서 탭에서 확인하고 출력합니다.`)) return;
  making = true;
  try {
    S.printSel.clear();
    for (const g of groups) {
      const { report } = reportFromRecords(g, { student: byNo(g[0].no), teacherName: S.cls.teacherName || '', offDays: offDays() });
      S.printSel.add(await store.saveReport(S.cls.id, report, []));
    }
    toast(`신고서 ${groups.length}장을 만들었습니다. 작성일 등을 확인한 뒤 출력하세요.`);
    S.tab = 'reports';
    render();
  } catch (e) { fail(e); }
  finally { making = false; }
}

// ── 신고서 편집기 ───────────────────────────────────

let E = null; // { r, prevIds, absManual, warnings }

function closeEditor() {
  $('editor').classList.add('hidden');
  $('editor').innerHTML = '';
  document.body.style.overflow = '';
  E = null;
}

function openEditor(rep, warnings = []) {
  // createdAt(Firestore Timestamp)은 structuredClone하면 일반 객체가 돼 규칙에 걸린다 — 따로 옮긴다.
  const { createdAt, updatedAt: _updatedAt, ...rest } = rep;
  const r = structuredClone({ ...emptyReport(), ...rest, items: { ...emptyReport().items, ...(rest.items || {}) } });
  if (createdAt) r.createdAt = createdAt;
  const a = r.items.absent;
  E = {
    r, warnings,
    prevIds: rep.id ? [...(rep.recordIds || [])] : [],
    absManual: !!(a && a.days !== countSchoolDays(a.start, a.end, offDays())),
  };
  document.body.style.overflow = 'hidden';
  $('editor').classList.remove('hidden');
  drawEditor();
}

function drawEditor() {
  const { r } = E;
  const it = r.items;
  const oneRow = (kind, label) => {
    const key = ITEM_KEYS[kind], v = it[key];
    return `<div class="period-row">
      <label class="check"><input type="checkbox" data-item="${key}" ${v ? 'checked' : ''}>${label}</label>
      <input class="inp" type="date" data-f="${key}.date" value="${esc(v?.date || '')}" ${v ? '' : 'disabled'}>
      <input class="inp" data-f="${key}.period" placeholder="${key === 'result' ? '예: 3~4' : '교시'}" maxlength="10" value="${esc(v?.period || '')}" ${v ? '' : 'disabled'}>
    </div>`;
  };
  const ab = it.absent;
  $('editor').innerHTML = `
    <div class="form-col">
      <div class="editor-head">
        <h2>${r.id ? '신고서 수정' : '새 신고서'}</h2>
        <button class="icon-btn" id="eClose" title="닫기"><svg width="16" height="16"><use href="#ic-close"/></svg></button>
      </div>
      ${E.warnings.map(w => `<p class="hint warn">※ ${esc(w)}</p>`).join('')}
      <section class="zone-sec" data-zone="student"><div class="zone-title">신고서 · 인적사항</div>
        <div class="field"><label>학생</label><select class="inp" id="eNo">${studentOptions(r.no, r.name)}</select></div></section>
      <section class="zone-sec" data-zone="cause"><div class="zone-title">구분 (위 문장 동그라미)</div>
        <div class="seg" id="eCause">${['출석인정', '질병'].map(k => `<button data-v="${k}" class="${r.cause === k ? 'on' : ''}">${k}</button>`).join('')}</div></section>
      <section class="zone-sec" data-zone="period"><div class="zone-title">1. 기간 <span class="hint">— 체크한 종류에 동그라미가 쳐집니다</span></div>
        ${oneRow('지각', '지각')}${oneRow('조퇴', '조퇴')}${oneRow('결과', '결과')}
        <div class="period-row absent">
          <label class="check"><input type="checkbox" data-item="absent" ${ab ? 'checked' : ''}>결석</label>
          <input class="inp" type="date" data-f="absent.start" value="${esc(ab?.start || '')}" ${ab ? '' : 'disabled'}>
          <input class="inp" type="date" data-f="absent.end" min="${esc(ab?.start || '')}" value="${esc(ab?.end || '')}" ${ab ? '' : 'disabled'}>
          <input class="inp" type="number" min="0" max="400" data-f="absent.days" title="일수" value="${esc(ab?.days ?? '')}" ${ab ? '' : 'disabled'}>
        </div>
        <p class="hint" id="eAbsNote" style="margin:0;"></p></section>
      <section class="zone-sec" data-zone="reason"><div class="zone-title">2. 사유</div>
        <input class="inp" data-f="reason" maxlength="200" value="${esc(r.reason)}"></section>
      <section class="zone-sec" data-zone="sign"><div class="zone-title">작성일 · 서명란</div>
        <div class="grid3">
          <div><label class="mini">작성일</label><input class="inp" type="date" data-f="written" value="${esc(r.written)}"></div>
          <div><label class="mini">본인</label><input class="inp" data-f="selfName" maxlength="40" value="${esc(r.selfName)}"></div>
          <div><label class="mini">보호자</label><input class="inp" data-f="guardianName" maxlength="40" placeholder="비우면 빈칸" value="${esc(r.guardianName)}"></div>
        </div></section>

      <section class="zone-sec" data-zone="confirm"><div class="zone-title">확인서 · 1. 확인방법</div>
        <div class="seg" id="eMethod">${CONFIRM_METHODS.map(k => `<button data-v="${k}" class="${r.method === k ? 'on' : ''}">${k}</button>`).join('')}</div>
        ${r.method === '기타' ? `<input class="inp" style="margin-top:8px;" data-f="methodEtc" maxlength="60" placeholder="기타 확인방법" value="${esc(r.methodEtc)}">` : ''}
        <div class="grid3" style="margin-top:8px;">
          <div><label class="mini">확인 날짜</label><input class="inp" type="date" data-f="confirmDate" value="${esc(r.confirmDate)}"></div>
          <div><label class="mini">시</label><input class="inp" data-f="confirmHour" maxlength="10" inputmode="numeric" placeholder="예: 13" value="${esc(r.confirmHour)}"></div>
          <div><label class="mini">대화자</label><input class="inp" data-f="talker" maxlength="30" placeholder="예: 어머님" value="${esc(r.talker)}"></div>
        </div></section>
      <section class="zone-sec" data-zone="attach"><div class="zone-title">2. 첨부</div>
        <textarea class="inp" data-f="attach" rows="3" maxlength="400" placeholder="예: 진료확인서 / 담임확인서(상기명 학생은 …)">${esc(r.attach)}</textarea>
        <p class="hint" id="eAttachNote" style="margin:4px 0 0;"></p></section>
      <section class="zone-sec" data-zone="teacher"><div class="zone-title">확인 날짜 · 담임</div>
        <div class="grid2">
          <div><label class="mini">확인서 날짜</label><input class="inp" type="date" data-f="confirmedOn" value="${esc(r.confirmedOn)}"></div>
          <div><label class="mini">담임 이름</label><input class="inp" data-f="teacherName" maxlength="20" value="${esc(r.teacherName)}"></div>
        </div></section>
      <div class="actions">
        ${r.id ? '<button class="btn danger left" id="eDel">삭제</button>' : ''}
        <button class="btn" id="eCancel">닫기</button>
        <button class="btn" id="ePrint"><svg width="14" height="14" style="vertical-align:-2px;margin-right:3px;"><use href="#ic-print"/></svg>저장 후 출력</button>
        <button class="btn accent" id="eSave">저장</button>
      </div>
    </div>
    <div class="prev-col">
      ${fontNote()}
      <div class="preview-box" id="ePrevBox"><div class="preview-scale" id="ePrev"></div></div>
    </div>`;
  bindEditor();
  updatePreview();
}

function setPath(obj, path, val) {
  const ks = path.split('.');
  let o = obj;
  while (ks.length > 1) o = o[ks.shift()];
  o[ks[0]] = val;
}

function bindEditor() {
  const ed = $('editor');
  const r = E.r;
  const q = s => ed.querySelector(s);

  q('#eClose').onclick = closeEditor;
  q('#eCancel').onclick = closeEditor;
  q('#eNo').onchange = e => {
    const s = byNo(+e.target.value);
    if (!s) return;
    // 다른 학생 기록에 연결된 채로 학생만 바뀌면 목록의 "신고서 ✓"가 엉뚱한 학생에게 붙는다.
    if (r.recordIds?.length && s.no !== r.no) {
      if (!confirm('이 신고서는 출결 기록과 연결되어 있습니다. 학생을 바꾸면 연결이 끊깁니다. 바꿀까요?')) { e.target.value = r.no; return; }
      r.recordIds = [];
    }
    if (!r.selfName || r.selfName === r.name) r.selfName = s.name;
    r.no = s.no; r.name = s.name;
    r.guardianName = s.guardian || r.guardianName;
    drawEditor();
  };
  q('#eCause').querySelectorAll('button').forEach(b => b.onclick = () => { r.cause = b.dataset.v; drawEditor(); });
  q('#eMethod').querySelectorAll('button').forEach(b => b.onclick = () => { r.method = r.method === b.dataset.v ? '' : b.dataset.v; drawEditor(); });

  ed.querySelectorAll('[data-item]').forEach(cb => cb.onchange = () => {
    const key = cb.dataset.item;
    const base = r.items.absent?.start || r.items.early?.date || r.items.late?.date || r.items.result?.date || r.confirmDate || today();
    if (!cb.checked) r.items[key] = null;
    else if (key === 'absent') { r.items.absent = { start: base, end: base, days: countSchoolDays(base, base, offDays()) }; E.absManual = false; }
    else r.items[key] = { date: base, period: '' };
    drawEditor();
  });

  ed.querySelectorAll('[data-f]').forEach(inp => inp.addEventListener('input', () => {
    const f = inp.dataset.f;
    const oldStart = r.items.absent?.start;
    setPath(r, f, inp.value);
    if (f === 'absent.start' && r.items.absent) {
      const end = q('[data-f="absent.end"]');
      if (!r.items.absent.end || r.items.absent.end < inp.value || r.items.absent.end === oldStart) {
        r.items.absent.end = inp.value;
        end.value = inp.value;
      }
      end.min = inp.value;
    }
    if (f === 'absent.days') E.absManual = true;
    if ((f === 'absent.start' || f === 'absent.end') && !E.absManual) {
      r.items.absent.days = countSchoolDays(r.items.absent.start, r.items.absent.end, offDays());
      q('[data-f="absent.days"]').value = r.items.absent.days;
    }
    updatePreview();
  }));

  // 지금 쓰는 구역: 왼쪽 묶음과 오른쪽 신고서의 같은 자리를 함께 표시한다.
  ed.querySelectorAll('.zone-sec').forEach(sec => sec.addEventListener('focusin', () => {
    if (E.zone === sec.dataset.zone) return;
    E.zone = sec.dataset.zone;
    showZone(true);
  }));
  showZone();

  q('#eSave').onclick = () => saveEditor(false);
  q('#ePrint').onclick = () => saveEditor(true);
  q('#eDel')?.addEventListener('click', async () => {
    if (!confirm(`${r.name} 신고서를 삭제할까요? (출결 기록은 남습니다)`)) return;
    try {
      await store.deleteReport(S.cls.id, r, new Set(S.records.map(x => x.id)));
      closeEditor();
      toast('삭제했습니다.');
    } catch (e) { fail(e); }
  });
}

function sheetData(r) {
  return { ...r, grade: S.cls.grade, cls: S.cls.cls };
}

let resizeBound = false;
function updatePreview() {
  if (!E) return;
  const box = $('ePrevBox'), prev = $('ePrev');
  if (!box) return;
  prev.innerHTML = renderSheet(sheetData(E.r));
  const scale = Math.min(1, box.clientWidth / 794);
  prev.style.transform = `scale(${scale})`;
  prev.style.width = '794px';
  box.style.height = `${1123 * scale}px`;

  showZone();

  const ab = E.r.items.absent;
  const note = $('eAbsNote');
  if (note) {
    note.textContent = ab
      ? (ab.end < ab.start ? '결석 종료일이 시작일보다 빠릅니다.'
        : `결석 일수: 주말·공휴일 빼면 ${countSchoolDays(ab.start, ab.end, offDays())}일${E.absManual ? ' (직접 입력한 값을 씁니다)' : ''}`)
      : '';
  }
  const an = $('eAttachNote');
  if (an) {
    const sheet = prev.querySelector('.attach');
    const lines = sheet ? Math.round(sheet.getBoundingClientRect().height / scale / (19.2 * 96 / 72)) : 1;
    an.textContent = lines > 3 ? `첨부가 ${lines}줄입니다. 3줄을 넘으면 아래 칸이 밀려 종이 끝에 가까워집니다.` : '';
  }
  if (!resizeBound) {
    resizeBound = true;
    window.addEventListener('resize', () => updatePreview());
  }
}

/**
 * 신고서 위 구역 [x0, y0, x1, y1] (pt). 첨부와 그 아래는 첨부 줄 수에 따라 내려가므로
 * 그려진 요소의 위치로 잰다.
 */
const ZONES = {
  student: [352, 180, 532, 223],
  cause: [80, 228, 506, 268],
  period: [86, 291, 530, 405],
  reason: [86, 408, 530, 450],
  sign: [228, 453, 500, 526],
  confirm: [86, 609, 531, 690],
};

function showZone(scroll = false) {
  const ed = $('editor');
  ed.querySelectorAll('.zone-sec').forEach(sec => sec.classList.toggle('on', sec.dataset.zone === E?.zone));
  const inner = ed.querySelector('#ePrev .sheet-in');
  if (!inner || !E) return;
  inner.querySelector('.zone-hl')?.remove();
  if (!E.zone) return;
  const PX = 96 / 72;
  let box = ZONES[E.zone] && ZONES[E.zone].map(v => v * PX);
  if (!box) {
    // 화면 배율과 상관없이 sheet-in 기준 좌표(px, 배율 1)로 바꾼다
    const scale = inner.getBoundingClientRect().width / inner.offsetWidth;
    const base = inner.getBoundingClientRect();
    const rel = el => { const b = el.getBoundingClientRect(); return [(b.left - base.left) / scale, (b.top - base.top) / scale, (b.right - base.left) / scale, (b.bottom - base.top) / scale]; };
    if (E.zone === 'attach') {
      const a = rel(inner.querySelector('.attach'));
      box = [86 * PX, a[1] - 2, 531 * PX, a[3] + 2];
    } else if (E.zone === 'teacher') {
      const b = rel(inner.querySelector('.below'));
      box = [220 * PX, b[1] + 22 * PX, 510 * PX, b[3] - 4 * PX];
    }
  }
  if (!box) return;
  const hl = document.createElement('i');
  hl.className = 'zone-hl';
  Object.assign(hl.style, { left: `${box[0] - 4}px`, top: `${box[1] - 3}px`, width: `${box[2] - box[0] + 8}px`, height: `${box[3] - box[1] + 6}px` });
  inner.appendChild(hl);
  // 구역을 옮겼을 때만 미리보기를 그 자리로 — 글자를 칠 때마다 화면이 흔들리지 않게
  if (scroll) hl.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function validateReport(r) {
  if (!r.no) return '학생을 선택하세요.';
  const it = r.items;
  if (!it.late && !it.early && !it.result && !it.absent) return '1. 기간에서 하나 이상 체크하세요.';
  for (const k of ['late', 'early', 'result']) if (it[k] && !isDateStr(it[k].date)) return '기간의 날짜를 입력하세요.';
  if (it.absent) {
    if (!isDateStr(it.absent.start) || !isDateStr(it.absent.end)) return '결석 기간을 입력하세요.';
    if (it.absent.end < it.absent.start) return '결석 종료일이 시작일보다 빠릅니다.';
  }
  return null;
}

async function saveEditor(thenPrint) {
  const r = E.r;
  const err = validateReport(r);
  if (err) return toast(err);
  const existing = new Set(S.records.map(x => x.id));
  r.recordIds = (r.recordIds || []).filter(id => existing.has(id));
  const prev = E.prevIds.filter(id => existing.has(id));
  try {
    const id = await store.saveReport(S.cls.id, r, prev);
    r.id = id;
    E.prevIds = [...r.recordIds];
    toast('저장했습니다.');
    if (thenPrint) printReports([r]);
    closeEditor();
  } catch (e) { fail(e); }
}

// ── 인쇄 ───────────────────────────────────────────

/**
 * 출력하는 기기에 굴림·함초롬돋움이 있는지. document.fonts.check는 설치 안 된
 * 로컬 글꼴에도 true를 주는 브라우저가 있어, 글자 폭을 직접 재서 판단한다.
 */
function hasFont(name) {
  const c = document.createElement('canvas').getContext('2d');
  const text = '가나다라 출결 신고서 abcXYZ 0123';
  return ['monospace', 'serif'].some(base => {
    c.font = `40px ${base}`;
    const w0 = c.measureText(text).width;
    c.font = `40px "${name}", ${base}`;
    return c.measureText(text).width !== w0;
  });
}

function fontNote() {
  const missing = [];
  if (!hasFont('굴림') && !hasFont('Gulim')) missing.push('굴림');
  if (!hasFont('함초롬돋움') && !hasFont('HCR Dotum')) missing.push('함초롬돋움');
  if (!hasFont('함초롬바탕') && !hasFont('HCR Batang')) missing.push('함초롬바탕');
  if (!missing.length) return '';
  return `<div class="font-note">이 기기에 ${missing.join('·')} 글꼴이 없어 나눔 글꼴로 대신 보입니다. 칸 위치는 같지만 글자 모양이 원본과 조금 다릅니다.
    원본과 같은 글꼴로 출력하려면 학교 PC(Windows, 한글 설치)에서 출력하세요.</div>`;
}

async function printReports(list) {
  if (!list.length) return;
  const area = $('printArea');
  area.innerHTML = list.map(p => renderSheet(sheetData(p))).join('');
  try { await document.fonts.ready; } catch {}
  const clear = () => { area.innerHTML = ''; window.removeEventListener('afterprint', clear); };
  window.addEventListener('afterprint', clear);
  setTimeout(() => window.print(), 50);
}

// ── 명렬표 탭 ───────────────────────────────────────

function renderStudents(body) {
  body.innerHTML = `
    <div class="card">
      <h2>명렬표 (${S.students.length}명)</h2>
      <p class="hint">CSV 양식: <b>학년,반,번호,이름,보호자명</b>. 학년 전체 명렬표를 올려도 ${S.cls.grade}학년 ${S.cls.cls}반 학생만 골라 넣습니다.
      CSV를 올리면 명렬표를 통째로 바꿉니다(이미 저장된 출결 기록은 그대로 남습니다).</p>
      <div class="toolbar" style="margin:12px 0 0;">
        <label class="btn sm accent" style="display:inline-flex;align-items:center;gap:4px;">
          <svg width="14" height="14"><use href="#ic-upload"/></svg>CSV 올리기<input type="file" id="csvFile" accept=".csv,text/csv" hidden></label>
        <button class="btn sm" id="btnTpl"><svg width="14" height="14" style="vertical-align:-2px;margin-right:3px;"><use href="#ic-download"/></svg>양식 받기</button>
        <button class="btn sm" id="btnAddStu"><svg width="13" height="13" style="vertical-align:-2px;margin-right:2px;"><use href="#ic-plus"/></svg>학생 추가</button>
      </div>
    </div>
    <div class="card">
      ${!S.loaded.students ? '<div class="empty">불러오는 중…</div>' : S.students.length ? `
      <table class="tbl"><thead><tr><th>번호</th><th>이름</th><th>보호자</th></tr></thead><tbody>
        ${S.students.map(s => `<tr class="click" data-no="${s.no}"><td class="num">${s.no}</td><td>${esc(s.name)}</td><td>${esc(s.guardian) || '<span class="hint">—</span>'}</td></tr>`).join('')}
      </tbody></table>` : '<div class="empty">아직 학생이 없습니다. CSV를 올려 주세요.</div>'}
    </div>`;

  $('csvFile').onchange = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const text = decodeCsv(new Uint8Array(await f.arrayBuffer()));
    previewRoster(parseRoster(text, { grade: S.cls.grade, cls: S.cls.cls }));
  };
  $('btnTpl').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv;charset=utf-8' }));
    a.download = '명렬표_양식.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('btnAddStu').onclick = () => editStudent(null);
  body.querySelectorAll('tr[data-no]').forEach(tr => tr.onclick = () => editStudent(byNo(+tr.dataset.no)));
}

function previewRoster({ students, errors, skipped }) {
  const removed = S.students.filter(s => !students.some(n => n.no === s.no));
  openModal(`
    <h2>명렬표 확인</h2>
    <p class="hint">${S.cls.grade}학년 ${S.cls.cls}반 <b>${students.length}명</b>${skipped ? ` · 다른 반 ${skipped}줄 건너뜀` : ''}${removed.length ? ` · 기존 명단에서 빠지는 학생 ${removed.length}명` : ''}</p>
    ${errors.length ? `<div class="hint warn">${errors.slice(0, 10).map(esc).join('<br>')}${errors.length > 10 ? `<br>외 ${errors.length - 10}건` : ''}</div>` : ''}
    <div style="max-height:46vh;overflow:auto;margin-top:10px;">
      <table class="tbl"><thead><tr><th>번호</th><th>이름</th><th>보호자</th></tr></thead><tbody>
      ${students.map(s => `<tr><td class="num">${s.no}</td><td>${esc(s.name)}</td><td>${esc(s.guardian)}</td></tr>`).join('')}
      </tbody></table>
    </div>
    <div class="actions"><button class="btn" id="mCancel">취소</button><button class="btn accent" id="mGo" ${students.length ? '' : 'disabled'}>이대로 저장</button></div>`,
  root => {
    root.querySelector('#mCancel').onclick = closeModal;
    root.querySelector('#mGo').onclick = async e => {
      e.target.disabled = true;
      try { await store.replaceRoster(S.cls.id, students, S.students); closeModal(); toast(`${students.length}명 저장했습니다.`); }
      catch (err) { fail(err); e.target.disabled = false; }
    };
  });
}

function editStudent(s) {
  openModal(`
    <h2>${s ? '학생 수정' : '학생 추가'}</h2>
    <div class="grid3">
      <div class="field"><label>번호</label><input class="inp" type="number" min="1" max="99" id="sNo" value="${s?.no ?? ''}"></div>
      <div class="field" style="grid-column:span 2;"><label>이름</label><input class="inp" id="sName" maxlength="40" value="${esc(s?.name)}"></div>
    </div>
    <div class="field"><label>보호자 이름</label><input class="inp" id="sGuard" maxlength="40" value="${esc(s?.guardian)}"></div>
    <div class="actions">
      ${s ? '<button class="btn danger left" id="sDel">삭제</button>' : ''}
      <button class="btn" id="sCancel">취소</button><button class="btn accent" id="sSave">저장</button>
    </div>`,
  root => {
    const q = x => root.querySelector(x);
    q('#sCancel').onclick = closeModal;
    q('#sDel')?.addEventListener('click', async () => {
      if (!confirm(`${s.no}번 ${s.name} 학생을 명렬표에서 지울까요? (출결 기록은 남습니다)`)) return;
      try { await store.deleteStudent(S.cls.id, s.no); closeModal(); } catch (e) { fail(e); }
    });
    q('#sSave').onclick = async () => {
      const no = +q('#sNo').value, name = q('#sName').value.trim(), guardian = q('#sGuard').value.trim();
      if (!Number.isInteger(no) || no < 1 || no > 99) return toast('번호는 1~99입니다.');
      if (!name) return toast('이름을 입력하세요.');
      if (no !== s?.no && byNo(no)) return toast(`${no}번은 이미 있습니다.`);
      try {
        await store.saveStudent(S.cls.id, { no, name, guardian });
        if (s && s.no !== no) await store.deleteStudent(S.cls.id, s.no);
        closeModal();
      } catch (e) { fail(e); }
    };
  });
}

// ── 설정 탭 ─────────────────────────────────────────

function renderSettings(body) {
  const c = S.cls;
  const off = [...offDays()].sort((a, b) => a.date.localeCompare(b.date));
  const yearHolidays = Object.entries(HOLIDAYS).filter(([d]) => schoolYearOf(d) === c.year);
  body.innerHTML = `
    <div class="card">
      <h2>${c.year}학년도 ${c.grade}학년 ${c.cls}반</h2>
      <div class="field"><label>담임 이름 (확인서에 인쇄)</label>
        <div class="inline"><input class="inp" id="tName" maxlength="20" value="${esc(c.teacherName)}"><button class="btn sm accent" id="tSave">저장</button></div></div>
    </div>

    <div class="card">
      <h2>재량휴업일 · 방학</h2>
      <p class="hint">결석 일수를 셀 때 주말·공휴일과 함께 빠집니다. 공휴일(대체공휴일·선거일 포함)은 이미 들어 있습니다.
      이미 저장된 기록의 일수는 자동으로 바뀌지 않으니, 필요하면 기록을 열어 다시 저장하세요.</p>
      <div class="grid3" style="margin-top:10px;">
        <div class="field"><label>시작일</label><input class="inp" type="date" id="oStart"></div>
        <div class="field"><label>종료일 (하루면 비움)</label><input class="inp" type="date" id="oEnd"></div>
        <div class="field"><label>이름</label><input class="inp" id="oLabel" maxlength="20" placeholder="재량휴업일"></div>
      </div>
      <button class="btn sm accent" id="oAdd">추가</button>
      ${off.length ? `<table class="tbl" style="margin-top:12px;"><tbody>${off.map(o => `
        <tr><td style="width:120px;">${shortLabel(o.date)}</td><td>${esc(o.label)}</td><td style="text-align:right;"><button class="btn sm ghost" data-del="${o.date}">삭제</button></td></tr>`).join('')}</tbody></table>` : ''}
      <details style="margin-top:12px;"><summary class="hint" style="cursor:pointer;">들어 있는 공휴일 보기 (${yearHolidays.length}일)</summary>
        <p class="hint">${yearHolidays.map(([d, n]) => `${shortLabel(d)} ${esc(n)}`).join(' · ')}</p></details>
    </div>

    <div class="card">
      <h2>학년 말 정리</h2>
      <p class="hint">이 반의 명렬표·출결 기록·신고서를 모두 지우고 반 등록도 해제합니다. 되돌릴 수 없습니다.
      필요한 신고서는 먼저 출력해 두세요.</p>
      <button class="btn danger" id="wipe">이 반 데이터 모두 삭제</button>
    </div>`;

  $('tSave').onclick = () => store.updateClass(c.id, { teacherName: $('tName').value.trim() }).then(() => toast('저장했습니다.')).catch(fail);
  $('oAdd').onclick = () => {
    const start = $('oStart').value, end = $('oEnd').value || start, label = $('oLabel').value.trim() || '재량휴업일';
    if (!isDateStr(start) || !isDateStr(end) || end < start) return toast('날짜를 확인하세요.');
    const have = new Set(offDays().map(o => o.date));
    const add = [];
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (!offReason(d) && !have.has(d)) add.push({ date: d, label }); // 주말·공휴일은 어차피 빠지니 넣지 않는다
    }
    if (!add.length) return toast('추가할 평일이 없습니다.');
    const next = [...offDays(), ...add];
    if (next.length > 300) return toast('휴업일은 300일까지 넣을 수 있습니다.');
    store.updateClass(c.id, { offDays: next }).then(() => toast(`${add.length}일 추가했습니다.`)).catch(fail);
  };
  body.querySelectorAll('[data-del]').forEach(b => b.onclick = () =>
    store.updateClass(c.id, { offDays: offDays().filter(o => o.date !== b.dataset.del) }).catch(fail));
  $('wipe').onclick = async () => {
    const typed = prompt(`정말 삭제하려면 "${c.grade}학년 ${c.cls}반 삭제" 라고 입력하세요.`);
    if (typed !== `${c.grade}학년 ${c.cls}반 삭제`) return;
    try {
      stopWatching();
      await store.wipeClass(c.id);
      try { localStorage.removeItem(CLASS_KEY); } catch {}
      location.reload();
    } catch (e) { fail(e); }
  };
}

// ── 관리 탭 (관리자만) ───────────────────────────────

async function renderAdmin(body) {
  body.innerHTML = '<div class="empty">불러오는 중…</div>';
  let allowed, classes;
  try { [allowed, classes] = await Promise.all([store.listAllowed(), store.listAllClasses()]); }
  catch (e) { fail(e); body.innerHTML = '<div class="empty">불러오지 못했습니다.</div>'; return; }
  // 기다리는 사이 화면이 다시 그려졌으면(신청 목록 갱신 등) 이 결과는 버린다
  if (S.tab !== 'admin' || !body.isConnected) return;

  const taken = new Map(classes.map(c => [c.id, c]));
  body.innerHTML = `
    <div class="card">
      <h2>승인 대기 (${S.requests.length})</h2>
      ${S.requests.length ? `<table class="tbl"><thead><tr><th>신청한 반</th><th>이름</th><th>계정</th><th></th></tr></thead><tbody>
        ${S.requests.map(rq => {
          const t = taken.get(`${rq.year}-${rq.grade}-${rq.cls}`);
          return `<tr><td>${rq.year} ${rq.grade}-${rq.cls}${t ? `<br><span class="hint warn">이미 ${esc(t.teacherName || t.ownerEmail)} 선생님 반</span>` : ''}</td>
            <td>${esc(rq.name)}</td><td class="hint">${esc(rq.email)}</td>
            <td style="text-align:right;white-space:nowrap;"><button class="btn sm ghost" data-reject="${esc(rq.uid)}">거절</button>
            <button class="btn sm accent" data-approve="${esc(rq.uid)}" ${t ? 'disabled' : ''}>승인</button></td></tr>`;
        }).join('')}</tbody></table>`
      : '<p class="hint">대기 중인 신청이 없습니다. 선생님이 로그인해서 학년·반을 적고 신청하면 여기에 뜹니다.</p>'}
    </div>
    <div class="card">
      <h2>사용 허용 계정 (${allowed.length})</h2>
      <p class="hint">신청을 승인하면 자동으로 들어갑니다. 삭제하면 그 선생님은 즉시 자기 반 데이터에도 접근할 수 없습니다.</p>
      <table class="tbl" style="margin-top:8px;"><tbody>
        ${allowed.map(a => `<tr><td>${esc(a.id)}</td><td class="hint">${esc(a.note)}</td><td style="text-align:right;"><button class="btn sm ghost" data-rm="${esc(a.id)}">삭제</button></td></tr>`).join('') || '<tr><td class="hint">없음</td></tr>'}
      </tbody></table>
    </div>
    <div class="card">
      <h2>등록된 반 (${classes.length})</h2>
      <p class="hint">"등록 해제"는 담임 연결만 끊습니다. 명렬표·기록·신고서는 남아서, 그 반으로 새로 승인받는 선생님이 이어받습니다(담임 교체용).
      관리자도 학생 정보는 볼 수 없습니다.</p>
      <table class="tbl" style="margin-top:8px;"><thead><tr><th>반</th><th>담임</th><th>계정</th><th></th></tr></thead><tbody>
        ${classes.map(c => `<tr><td>${c.year} ${c.grade}-${c.cls}</td><td>${esc(c.teacherName)}</td><td class="hint">${esc(c.ownerEmail)}</td>
          <td style="text-align:right;"><button class="btn sm ghost" data-rel="${esc(c.id)}">등록 해제</button></td></tr>`).join('') || '<tr><td class="hint">없음</td></tr>'}
      </tbody></table>
    </div>`;

  body.querySelectorAll('[data-approve]').forEach(b => b.onclick = async () => {
    const rq = S.requests.find(x => x.uid === b.dataset.approve);
    if (!rq) return;
    b.disabled = true;
    try { await store.approveRequest(rq); toast(`${rq.name} 선생님(${rq.grade}-${rq.cls})을 승인했습니다.`); render(); }
    catch (e) { fail(e); b.disabled = false; }
  });
  body.querySelectorAll('[data-reject]').forEach(b => b.onclick = async () => {
    const rq = S.requests.find(x => x.uid === b.dataset.reject);
    if (!rq || !confirm(`${rq.name}(${rq.email}) 선생님의 신청을 거절할까요?`)) return;
    try { await store.rejectRequest(rq.uid); } catch (e) { fail(e); }
  });

  body.querySelectorAll('[data-rm]').forEach(b => b.onclick = async () => {
    if (!confirm(`${b.dataset.rm} 계정의 사용 허용을 해제할까요?`)) return;
    try { await store.removeAllowed(b.dataset.rm); render(); } catch (e) { fail(e); }
  });
  body.querySelectorAll('[data-rel]').forEach(b => b.onclick = async () => {
    if (!confirm(`${b.dataset.rel} 반의 담임 등록을 해제할까요?`)) return;
    try { await store.releaseClass(b.dataset.rel); render(); } catch (e) { fail(e); }
  });
}
