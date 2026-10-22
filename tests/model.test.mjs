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
  assert.equal((html.match(/☑/g) || []).length, 3); // 안내문 2개 + 결석 (보호자 확인 기록이 없으면 확인방법은 비움)
  assert.ok(!html.includes('<b>'));
  assert.ok(html.includes('A&lt;b&gt;'));
});

test('긴 글은 빈칸에 맞게 글자 크기를 줄인다', () => {
  assert.equal(fitSize('두통', 100, 12), 12);
  assert.ok(fitSize('아주 긴 사유가 들어가서 빈칸을 넘치는 경우를 확인합니다 정말로 깁니다', 378, 12) < 12);
});

import { groupForReports } from '../public/model.js';

test('신고서 자동 묶음: 이어진 날짜끼리, 같은 종류 칸이 겹치면 새 장', () => {
  const R = (id, no, kind, start, end = start, cause = '질병') => ({ id, no, name: 'x', kind, cause, start, end, period: '1', days: 1, reportId: null });
  const groups = groupForReports([
    R('a', 18, '조퇴', '2026-03-05'),
    R('b', 18, '결과', '2026-03-06'),                 // 다음 수업일 → a와 한 장
    R('c', 18, '조퇴', '2026-03-09'),                 // 3/6(금) 다음 수업일 3/9(월)이지만 조퇴 칸이 이미 있음 → 새 장
    R('d', 18, '결석', '2026-03-20'),                 // 떨어짐 → 새 장
    R('e', 5, '결석', '2026-03-02', '2026-03-03'),
    R('f', 5, '결석', '2026-03-04'),                  // 이어짐 → e와 한 장
    R('g', 5, '지각', '2026-03-05', '2026-03-05', '출석인정'), // 구분이 다름 → 새 장
    R('h', 5, '지각', '2026-03-06', '2026-03-06', '미인정'),   // 신고서 대상 아님
    { ...R('i', 7, '결석', '2026-03-02'), reportId: 'already' }, // 이미 신고서 있음
  ]);
  assert.deepEqual(groups.map(g => g.map(r => r.id)), [['e', 'f'], ['g'], ['a', 'b'], ['c'], ['d']]);
});

test('기록의 보호자 확인이 신고서 확인서로 들어간다', () => {
  const { report } = reportFromRecords([
    rec({ id: 'a', start: '2026-03-10', method: '전화연락', confirmDate: '2026-03-10', confirmHour: '8', talker: '어머님' }),
  ]);
  assert.equal(report.method, '전화연락');
  assert.equal(report.confirmHour, '8');
  assert.equal(report.talker, '어머님');
  const { report: none } = reportFromRecords([rec({ id: 'b' })]);
  assert.equal(none.method, '');
  assert.equal(none.confirmDate, '2026-03-10');
});

test('작성일은 마지막 출결일 다음 수업일(오늘이 더 이르면 오늘)', () => {
  const r1 = reportFromRecords([rec({ start: '2026-03-10', end: '2026-03-11' })], { today: '2026-10-22' }).report;
  assert.equal(r1.written, '2026-03-12');
  const r2 = reportFromRecords([rec({ start: '2026-03-06', end: '2026-03-06' })], { today: '2026-10-22' }).report;
  assert.equal(r2.written, '2026-03-09'); // 금요일 다음 수업일은 월요일
  const r3 = reportFromRecords([rec({ start: '2026-10-22', end: '2026-10-22' })], { today: '2026-10-22' }).report;
  assert.equal(r3.written, '2026-10-22');
});
