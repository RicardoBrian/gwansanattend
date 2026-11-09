/**
 * Firestore 저장 계층.
 *
 * firestore.rules 와 정확히 맞물려야 한다 — 여기서 보내는 필드 목록이
 * 규칙의 hasOnly 목록과 다르면 저장이 거부된다.
 *
 * 업무용 통합 프로젝트 gwansan-work. 출결 데이터는 apps/attend 아래, 명렬표는 세 앱 공용.
 *
 *   admins/{email}                          관리자 (세 앱 공용, 콘솔에서만 만든다)
 *   years/{연도}/students/{연도-학년-반-번호}   명렬표 (세 앱 공용 — 학생 관리 사이트·봉사 앱도 쓴다)
 *   apps/attend/requests/{uid}              승인 신청 (학년·반·이름) — 관리자가 승인하면 지워진다
 *   apps/attend/allowed/{email}             사용 허용된 선생님 계정 (승인 또는 관리자 직접 추가)
 *   apps/attend/classes/{연도-학년-반}        반. 담임은 ownerEmail(이메일로 확인 — 프로젝트가 바뀌어도 이어지게)
 *     guardians/{연도-학년-반-번호}           보호자명 (그 반 담임만)
 *     records/{자동ID}                       출결 기록
 *     reports/{자동ID}                       결석신고서
 *   apps/attend/logs/{자동ID}               접속 기록
 */
import { db, auth } from './firebase-config.js?v=2611090332';

const A = 'apps/attend';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, getDocs,
  query, where, orderBy, limit, onSnapshot, writeBatch, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut as fbSignOut, onAuthStateChanged,
  setPersistence, browserLocalPersistence,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

// ── 로그인 ───────────────────────────────────────────

// 로그인은 3일 동안 유지한다. Firebase는 기간을 정할 수 없어(브라우저에 계속 남음) 로그인한 시각을
// 브라우저에 적어 두고, 3일이 지나면 열 때 로그아웃시킨다.
const LOGIN_DAYS = 3;
const STAMP = 'gwsattend.loginAt';
const stamp = {
  get() { try { return Number(localStorage.getItem(STAMP)) || 0; } catch { return 0; } },
  set(t = Date.now()) { try { localStorage.setItem(STAMP, String(t)); } catch { /* 저장 불가 환경이면 브라우저 설정대로 */ } },
  clear() { try { localStorage.removeItem(STAMP); } catch { /* 위와 같음 */ } },
};

export function watchAuth(cb) {
  return onAuthStateChanged(auth, async user => {
    if (user) {
      const at = stamp.get();
      if (!at) stamp.set();  // 이 기능 이전에 로그인한 기기: 지금부터 3일
      else if (Date.now() - at > LOGIN_DAYS * 86400000) {
        stamp.clear();
        await fbSignOut(auth);
        return;  // 로그아웃되면 이 리스너가 user=null로 다시 불린다
      }
    }
    cb(user);
  });
}

export async function signIn() {
  // 브라우저를 닫아도 3일은 로그인이 남는다(위 watchAuth). 공용 PC에서는 꼭 [로그아웃]을 누른다.
  await setPersistence(auth, browserLocalPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  stamp.set();
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    // 팝업이 막힌 환경(일부 모바일 브라우저)은 페이지 이동 방식으로 다시 시도
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
    } else throw e;
  }
}

/**
 * 저장이 "권한 없음"으로 거절됐을 때 이유를 좁힌다 — 규칙은 어느 문서가 문제인지 알려 주지 않는다.
 * @returns {Promise<string>} 사람이 읽을 이유(못 찾으면 '')
 */
export async function diagnoseAccess(cid) {
  const user = auth.currentUser;
  if (!user) return '로그인이 풀렸습니다. 다시 로그인하세요.';
  const email = (user.email || '').toLowerCase();
  const [allowed, admin] = await Promise.all([
    getDoc(doc(db, `${A}/allowed`, email)).catch(() => null),
    getDoc(doc(db, 'admins', email)).catch(() => null),
  ]);
  if (!allowed?.exists() && !admin?.exists()) return `${email} 계정이 "사용 허용 계정"에 없습니다. 관리자에게 알려 주세요.`;
  if (cid) {
    const c = await getDoc(doc(db, `${A}/classes`, cid)).catch(() => null);
    if (!c) return '이 반 정보를 읽을 수 없습니다. 이 반의 담임으로 등록된 계정과 지금 로그인한 계정(' + email + ')이 같은지 관리자에게 확인하세요.';
    if (!c.exists()) return '이 반이 등록 해제되었습니다. 관리자에게 알려 주세요.';
    if ((c.data().ownerEmail || '').toLowerCase() !== email) return `이 반 담임으로 등록된 계정(${c.data().ownerEmail})과 지금 로그인한 계정(${email})이 다릅니다.`;
  }
  return '';
}

// ── 접속 기록 ────────────────────────────────────────
// 누가·언제·어느 반에서·무엇을 했는지만 남긴다. 학생 이름·번호·사유 같은 내용은 넣지 않는다.
// 기록은 규칙으로 고치거나 지울 수 없고 관리자만 읽는다. 기록 실패가 업무를 막지는 않는다.
export async function logAction(action, cid = '', n = 0) {
  try {
    const u = auth.currentUser;
    if (!u) return;
    const d = { at: serverTimestamp(), email: (u.email || '').toLowerCase(), uid: u.uid, cid, action };
    if (n) d.n = Math.min(500, Math.round(n));
    await addDoc(collection(db, `${A}/logs`), d);
  } catch (e) { console.warn('접속 기록 실패', e?.code); }
}

export async function listLogs(max = 300) {
  const snap = await getDocs(query(collection(db, `${A}/logs`), orderBy('at', 'desc'), limit(max)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export const signOut = () => { stamp.clear(); return fbSignOut(auth); };

const emailOf = user => (user.email || '').toLowerCase();

/** 이 계정이 허용·관리자인지. 규칙은 자기 이메일 문서만 get 하게 해 준다. */
export async function checkAccess(user) {
  const e = emailOf(user);
  const [a, b] = await Promise.all([
    getDoc(doc(db, `${A}/allowed`, e)).catch(() => null),
    getDoc(doc(db, 'admins', e)).catch(() => null),
  ]);
  const admin = !!b?.exists();
  return { allowed: admin || !!a?.exists(), admin };
}

// ── 승인 신청 ─────────────────────────────────────────

export function watchMyRequest(cb, onErr) {
  return onSnapshot(doc(db, `${A}/requests`, auth.currentUser.uid), s => cb(s.exists() ? s.data() : null), onErr);
}

export function submitRequest({ year, grade, cls, name }) {
  const user = auth.currentUser;
  return setDoc(doc(db, `${A}/requests`, user.uid), {
    email: emailOf(user), name, year, grade, cls, createdAt: serverTimestamp(),
  });
}

export const cancelRequest = () => deleteDoc(doc(db, `${A}/requests`, auth.currentUser.uid));

export function watchRequests(cb, onErr) {
  return onSnapshot(collection(db, `${A}/requests`), s => cb(s.docs.map(d => ({ uid: d.id, ...d.data() }))), onErr);
}

/**
 * 승인: 허용 목록 등록 + 신청한 반의 담임 지정 + 신청서 삭제를 한 번에.
 * 규칙은 관리자가 신청서 내용 그대로만 반을 만들 수 있게 검사한다.
 */
export async function approveRequest(rq) {
  const id = classIdOf(rq.year, rq.grade, rq.cls);
  const [cls, allowed] = await Promise.all([getDoc(doc(db, `${A}/classes`, id)), getDoc(doc(db, `${A}/allowed`, rq.email))]);
  if (cls.exists()) throw new Error(`${rq.grade}학년 ${rq.cls}반은 이미 ${cls.data().teacherName || cls.data().ownerEmail} 선생님이 등록했습니다. 먼저 등록 해제하거나 신청을 거절하세요.`);
  const b = writeBatch(db);
  if (!allowed.exists()) {
    b.set(doc(db, `${A}/allowed`, rq.email), { email: rq.email, note: `${rq.grade}-${rq.cls} ${rq.name}`.slice(0, 40), addedAt: serverTimestamp() });
  }
  b.set(doc(db, `${A}/classes`, id), {
    year: rq.year, grade: rq.grade, cls: rq.cls,
    ownerUid: rq.uid, ownerEmail: rq.email, teacherName: rq.name, offDays: [],
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  b.delete(doc(db, `${A}/requests`, rq.uid));
  await b.commit();
}

export const rejectRequest = uid => deleteDoc(doc(db, `${A}/requests`, uid));

// ── 반 ───────────────────────────────────────────────

export const classIdOf = (year, grade, cls) => `${year}-${grade}-${cls}`;

export async function myClasses() {
  const email = emailOf(auth.currentUser);
  const snap = await getDocs(query(collection(db, `${A}/classes`), where('ownerEmail', '==', email)));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => b.year - a.year || a.grade - b.grade || a.cls - b.cls);
}

export function watchClass(cid, cb, onErr) {
  return onSnapshot(doc(db, `${A}/classes`, cid), s => cb(s.exists() ? { id: s.id, ...s.data() } : null), onErr);
}

export function updateClass(cid, patch) {
  const allowed = {};
  if ('teacherName' in patch) allowed.teacherName = patch.teacherName;
  if ('offDays' in patch) allowed.offDays = patch.offDays;
  if ('stamp' in patch) allowed.stamp = patch.stamp;  // 담임 도장 그림(작은 PNG data URL), 빈 문자열이면 삭제
  return updateDoc(doc(db, `${A}/classes`, cid), { ...allowed, updatedAt: serverTimestamp() });
}

// ── 반 아래 컬렉션 공통 ───────────────────────────────

const sub = (cid, name) => collection(db, `${A}/classes`, cid, name);

export function watchSub(cid, name, cb, onErr) {
  if (name === 'students') return watchStudents(cid, cb, onErr);
  return onSnapshot(sub(cid, name), s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), onErr);
}

const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, obj[k] ?? null]));

// ── 명렬표 ───────────────────────────────────────────
// 이름·번호는 공용 명렬표(years/{연도}/students), 보호자명은 반 아래 guardians 에 둔다.
// 화면에는 예전과 같은 모양 { id: 번호, no, name, koName, guardian } 으로 넘긴다.

const parseCid = cid => { const [year, grade, cls] = cid.split('-').map(Number); return { year, grade, cls }; };
const sid = (cid, no) => `${cid}-${no}`;  // 학생 ID = 연도-학년-반-번호
const rosterDoc = (cid, no) => doc(db, `years/${parseCid(cid).year}/students`, sid(cid, no));
const guardianDoc = (cid, no) => doc(sub(cid, 'guardians'), sid(cid, no));

function watchStudents(cid, cb, onErr) {
  const { year, grade, cls } = parseCid(cid);
  let roster = null, guardians = null;
  const emit = () => {
    if (!roster || !guardians) return;
    cb(roster.map(s => ({
      id: String(s.number), no: s.number, name: s.name, koName: s.koreanName || '',
      guardian: guardians.get(s.number) || '', updatedAt: s.updatedAt,
    })));
  };
  const u1 = onSnapshot(query(collection(db, `years/${year}/students`), where('grade', '==', grade), where('klass', '==', cls)),
    s => { roster = s.docs.map(d => d.data()); emit(); }, onErr);
  const u2 = onSnapshot(sub(cid, 'guardians'),
    s => { guardians = new Map(s.docs.map(d => [d.data().number, d.data().guardian || ''])); emit(); }, onErr);
  return () => { u1(); u2(); };
}

function studentOps(cid, s) {
  const { grade, cls } = parseCid(cid);
  return [
    b => b.set(rosterDoc(cid, s.no), { grade, klass: cls, number: s.no, name: s.name, koreanName: s.koName || '', updatedAt: serverTimestamp() }, { merge: true }),
    b => b.set(guardianDoc(cid, s.no), { number: s.no, guardian: s.guardian || '', updatedAt: serverTimestamp() }),
  ];
}
const deleteOps = (cid, no) => [b => b.delete(rosterDoc(cid, no)), b => b.delete(guardianDoc(cid, no))];

export async function saveStudent(cid, s) {
  await runBatches(studentOps(cid, s));
  logAction('student_save', cid);
}

export async function deleteStudent(cid, no) {
  await runBatches(deleteOps(cid, no));
  logAction('student_delete', cid);
}

/** CSV로 명렬표 통째로 바꾸기. 새 명단에 없는 번호는 지운다(출결 기록은 이름이 따로 저장돼 있어 남는다). */
export async function replaceRoster(cid, students, current) {
  const keep = new Set(students.map(s => s.no));
  const ops = [
    ...current.filter(s => !keep.has(s.no)).flatMap(s => deleteOps(cid, s.no)),
    ...students.flatMap(s => studentOps(cid, s)),
  ];
  await runBatches(ops);
  logAction('roster_replace', cid, students.length);
}

/** writeBatch는 500건 제한이 있어 나눠서 보낸다. */
async function runBatches(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = writeBatch(db);
    ops.slice(i, i + 400).forEach(f => f(b));
    await b.commit();
  }
}

// ── 출결 기록 ─────────────────────────────────────────

export const RECORD_FIELDS = [
  'no', 'name', 'kind', 'cause', 'start', 'end', 'period', 'days',
  'reason', 'docs', 'docsIn', 'neis', 'memo', 'reportId',
  'method', 'methodEtc', 'confirmDate', 'confirmHour', 'talker',
];

function recordData(r) {
  const d = pick(r, RECORD_FIELDS);
  d.docs = r.docs || [];
  d.docsIn = !!r.docsIn;
  d.neis = !!r.neis;
  d.period = r.period || '';
  d.reason = r.reason || '';
  d.memo = r.memo || '';
  for (const k of ['method', 'methodEtc', 'confirmDate', 'confirmHour', 'talker']) d[k] = String(r[k] ?? '');
  d.days = r.kind === '결석' ? (Number.isFinite(+r.days) && r.days !== '' && r.days != null ? Math.round(+r.days) : null) : null;
  d.updatedAt = serverTimestamp();
  return d;
}

export async function saveRecord(cid, r) {
  const data = recordData(r);
  if (r.id) {
    await setDoc(doc(sub(cid, 'records'), r.id), { ...data, createdAt: r.createdAt ?? serverTimestamp() });
    logAction('record_save', cid);
    return r.id;
  }
  const ref = await addDoc(sub(cid, 'records'), { ...data, createdAt: serverTimestamp() });
  logAction('record_save', cid);
  return ref.id;
}

export function setRecordFlag(cid, id, patch) {
  const ok = {};
  for (const k of ['neis', 'docsIn']) if (k in patch) ok[k] = !!patch[k];
  return updateDoc(doc(sub(cid, 'records'), id), { ...ok, updatedAt: serverTimestamp() });
}

export async function deleteRecord(cid, id) {
  await deleteDoc(doc(sub(cid, 'records'), id));
  logAction('record_delete', cid);
}

// ── 신고서 ───────────────────────────────────────────

export const REPORT_FIELDS = [
  'no', 'name', 'cause', 'items', 'reason', 'written', 'selfName', 'guardianName',
  'method', 'methodEtc', 'confirmDate', 'confirmHour', 'talker', 'attach',
  'confirmedOn', 'teacherName', 'recordIds',
];

function reportData(r) {
  const d = pick(r, REPORT_FIELDS);
  for (const k of ['reason', 'written', 'selfName', 'guardianName', 'method', 'methodEtc',
    'confirmDate', 'confirmHour', 'talker', 'attach', 'confirmedOn', 'teacherName']) d[k] = String(r[k] ?? '');
  d.items = {
    late: r.items?.late || null, early: r.items?.early || null,
    result: r.items?.result || null, absent: r.items?.absent || null,
  };
  if (d.items.absent) d.items.absent = { ...d.items.absent, days: Math.round(+d.items.absent.days || 0) };
  d.recordIds = r.recordIds || [];
  d.updatedAt = serverTimestamp();
  return d;
}

/**
 * 신고서 저장. 연결된 출결 기록들의 reportId도 같은 배치로 맞춘다
 * — 목록에서 "신고서 작성됨" 표시가 기록과 어긋나지 않게.
 */
export async function saveReport(cid, r, prevRecordIds = []) {
  const b = writeBatch(db);
  const ref = r.id ? doc(sub(cid, 'reports'), r.id) : doc(sub(cid, 'reports'));
  b.set(ref, { ...reportData(r), createdAt: r.createdAt ?? serverTimestamp() });
  const now = new Set(r.recordIds || []);
  for (const id of now) b.update(doc(sub(cid, 'records'), id), { reportId: ref.id, updatedAt: serverTimestamp() });
  for (const id of prevRecordIds) if (!now.has(id)) b.update(doc(sub(cid, 'records'), id), { reportId: null, updatedAt: serverTimestamp() });
  await b.commit();
  logAction('report_save', cid);
  return ref.id;
}

export async function deleteReport(cid, r, existingRecordIds) {
  // 신고서 삭제가 먼저다. 연결된 기록의 표시 해제까지 한 묶음으로 하면, 기록 하나가 규칙에 걸려
  // 거절될 때 신고서까지 안 지워진다(모두 성공하거나 모두 실패하는 묶음이라서).
  await deleteDoc(doc(sub(cid, 'reports'), r.id));
  logAction('report_delete', cid);
  const failed = [];
  for (const id of r.recordIds || []) {
    if (!existingRecordIds.has(id)) continue;
    try { await updateDoc(doc(sub(cid, 'records'), id), { reportId: null, updatedAt: serverTimestamp() }); }
    catch { failed.push(id); }
  }
  return failed;  // 연결 표시를 못 지운 기록(화면은 신고서가 없는 것으로 처리한다)
}

// ── 학년 말 정리 ──────────────────────────────────────

/** 반의 출결 데이터(보호자·기록·신고서)와 반 등록까지 지운다. 되돌릴 수 없다.
 *  명렬표(이름·번호)는 세 앱 공용이라 지우지 않는다 — 학생 관리 사이트에서 관리한다. */
export async function wipeClass(cid) {
  const ops = [];
  for (const name of ['guardians', 'records', 'reports']) {
    const snap = await getDocs(sub(cid, name));
    snap.docs.forEach(d => ops.push(b => b.delete(d.ref)));
  }
  await runBatches(ops);
  await logAction('class_wipe', cid);  // 반 등록을 지우면 규칙상 기록을 못 남기므로 그 전에
  await deleteDoc(doc(db, `${A}/classes`, cid));
}

// ── 관리자 ───────────────────────────────────────────

export async function listAllowed() {
  const snap = await getDocs(collection(db, `${A}/allowed`));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.id.localeCompare(b.id));
}

export const removeAllowed = email => deleteDoc(doc(db, `${A}/allowed`, email));

export async function listAllClasses() {
  const snap = await getDocs(collection(db, `${A}/classes`));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => b.year - a.year || a.grade - b.grade || a.cls - b.cls);
}

/**
 * 반 등록 해제. 반 문서만 지우고 명렬표·기록·신고서는 남긴다
 * — 담임이 바뀐 경우 새 담임이 같은 반을 등록하면 그대로 이어받는다.
 */
export const releaseClass = cid => deleteDoc(doc(db, `${A}/classes`, cid));
