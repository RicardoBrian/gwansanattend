/* 교사 개인정보 처리 안내 — 네 앱(봉사·출결·학생 관리·방송부 관리) 공용. 원본: ~/code/workapps-merge/privacy-notice.js
   글을 고치면 VERSION 을 올린다 → 모두에게 다시 한 번 보인다. 앱마다 같은 파일을 복사해 둔다.

   PrivacyNotice.check({ email, app, read, write })
     로그인 직후 부른다. 이 판(VERSION)을 확인한 적이 없으면 안내 창을 띄우고, "확인"을 누르면 write 로 기록한다.
     read(email)        → Promise<{version}|null>   공용 DB privacyAcks/{email}
     write(email, data) → Promise                   data = {email, version, app} (앱이 at: 서버 시각을 더해 저장)
   PrivacyNotice.open()  → 안내만 다시 보기(아래쪽 "개인정보 처리 안내" 링크) */
(function () {
  'use strict';
  var VERSION = 1;
  var TEXT = [
    ['수집 항목', '구글 계정 이메일·이름, 로그인 기록, 담임 학년·반, 맡은 업무, (봉사 앱) 직접 올린 도장 이미지'],
    ['목적', '업무용 앱(출결·봉사·방송부·학생 관리)에서 사용자를 확인하고 권한(담임·관리자)을 주기 위해'],
    ['보관 기간', '사용하는 동안 보관하며, 전출·퇴직하거나 삭제를 요청하면 지체 없이 삭제'],
    ['처리 맡기는 곳', 'Google(Firebase). 데이터는 서울 리전에 저장되고, 로그인 인증은 구글의 국외 서버를 거칠 수 있음'],
    ['문의·삭제 요청', '운영자 오범석 선생님(관산중학교)'],
  ];
  var NOTE = '학생 개인정보 처리는 학년 초에 받은 동의에 따릅니다.';
  var KEY = function (email) { return 'privacyAck:' + email; };

  function el(tag, css, text) { var e = document.createElement(tag); if (css) e.style.cssText = css; if (text != null) e.textContent = text; return e; }

  function modal(onOk) {
    var old = document.getElementById('privacy-notice'); if (old) old.remove();
    var wrap = el('div', 'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;font-family:inherit;');
    wrap.id = 'privacy-notice';
    wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-labelledby', 'privacy-notice-title');
    var box = el('div', 'background:#fff;color:#1f2328;max-width:460px;width:100%;max-height:90vh;overflow:auto;border-radius:14px;padding:22px 22px 18px;box-shadow:0 10px 40px rgba(0,0,0,.25);font-size:14px;line-height:1.55;text-align:left;');
    var h = el('h2', 'margin:0 0 12px;font-size:17px;font-weight:700;', '교사 개인정보 처리 안내'); h.id = 'privacy-notice-title';
    box.appendChild(h);
    var dl = el('dl', 'margin:0;');
    TEXT.forEach(function (r) {
      dl.appendChild(el('dt', 'font-weight:600;margin-top:8px;', r[0]));
      dl.appendChild(el('dd', 'margin:2px 0 0;color:#444;', r[1]));
    });
    box.appendChild(dl);
    box.appendChild(el('p', 'margin:12px 0 0;color:#666;font-size:13px;', NOTE));
    var btn = el('button', 'margin-top:16px;width:100%;padding:10px;border:0;border-radius:10px;background:#2563eb;color:#fff;font-size:15px;font-weight:600;cursor:pointer;', '확인');
    btn.type = 'button';
    btn.onclick = function () { wrap.remove(); if (onOk) onOk(); };
    box.appendChild(btn);
    box.appendChild(el('p', 'margin:8px 0 0;color:#888;font-size:12px;text-align:center;', '안내 v' + VERSION + ' · 화면 아래 "개인정보 처리 안내"에서 다시 볼 수 있습니다.'));
    wrap.appendChild(box);
    if (!onOk) wrap.onclick = function (e) { if (e.target === wrap) wrap.remove(); };
    document.body.appendChild(wrap);
    btn.focus();
  }

  function mountLink() {
    if (document.getElementById('privacy-notice-link')) return;
    var a = el('a', 'display:block;text-align:center;font-size:12px;color:#888;margin:24px 0 16px;cursor:pointer;text-decoration:underline;', '개인정보 처리 안내');
    a.id = 'privacy-notice-link'; a.href = '#'; a.onclick = function (e) { e.preventDefault(); modal(null); };
    var st = el('style'); st.textContent = '@media print{#privacy-notice-link,#privacy-notice{display:none!important}}';
    document.head.appendChild(st);
    document.body.appendChild(a);
  }

  async function check(o) {
    var email = String(o.email || '').toLowerCase();
    if (!email) return;
    try { if (+localStorage.getItem(KEY(email)) >= VERSION) return; } catch (e) {}
    try {
      var r = await o.read(email);
      if (r && r.version >= VERSION) { try { localStorage.setItem(KEY(email), String(r.version)); } catch (e) {} return; }
    } catch (e) { console.warn('개인정보 안내 확인 기록을 읽지 못함', e); }
    modal(async function () {
      try {
        await o.write(email, { email: email, version: VERSION, app: o.app });
        try { localStorage.setItem(KEY(email), String(VERSION)); } catch (e) {}
      } catch (e) { console.warn('개인정보 안내 확인 기록을 남기지 못함', e); }
    });
  }

  window.PrivacyNotice = { VERSION: VERSION, check: check, open: function () { modal(null); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountLink); else mountLink();
})();
