import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countSchoolDays, offReason, isDateStr, schoolYearOf, addDays } from '../public/dates.js';

test('주말과 공휴일은 결석 일수에서 빠진다', () => {
  // 2026-03-02(월)은 삼일절 대체공휴일 → 3/2~3/6 중 4일
  assert.equal(countSchoolDays('2026-03-02', '2026-03-06'), 4);
  // 금~월: 주말 2일 빠짐
  assert.equal(countSchoolDays('2026-03-06', '2026-03-09'), 2);
  // 추석 연휴 주간 9/24~9/28: 24·25 추석, 26 토, 27 일, 28 대체공휴일 → 0일
  assert.equal(countSchoolDays('2026-09-24', '2026-09-28'), 0);
  // 2026 제헌절(금) 재지정
  assert.equal(offReason('2026-07-17'), '제헌절');
  // 지방선거일
  assert.equal(countSchoolDays('2026-06-03', '2026-06-03'), 0);
});

test('하루짜리와 잘못된 범위', () => {
  assert.equal(countSchoolDays('2026-06-19', '2026-06-19'), 1);
  assert.equal(countSchoolDays('2026-06-19', ''), 1);
  assert.equal(countSchoolDays('2026-06-19', '2026-06-18'), 0);
  assert.equal(countSchoolDays('', '2026-06-18'), 0);
});

test('재량휴업일도 빠진다', () => {
  const off = [{ date: '2026-05-04', label: '재량휴업일' }];
  // 5/4(월) 재량, 5/5(화) 어린이날 → 5/4~5/8 중 3일
  assert.equal(countSchoolDays('2026-05-04', '2026-05-08', off), 3);
  assert.equal(offReason('2026-05-04', off), '재량휴업일');
});

test('날짜 형식 검사와 학년도', () => {
  assert.equal(isDateStr('2026-02-30'), false);
  assert.equal(isDateStr('2026-2-3'), false);
  assert.equal(isDateStr('2026-12-31'), true);
  assert.equal(schoolYearOf('2027-02-10'), 2026);
  assert.equal(schoolYearOf('2026-03-02'), 2026);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});
