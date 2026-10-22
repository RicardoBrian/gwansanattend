// 배포할 때마다 한 번: node bump-version.mjs
// 모든 모듈·스타일 주소 끝의 ?v=를 새 값으로 바꿔, 브라우저(특히 아이폰 Safari)가 예전 파일을 섞어 쓰지 못하게 한다.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const v = new Date().toISOString().slice(2, 16).replace(/\D/g, '');
for (const f of readdirSync('public').filter(n => /\.(js|html)$/.test(n))) {
  const p = `public/${f}`, t = readFileSync(p, 'utf8');
  const t2 = t.replace(/(\.(?:js|css))\?v=\w+/g, `$1?v=${v}`);
  if (t2 !== t) writeFileSync(p, t2);
}
console.log('버전', v);
