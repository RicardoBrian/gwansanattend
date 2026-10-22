import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoster, decodeCsv, parseCsv } from '../public/csv.js';

test('선택한 반 학생만 골라낸다', () => {
  const csv = '학년,반,번호,이름,보호자명\n2,1,1,김가나,김부모\n2,2,1,다른반,\n2,1,2,"이, 다라",\n';
  const { students, errors, skipped } = parseRoster(csv, { grade: 2, cls: 1 });
  assert.deepEqual(errors, []);
  assert.equal(skipped, 1);
  assert.deepEqual(students, [
    { no: 1, name: '김가나', koName: '', guardian: '김부모' },
    { no: 2, name: '이, 다라', koName: '', guardian: '' },
  ]);
});

test('학년·반 열이 없으면 전부 이 반', () => {
  const { students } = parseRoster('번호,이름\r\n3,박\r\n1,최\r\n', { grade: 1, cls: 5 });
  assert.deepEqual(students.map(s => s.no), [1, 3]);
});

test('오류: 번호 중복·이름 없음·필수 열 없음', () => {
  const r = parseRoster('번호,이름\n1,가\n1,나\n2,\n', { grade: 1, cls: 1 });
  assert.equal(r.students.length, 1);
  assert.equal(r.errors.length, 2);
  assert.match(parseRoster('a,b\n1,2', { grade: 1, cls: 1 }).errors[0], /번호/);
});

test('엑셀 CP949(EUC-KR) 파일도 읽는다', () => {
  // "번호,이름\n1,홍길동" 의 EUC-KR 바이트
  const bytes = new Uint8Array([0xb9, 0xf8, 0xc8, 0xa3, 0x2c, 0xc0, 0xcc, 0xb8, 0xa7, 0x0a, 0x31, 0x2c, 0xc8, 0xab, 0xb1, 0xe6, 0xb5, 0xbf]);
  assert.deepEqual(parseCsv(decodeCsv(bytes)), [['번호', '이름'], ['1', '홍길동']]);
  const utf8 = new TextEncoder().encode('﻿번호,이름\n1,홍길동');
  assert.deepEqual(parseCsv(decodeCsv(utf8)), [['번호', '이름'], ['1', '홍길동']]);
});
