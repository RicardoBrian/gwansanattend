/**
 * Firestore 저장 계층.
 *
 * firestore.rules 와 정확히 맞물려야 한다 — 여기서 보내는 필드 목록이
 * 규칙의 hasOnly 목록과 다르면 저장이 거부된다.
 *
 *   admins/{email}                 관리자 (콘솔에서만 만든다)
 *   requests/{uid}                 승인 신청 (학년·반·이름) — 관리자가 승인하면 지워진다
 *   allowed/{email}                사용 허용된 선생님 계정 (승인 또는 관리자 직접 추가)
 *   classes/{연도-학년-반}          반. 처음 등록한 선생님이 담임(ownerUid)이 된다
 *     students/{번호}               명렬표
 *     records/{자동ID}              출결 기록
 *     reports/{자동ID}              결석신고서
 */
import { db, auth } from './firebase-config.js';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, getDocs,
  query, where, onSnapshot, writeBatch, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut as fbSignOut, onAuthStateChanged,
  setPersistence, browserSessionPersistence,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

// ── 로그인 ───────────────────────────────────────────

export function watchAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

export async function signIn() {
  // 교무실 공용 PC에서 다음 사람이 그대로 들어오지 않게, 브라우저를 닫으면 로그아웃된다.
  await setPersistence(auth, browserSessionPersistence);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    await signInWithPopup(auth, provider);
  } catch (e) {
    // 팝업이 막힌 환경(일부 모바일 브라우저)은 페이지 이동 방식으로 다시 시도
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
    } else throw e;
  }
}

export const signOut = () => fbSignOut(auth);

const emailOf = user => (user.email || '').toLowerCase();

/** 이 계정이 허용·관리자인지. 규칙은 자기 이메일 문서만 get 하게 해 준다. */
export async function checkAccess(user) {
  const e = emailOf(user);
  const [a, b] = await Promise.all([
    getDoc(doc(db, 'allowed', e)).catch(() => null),
    getDoc(doc(db, 'admins', e)).catch(() => null),
  ]);
  const admin = !!b?.exists();
  return { allowed: admin || !!a?.exists(), admin };
}

// ── 승인 신청 ─────────────────────────────────────────

export function watchMyRequest(cb, onErr) {
  return onSnapshot(doc(db, 'requests', auth.currentUser.uid), s => cb(s.exists() ? s.data() : null), onErr);
}

export function submitRequest({ year, grade, cls, name }) {
  const user = auth.currentUser;
  return setDoc(doc(db, 'requests', user.uid), {
    email: emailOf(user), name, year, grade, cls, createdAt: serverTimestamp(),
  });
}

export const cancelRequest = () => deleteDoc(doc(db, 'requests', auth.currentUser.uid));

export function watchRequests(cb, onErr) {
  return onSnapshot(collection(db, 'requests'), s => cb(s.docs.map(d => ({ uid: d.id, ...d.data() }))), onErr);
}

/**
 * 승인: 허용 목록 등록 + 신청한 반의 담임 지정 + 신청서 삭제를 한 번에.
 * 규칙은 관리자가 신청서 내용 그대로만 반을 만들 수 있게 검사한다.
 */
export async function approveRequest(rq) {
  const id = classIdOf(rq.year, rq.grade, rq.cls);
  const [cls, allowed] = await Promise.all([getDoc(doc(db, 'classes', id)), getDoc(doc(db, 'allowed', rq.email))]);
  if (cls.exists()) throw new Error(`${rq.grade}학년 ${rq.cls}반은 이미 ${cls.data().teacherName || cls.data().ownerEmail} 선생님이 등록했습니다. 먼저 등록 해제하거나 신청을 거절하세요.`);
  const b = writeBatch(db);
  if (!allowed.exists()) {
    b.set(doc(db, 'allowed', rq.email), { email: rq.email, note: `${rq.grade}-${rq.cls} ${rq.name}`.slice(0, 40), addedAt: serverTimestamp() });
  }
  b.set(doc(db, 'classes', id), {
    year: rq.year, grade: rq.grade, cls: rq.cls,
    ownerUid: rq.uid, ownerEmail: rq.email, teacherName: rq.name, offDays: [],
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  b.delete(doc(db, 'requests', rq.uid));
  await b.commit();
}

export const rejectRequest = uid => deleteDoc(doc(db, 'requests', uid));

// ── 반 ───────────────────────────────────────────────

export const classIdOf = (year, grade, cls) => `${year}-${grade}-${cls}`;

export async function myClasses() {
  const uid = auth.currentUser.uid;
  const snap = await getDocs(query(collection(db, 'classes'), where('ownerUid', '==', uid)));
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => b.year - a.year || a.grade - b.grade || a.cls - b.cls);
}

export function watchClass(cid, cb, onErr) {
  return onSnapshot(doc(db, 'classes', cid), s => cb(s.exists() ? { id: s.id, ...s.data() } : null), onErr);
}

export function updateClass(cid, patch) {
  const allowed = {};
  if ('teacherName' in patch) allowed.teacherName = patch.teacherName;
  if ('offDays' in patch) allowed.offDays = patch.offDays;
  return updateDoc(doc(db, 'classes', cid), { ...allowed, updatedAt: serverTimestamp() });
}

// ── 반 아래 컬렉션 공통 ───────────────────────────────

const sub = (cid, name) => collection(db, 'classes', cid, name);

export function watchSub(cid, name, cb, onErr) {
  return onSnapshot(sub(cid, name), s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), onErr);
}

const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, obj[k] ?? null]));

// ── 명렬표 ───────────────────────────────────────────

const STUDENT_FIELDS = ['no', 'name', 'guardian'];

export function saveStudent(cid, s) {
  const data = { ...pick(s, STUDENT_FIELDS), guardian: s.guardian || '', updatedAt: serverTimestamp() };
  return setDoc(doc(sub(cid, 'students'), String(s.no)), data);
}

export function deleteStudent(cid, no) {
  return deleteDoc(doc(sub(cid, 'students'), String(no)));
}

/** CSV로 명렬표 통째로 바꾸기. 새 명단에 없는 번호는 지운다(출결 기록은 이름이 따로 저장돼 있어 남는다). */
export async function replaceRoster(cid, students, current) {
  const keep = new Set(students.map(s => String(s.no)));
  const ops = [
    ...current.filter(s => !keep.has(String(s.no))).map(s => b => b.delete(doc(sub(cid, 'students'), String(s.no)))),
    ...students.map(s => b => b.set(doc(sub(cid, 'students'), String(s.no)), {
      no: s.no, name: s.name, guardian: s.guardian || '', updatedAt: serverTimestamp(),
    })),
  ];
  await runBatches(ops);
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
    return r.id;
  }
  const ref = await addDoc(sub(cid, 'records'), { ...data, createdAt: serverTimestamp() });
  return ref.id;
}

export function setRecordFlag(cid, id, patch) {
  const ok = {};
  for (const k of ['neis', 'docsIn']) if (k in patch) ok[k] = !!patch[k];
  return updateDoc(doc(sub(cid, 'records'), id), { ...ok, updatedAt: serverTimestamp() });
}

export function deleteRecord(cid, id) {
  return deleteDoc(doc(sub(cid, 'records'), id));
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
  return ref.id;
}

export async function deleteReport(cid, r, existingRecordIds) {
  const b = writeBatch(db);
  b.delete(doc(sub(cid, 'reports'), r.id));
  for (const id of r.recordIds || []) {
    if (existingRecordIds.has(id)) b.update(doc(sub(cid, 'records'), id), { reportId: null, updatedAt: serverTimestamp() });
  }
  await b.commit();
}

// ── 학년 말 정리 ──────────────────────────────────────

/** 반의 모든 데이터(명렬표·기록·신고서)와 반 등록까지 지운다. 되돌릴 수 없다. */
export async function wipeClass(cid) {
  const ops = [];
  for (const name of ['students', 'records', 'reports']) {
    const snap = await getDocs(sub(cid, name));
    snap.docs.forEach(d => ops.push(b => b.delete(d.ref)));
  }
  await runBatches(ops);
  await deleteDoc(doc(db, 'classes', cid));
}

// ── 관리자 ───────────────────────────────────────────

export async function listAllowed() {
  const snap = await getDocs(collection(db, 'allowed'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.id.localeCompare(b.id));
}

export function addAllowed(email, note) {
  const e = email.trim().toLowerCase();
  return setDoc(doc(db, 'allowed', e), { email: e, note: note || '', addedAt: serverTimestamp() });
}

export const removeAllowed = email => deleteDoc(doc(db, 'allowed', email));

export async function listAllClasses() {
  const snap = await getDocs(collection(db, 'classes'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => b.year - a.year || a.grade - b.grade || a.cls - b.cls);
}

/**
 * 반 등록 해제. 반 문서만 지우고 명렬표·기록·신고서는 남긴다
 * — 담임이 바뀐 경우 새 담임이 같은 반을 등록하면 그대로 이어받는다.
 */
export const releaseClass = cid => deleteDoc(doc(db, 'classes', cid));
