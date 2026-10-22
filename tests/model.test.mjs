import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportFromRecords, circledKinds, needsReport } from '../public/model.js';
import { renderSheet, fitSize } from '../public/form.js';

const rec = over => ({ id: 'x', no: 18, name: 'LI SHIYU', kind: '결석', cause: '질병', start: '2026-03-10', end: '2026-03-10',
  period: '', days: 1, reason: '두통', docs: ['진료확인서'], ...over });

test('조퇴 + 결과 기록 → 신고서 한 장 (예시 1)', () => {
  const { report, warnings } = reportFromRecords([
    rec({ id: 'b', kind: '결과', start: '2026-03-06', end: '2026-03-06', period: '5', days: null, reason: '긴장형 두통' }),
    rec({ id: 'a', kind: '조퇴', start: '2026-03-05', end: '2026-03-05', period: '5', days: null, reason: '긴장형 두통' }),
  ], { student: { no: 18, name: 'LI SHIYU', guardian: '' }, teacherName: '오범석', today: '2026-03-09' });
  assert.deepEqual(warnings, []);
  assert.deepEqual(report.items.early, { date: '2026-03-05', period: '5' });
  assert.deepEqual(report.items.result, { date: '2026-03-06', period: '5' });
  assert.equal(report.items.absent, null);
  assert.equal(report.reason, '긴장형 두통');
  assert.equal(report.attach, '진료확인서');
  assert.equal(report.confirmDate, '2026-03-05');
  assert.deepEqual(report.recordIds, ['a', 'b']);
  assert.deepEqual(circledKinds(report), ['조퇴', '결과']);
});

test('결석 여러 건은 기간을 합친다', () => {
  const { report } = reportFromRecords([
    rec({ id: 'a', start: '2026-03-10', end: '2026-03-10', days: 1 }),
    rec({ id: 'b', start: '2026-03-11', end: '2026-03-12', days: 2, reason: '두통', docs: ['처방전'] }),
  ]);
  assert.deepEqual(report.items.absent, { start: '2026-03-10', end: '2026-03-12', days: 3 });
  assert.equal(report.attach, '진료확인서, 처방전');
});

test('미인정·기타는 신고서 대상이 아니다', () => {
  assert.equal(needsReport('미인정'), false);
  assert.equal(needsReport('기타'), false);
  assert.equal(needsReport('출석인정'), true);
  const { report, warnings } = reportFromRecords([rec({ cause: '출석인정' }), rec({ id: 'y', cause: '미인정', kind: '지각', period: '1' })]);
  assert.equal(report.cause, '출석인정');
  assert.equal(report.items.late, null);
  assert.ok(warnings.some(w => w.includes('미인정')));
});

test('신고서 그리기: 체크·동그라미·빈 보호자 칸·이름 이스케이프', () => {
  const { report } = reportFromRecords([rec({ name: 'A<b>' })], { student: { no: 18, name: 'A<b>', guardian: '' } });
  const html = renderSheet({ ...report, grade: 2, cls: 1 });
  assert.equal((html.match(/class="circle"/g) || []).length, 2); // 질병 + 결석
  assert.equal((html.match(/☑/g) || []).length, 4); // 안내문 2개 + 결석 + 전화연락
  assert.ok(!html.includes('<b>'));
  assert.ok(html.includes('A&lt;b&gt;'));
});

test('긴 글은 빈칸에 맞게 글자 크기를 줄인다', () => {
  assert.equal(fitSize('두통', 100, 12), 12);
  assert.ok(fitSize('아주 긴 사유가 들어가서 빈칸을 넘치는 경우를 확인합니다 정말로 깁니다', 378, 12) < 12);
});
