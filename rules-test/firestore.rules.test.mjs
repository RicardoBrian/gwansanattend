import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { readFileSync } from 'fs';
import {
  doc, setDoc, getDoc, updateDoc, deleteDoc, collection, getDocs, query, where, serverTimestamp,
} from 'firebase/firestore';

const testEnv = await initializeTestEnvironment({
  projectId: 'demo-gwansanattend',
  firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
});

let pass = 0, fail = 0;
const ok = async (label, p) => {
  try { await p; pass++; console.log('  PASS  ' + label); }
  catch (e) { fail++; console.log('->FAIL  ' + label + '  :: ' + e.message.split('\n')[0]); }
};

const user = (uid, email, verified = true) =>
  testEnv.authenticatedContext(uid, { email, email_verified: verified }).firestore();

const admin   = user('admin-uid', 'Boss@Gmail.com');      // 대소문자 섞여도 소문자로 비교
const kim     = user('kim-uid', 'kim@gmail.com');         // 허용된 담임
const lee     = user('lee-uid', 'lee@gmail.com');         // 허용된 다른 담임
const stranger = user('x-uid', 'stranger@gmail.com');     // 허용 안 됨
const unverified = user('u-uid', 'kim2@gmail.com', false);
const anon    = testEnv.unauthenticatedContext().firestore();

// 관리자·허용 목록은 콘솔에서 만든 것처럼 규칙을 우회해서 넣는다.
await testEnv.withSecurityRulesDisabled(async ctx => {
  const db = ctx.firestore();
  await setDoc(doc(db, 'admins/boss@gmail.com'), {});
  await setDoc(doc(db, 'allowed/kim@gmail.com'), { email: 'kim@gmail.com', note: '' });
  await setDoc(doc(db, 'allowed/lee@gmail.com'), { email: 'lee@gmail.com', note: '' });
  await setDoc(doc(db, 'allowed/kim2@gmail.com'), { email: 'kim2@gmail.com', note: '' });
});

const classData = (uid, email, over = {}) => ({
  year: 2026, grade: 2, cls: 1, ownerUid: uid, ownerEmail: email,
  teacherName: '김선생', offDays: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over,
});
const record = (over = {}) => ({
  no: 5, name: '홍길동', kind: '결석', cause: '질병', start: '2026-06-19', end: '2026-06-19',
  period: '', days: 1, reason: '감기', docs: ['진료확인서'], docsIn: false, neis: false, memo: '',
  reportId: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over,
});
const report = (over = {}) => ({
  no: 5, name: '홍길동', cause: '질병',
  items: { late: null, early: null, result: null, absent: { start: '2026-06-19', end: '2026-06-19', days: 1 } },
  reason: '감기', written: '2026-06-23', selfName: '홍길동', guardianName: '', method: '전화연락', methodEtc: '',
  confirmDate: '2026-06-19', confirmHour: '8', talker: '어머님', attach: '진료확인서', confirmedOn: '2026-06-23',
  teacherName: '김선생', recordIds: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...over,
});

console.log('\n[허용 목록]');
await ok('본인 allowed 문서 확인 가능', assertSucceeds(getDoc(doc(kim, 'allowed/kim@gmail.com'))));
await ok('남의 allowed 문서는 못 봄', assertFails(getDoc(doc(kim, 'allowed/lee@gmail.com'))));
await ok('허용 안 된 사람도 자기 문서 확인은 가능(없음 확인용)', assertSucceeds(getDoc(doc(stranger, 'allowed/stranger@gmail.com'))));
await ok('담임은 허용 목록 전체 조회 불가', assertFails(getDocs(collection(kim, 'allowed'))));
await ok('관리자는 허용 목록 조회', assertSucceeds(getDocs(collection(admin, 'allowed'))));
await ok('관리자는 계정 추가', assertSucceeds(setDoc(doc(admin, 'allowed/new@gmail.com'), { email: 'new@gmail.com', note: '박선생', addedAt: serverTimestamp() })));
await ok('대문자 이메일 문서는 거부', assertFails(setDoc(doc(admin, 'allowed/New2@gmail.com'), { email: 'New2@gmail.com', note: '', addedAt: serverTimestamp() })));
await ok('담임은 계정 추가 불가(자기 추천 방지)', assertFails(setDoc(doc(kim, 'allowed/friend@gmail.com'), { email: 'friend@gmail.com', note: '', addedAt: serverTimestamp() })));
await ok('허용 안 된 사람이 자기 자신 추가 불가', assertFails(setDoc(doc(stranger, 'allowed/stranger@gmail.com'), { email: 'stranger@gmail.com', note: '', addedAt: serverTimestamp() })));
await ok('관리자 목록은 앱에서 쓰기 불가', assertFails(setDoc(doc(admin, 'admins/kim@gmail.com'), {})));
await ok('관리자 본인 admins 문서 확인', assertSucceeds(getDoc(doc(admin, 'admins/boss@gmail.com'))));

console.log('\n[반 등록]');
await ok('비로그인 반 등록 거부', assertFails(setDoc(doc(anon, 'classes/2026-2-1'), classData('x', 'x'))));
await ok('허용 안 된 계정 반 등록 거부', assertFails(setDoc(doc(stranger, 'classes/2026-2-1'), classData('x-uid', 'stranger@gmail.com'))));
await ok('이메일 미인증 계정 거부', assertFails(setDoc(doc(unverified, 'classes/2026-2-1'), classData('u-uid', 'kim2@gmail.com'))));
await ok('없는 반 확인(get) 가능', assertSucceeds(getDoc(doc(kim, 'classes/2026-2-1'))));
await ok('반 ID와 학년·반이 다르면 거부', assertFails(setDoc(doc(kim, 'classes/2026-2-1'), classData('kim-uid', 'kim@gmail.com', { cls: 3 }))));
await ok('남의 uid로 등록 거부', assertFails(setDoc(doc(kim, 'classes/2026-2-1'), classData('lee-uid', 'kim@gmail.com'))));
await ok('김 담임 2학년 1반 등록', assertSucceeds(setDoc(doc(kim, 'classes/2026-2-1'), classData('kim-uid', 'kim@gmail.com'))));
await ok('이미 등록된 반은 다른 담임이 덮어쓰기 불가', assertFails(setDoc(doc(lee, 'classes/2026-2-1'), classData('lee-uid', 'lee@gmail.com'))));
await ok('다른 담임은 남의 반 정보 못 봄', assertFails(getDoc(doc(lee, 'classes/2026-2-1'))));
await ok('내 반 목록 조회', assertSucceeds(getDocs(query(collection(kim, 'classes'), where('ownerUid', '==', 'kim-uid')))));
await ok('필터 없는 반 전체 조회는 담임 불가', assertFails(getDocs(collection(kim, 'classes'))));
await ok('담임 이름·휴업일 수정', assertSucceeds(updateDoc(doc(kim, 'classes/2026-2-1'), { teacherName: '김담임', offDays: [{ date: '2026-05-04', label: '재량휴업일' }], updatedAt: serverTimestamp() })));
await ok('담임(owner) 바꾸기 불가', assertFails(updateDoc(doc(kim, 'classes/2026-2-1'), { ownerUid: 'lee-uid', updatedAt: serverTimestamp() })));

console.log('\n[학생·기록·신고서 — 담임만]');
await ok('명렬표 추가', assertSucceeds(setDoc(doc(kim, 'classes/2026-2-1/students/5'), { no: 5, name: '홍길동', guardian: '홍판서', updatedAt: serverTimestamp() })));
await ok('문서 ID와 번호가 다르면 거부', assertFails(setDoc(doc(kim, 'classes/2026-2-1/students/6'), { no: 7, name: 'x', guardian: '', updatedAt: serverTimestamp() })));
await ok('명렬표에 허용 안 된 필드(주민번호 등) 거부', assertFails(setDoc(doc(kim, 'classes/2026-2-1/students/8'), { no: 8, name: 'x', guardian: '', phone: '010', updatedAt: serverTimestamp() })));
await ok('출결 기록 추가', assertSucceeds(setDoc(doc(kim, 'classes/2026-2-1/records/r1'), record())));
await ok('없는 유형 거부', assertFails(setDoc(doc(kim, 'classes/2026-2-1/records/r2'), record({ cause: '무단' }))));
await ok('끝 날짜가 시작보다 빠르면 거부', assertFails(setDoc(doc(kim, 'classes/2026-2-1/records/r3'), record({ end: '2026-06-18' }))));
await ok('신고서 추가', assertSucceeds(setDoc(doc(kim, 'classes/2026-2-1/reports/p1'), report())));
await ok('미인정 신고서는 거부', assertFails(setDoc(doc(kim, 'classes/2026-2-1/reports/p2'), report({ cause: '미인정' }))));
await ok('기록 수정(나이스 체크)', assertSucceeds(updateDoc(doc(kim, 'classes/2026-2-1/records/r1'), { neis: true, updatedAt: serverTimestamp() })));
await ok('createdAt 위조 거부', assertFails(updateDoc(doc(kim, 'classes/2026-2-1/records/r1'), { createdAt: new Date(0), updatedAt: serverTimestamp() })));

await ok('다른 담임은 학생 못 읽음', assertFails(getDocs(collection(lee, 'classes/2026-2-1/students'))));
await ok('다른 담임은 기록 못 읽음', assertFails(getDocs(collection(lee, 'classes/2026-2-1/records'))));
await ok('다른 담임은 기록 못 씀', assertFails(setDoc(doc(lee, 'classes/2026-2-1/records/r9'), record())));
await ok('관리자도 학생 정보는 못 읽음', assertFails(getDocs(collection(admin, 'classes/2026-2-1/students'))));
await ok('관리자도 신고서는 못 읽음', assertFails(getDoc(doc(admin, 'classes/2026-2-1/reports/p1'))));
await ok('비로그인은 못 읽음', assertFails(getDocs(collection(anon, 'classes/2026-2-1/records'))));

console.log('\n[허용 해제·담임 교체]');
await ok('관리자는 반 목록 조회', assertSucceeds(getDocs(collection(admin, 'classes'))));
await testEnv.withSecurityRulesDisabled(ctx => deleteDoc(doc(ctx.firestore(), 'allowed/kim@gmail.com')));
await ok('허용 목록에서 빠지면 자기 반이어도 못 읽음', assertFails(getDocs(collection(kim, 'classes/2026-2-1/records'))));
await ok('관리자 반 등록 해제', assertSucceeds(deleteDoc(doc(admin, 'classes/2026-2-1'))));
await ok('해제 뒤 새 담임 등록', assertSucceeds(setDoc(doc(lee, 'classes/2026-2-1'), classData('lee-uid', 'lee@gmail.com'))));
await ok('새 담임은 기존 기록을 이어받음', assertSucceeds(getDocs(collection(lee, 'classes/2026-2-1/records'))));
await ok('담임 본인 학년 말 반 삭제', assertSucceeds(deleteDoc(doc(lee, 'classes/2026-2-1'))));

await testEnv.cleanup();
console.log(`\n${fail ? `${fail}개 실패` : '전부 통과'} (${pass}/${pass + fail})`);
process.exit(fail ? 1 : 0);
