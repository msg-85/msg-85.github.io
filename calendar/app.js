(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const { AppError, lockAt, isLocked, canEdit, canCreate, canRequest, REQ_FIELDS, isEtc, todayKst, discount } = window.Cal;
  const cfg = window.CAL_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const useDemo = params.has('demo') || !cfg.url || !cfg.anonKey;
  const api = useDemo ? new Cal.DemoBackend() : new Cal.SupabaseBackend(cfg.url, cfg.anonKey);

  const S = { user: null, y: 0, m: 0, sel: todayKst(), events: [], channels: [], products: [], users: [], requests: [], fCh: '', fBr: '' };
  const PALETTE = ['#2e7d6b', '#c2571a', '#3b62c4', '#a33ea1', '#b8860b', '#c0392b', '#00838f', '#6d4c41', '#5e35b1', '#558b2f'];
  const won = n => (n == null || n === '' ? '-' : Number(n).toLocaleString('ko-KR') + '원');
  const num = s => { if (s == null) return NaN; const t = String(s).replace(/[,\s원]/g, ''); return t === '' ? NaN : Number(t); };
  const ymd = (y, m, d) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
  const addDays = (s, k) => { const [y, m, d] = s.split('-').map(Number); return ymd(y, m - 1, d + k); };
  const dow = s => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
  const fmtD = s => { const [, m, d] = s.split('-').map(Number); return `${m}/${d}(${'일월화수목금토'[dow(s)]})`; };
  const fmtLock = ev => { const t = new Date(lockAt(ev.end_date) + 9 * 3600e3); return `${t.getUTCMonth() + 1}/${t.getUTCDate()} 09:00`; };
  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v != null && v !== false) e.setAttribute(k, v === true ? '' : v); }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : String(k));
    return e;
  };
  function toast(msg) { const t = el('div', { class: 'toast' }, msg); document.body.append(t); setTimeout(() => t.remove(), 2600); }
  const colorOf = code => { let h = 0; for (const c of String(code)) h = (h * 31 + c.charCodeAt(0)) >>> 0; const i = S.channels.findIndex(c => c.code === code); return PALETTE[(i >= 0 ? i : h) % PALETTE.length]; };
  const chDisp = e => chLabel(e.channel_code, e.channel) + (e.channel_detail ? `(${e.channel_detail})` : '');
  const chLabel = (code, fallback) => { const c = S.channels.find(x => x.code === code); return c ? (c.name === c.code || c.name.startsWith(c.code + '.') ? c.name : `${c.code}.${c.name}`) : (fallback || code); };
  // categories come from the current product master (so a re-uploaded master fixes old events too), else from the event's own copy
  const catOf = e => { const p = S.products.find(x => x.code === e.product_code); return { l: (p && p.cat_l) || e.cat_l || '', s: (p && p.cat_s) || e.cat_s || '' }; };
  const shortCh = s => String(s).replace(/^[A-Za-z]\d+\./, '');   // calendar bars: 'F1.쿠팡' -> '쿠팡' to save space
  const userName = id => { const u = S.users.find(x => x.id === id); return u ? u.display_name : '-'; };

  // ---------------- login ----------------
  // "아이디 저장": remember the login id on this device (never the password)
  const ID_KEY = 'evcal-saved-id' + (api.demo ? '-demo' : '');
  const savedId = () => { try { return localStorage.getItem(ID_KEY) || ''; } catch (e) { return ''; } };
  const rememberId = id => { try { if ($('lSave').checked && id) localStorage.setItem(ID_KEY, id.trim().toLowerCase()); else localStorage.removeItem(ID_KEY); } catch (e) {} };
  function showLogin() {
    $('mainView').hidden = true; $('loginView').hidden = false;
    const sid = savedId(); if (sid) { $('lId').value = sid; $('lSave').checked = true; setTimeout(() => $('lPw').focus(), 50); }
    if (api.demo) { $('demoLogin').hidden = false; $('demoLogin').textContent = '시연용 화면입니다 (데이터는 이 기기에만 저장). 마스터: master / 1234, 담당자: kim / 1234, 가입 코드: DEMO-2026'; }
  }
  $('toSignup').addEventListener('click', () => { const s = $('signupForm').hidden; $('signupForm').hidden = !s; $('loginForm').hidden = s; $('toSignup').textContent = s ? '이미 계정이 있으면 로그인하기' : '처음이신가요? 가입 코드로 등록하기'; });
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault(); $('lErr').hidden = true; $('lBtn').disabled = true;
    try { S.user = await api.login($('lId').value, $('lPw').value); $('lPw').value = ''; rememberId($('lId').value); await start(); }
    catch (x) { $('lErr').textContent = x.message; $('lErr').hidden = false; }
    $('lBtn').disabled = false;
  });
  $('signupForm').addEventListener('submit', async e => {
    e.preventDefault(); $('sErr').hidden = true; $('sBtn').disabled = true;
    try { S.user = await api.signup($('sCode').value, $('sId').value, $('sName').value, $('sPw').value); $('sPw').value = ''; rememberId($('sId').value); await start(); toast('등록되었습니다. 환영합니다!'); }
    catch (x) { $('sErr').textContent = x.message; $('sErr').hidden = false; }
    $('sBtn').disabled = false;
  });

  // ---------------- main ----------------
  async function start() {
    $('loginView').hidden = true; $('mainView').hidden = false;
    $('addBtn').hidden = $('delBtn').hidden = !(S.user.role === 'master' || S.user.role === 'manager');
    $('demoBar').hidden = !api.demo;
    if (api.demo) $('demoBar').textContent = `시연용 · ${S.user.name}(${S.user.role === 'master' ? '마스터' : S.user.role === 'manager' ? '담당자' : '조회'})로 보는 중 · 데이터는 이 기기에만 저장`;
    const t = todayKst().split('-').map(Number); S.y = t[0]; S.m = t[1] - 1;
    try { [S.channels, S.products, S.users] = await Promise.all([api.listChannels(), api.listProducts(), api.listUsers()]); }
    catch (x) { return fail(x); }
    fillFilters(); await load(); refreshRequests();
    if (S.user.mustChange) return changePw(true);
    // first login on this device (per role): show the short guide once
    try { const k = 'evcal-help-seen-' + S.user.role; if (!localStorage.getItem(k)) { localStorage.setItem(k, '1'); showHelp(); } } catch (e) {}
  }
  // ---------------- password ----------------
  // forced: logged in with a temporary password from the master; closing without changing logs out
  function changePw(forced) {
    const f = (ph, ac) => el('input', { class: 'in', type: 'password', placeholder: ph, autocomplete: ac, style: 'margin-top:8px' });
    const cur = f(forced ? '받은 임시 비밀번호' : '지금 비밀번호', 'current-password'), n1 = f('새 비밀번호 (6자 이상)', 'new-password'), n2 = f('새 비밀번호 한 번 더', 'new-password');
    const err = el('div', { class: 'err', hidden: true }), btn = el('button', { class: 'btn pri' }, '바꾸기');
    let done = false, close;
    btn.addEventListener('click', async () => {
      err.hidden = true;
      if (n1.value !== n2.value) { err.textContent = '새 비밀번호 두 칸이 서로 다릅니다.'; err.hidden = false; return; }
      btn.disabled = true;
      try { await api.changePassword(cur.value, n1.value); done = true; close(); toast('비밀번호를 바꿨습니다.'); }
      catch (x) { err.textContent = x.message; err.hidden = false; }
      btn.disabled = false;
    });
    n2.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
    close = sheet(forced ? '새 비밀번호 정하기' : '비밀번호 변경', el('div', {},
      forced ? el('div', { class: 'ok' }, '마스터가 준 임시 비밀번호로 로그인했습니다.\n계속 쓰려면 본인만 아는 새 비밀번호를 정해 주세요.') : null,
      cur, n1, n2, err, el('div', { class: 'acts' }, btn),
      el('p', { class: 's', style: 'color:var(--muted);font-size:13px' }, forced ? '창을 닫으면 로그아웃됩니다.' : '비밀번호를 잊었으면 마스터에게 "비밀번호 초기화"를 부탁하세요.')),
      () => { if (forced && !done) { api.logout(); S.user = null; showLogin(); toast('새 비밀번호를 정해야 쓸 수 있습니다.'); } });
    setTimeout(() => cur.focus(), 60);
  }
  function fail(x) { if (x.code === 401) { api.logout(); showLogin(); } else toast(x.message); }
  function fillFilters() {
    const ch = $('fChannel'), br = $('fBrand');
    ch.replaceChildren(el('option', { value: '' }, '전체 채널'), ...S.channels.map(c => el('option', { value: c.code }, chLabel(c.code))));
    const cats = [...new Set(S.products.map(p => p.cat_l).filter(Boolean))].sort();
    br.replaceChildren(el('option', { value: '' }, '전체 카테고리'), ...cats.map(b => el('option', { value: b }, b)));
    ch.value = S.fCh; br.value = S.fBr;
  }
  $('fChannel').addEventListener('change', e => { S.fCh = e.target.value; draw(); });
  $('fBrand').addEventListener('change', e => { S.fBr = e.target.value; draw(); });
  function gridRange() {
    const first = ymd(S.y, S.m, 1), last = ymd(S.y, S.m + 1, 0);
    return { from: addDays(first, -dow(first)), to: addDays(last, 6 - dow(last)) };
  }
  async function load() {
    const { from, to } = gridRange();
    try { S.events = await api.listEvents(from, to); } catch (x) { return fail(x); }
    draw();
  }
  const visible = () => S.events.filter(e => (!S.fCh || e.channel_code === S.fCh) && (!S.fBr || catOf(e).l === S.fBr));
  function draw() {
    $('monthLabel').textContent = `${S.y}년 ${S.m + 1}월`;
    const { from, to } = gridRange(), evs = visible(), today = todayKst(), grid = $('grid');
    grid.replaceChildren();
    const LANES = 3, LH = 18, TOP = 28;
    for (let ws = from; ws <= to; ws = addDays(ws, 7)) {
      const we = addDays(ws, 6), wk = el('div', { class: 'week' });
      const inWeek = evs.filter(e => e.start_date <= we && e.end_date >= ws)
        .sort((a, b) => a.start_date.localeCompare(b.start_date) || b.end_date.localeCompare(a.end_date));
      const lanes = [], hidden = new Array(7).fill(0), bars = [];
      for (const e of inWeek) {
        const s = e.start_date < ws ? 0 : dow(e.start_date), en = e.end_date > we ? 6 : dow(e.end_date);
        let li = lanes.findIndex(end => end < s); if (li < 0) { li = lanes.length; lanes.push(-1); } lanes[li] = en;
        if (li < LANES) bars.push({ e, s, en, li }); else for (let d = s; d <= en; d++) hidden[d]++;
      }
      const used = Math.min(lanes.length, LANES), hasMore = hidden.some(Boolean);
      wk.style.minHeight = (TOP + used * LH + (hasMore ? 14 : 0) + 6) + 'px';
      for (let i = 0; i < 7; i++) {
        const d = addDays(ws, i), [, mm, dd] = d.split('-').map(Number);
        const cls = ['day', mm - 1 !== S.m && 'out', d === today && 'today', d === S.sel && 'sel'].filter(Boolean).join(' ');
        wk.append(el('div', { class: cls, onclick: () => { S.sel = d; draw(); } }, el('div', { class: 'n' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') }, dd)));
        if (hidden[i]) { const m = el('div', { class: 'more' }, '+' + hidden[i]); m.style.left = (i / 7 * 100) + '%'; m.style.width = (100 / 7) + '%'; m.style.top = (TOP + used * LH) + 'px'; wk.append(m); }
      }
      for (const b of bars) {
        const bar = el('div', { class: 'bar' + (b.e.start_date < ws ? ' cont-l' : '') + (b.e.end_date > we ? ' cont-r' : '') }, `${shortCh(chLabel(b.e.channel_code, b.e.channel))} ${b.e.title}`);
        bar.style.left = `calc(${b.s / 7 * 100}% + 2px)`; bar.style.width = `calc(${(b.en - b.s + 1) / 7 * 100}% - 4px)`;
        bar.style.top = (TOP + b.li * LH) + 'px'; bar.style.background = colorOf(b.e.channel_code);
        wk.append(bar);
      }
      grid.append(wk);
    }
    drawDay();
  }
  function drawDay() {
    const d = S.sel, list = visible().filter(e => e.start_date <= d && e.end_date >= d);
    $('dayHead').replaceChildren(fmtD(d), el('small', {}, list.length ? `행사 ${list.length}건` : ''));
    $('dayList').replaceChildren(...(list.length ? list.map(card) : [el('div', { class: 'empty' }, '이 날 행사가 없습니다.')]));
  }
  function card(e) {
    return el('div', { class: 'card', onclick: () => openDetail(e) },
      el('div', { class: 'dot', style: 'background:' + colorOf(e.channel_code) }),
      el('div', { class: 'grow' },
        el('div', { class: 's' }, `${chDisp(e)} · ${fmtD(e.start_date)} ~ ${fmtD(e.end_date)}`),
        el('div', { class: 't' }, e.title),
        el('div', { class: 's' }, `${e.product_code} · ${e.product_name}`),
        el('div', { class: 'price' }, el('b', {}, won(e.sale_price)), el('del', {}, won(e.list_price)), el('span', { class: 'off' }, `${discount(e.list_price, e.sale_price)}%↓`),
          e.expected_qty != null ? el('span', { class: 's' }, `예상 ${Number(e.expected_qty).toLocaleString('ko-KR')}개`) : null),
        S.requests.some(r => r.event_id === e.id && r.status === 'pending') ? el('div', { class: 'lock' }, '⏳ 수정 요청 승인 대기') : null));
  }
  $('prevBtn').addEventListener('click', () => { S.m--; if (S.m < 0) { S.m = 11; S.y--; } S.sel = ymd(S.y, S.m, 1); load(); });
  $('nextBtn').addEventListener('click', () => { S.m++; if (S.m > 11) { S.m = 0; S.y++; } S.sel = ymd(S.y, S.m, 1); load(); });
  $('todayBtn').addEventListener('click', () => { const t = todayKst().split('-').map(Number); S.y = t[0]; S.m = t[1] - 1; S.sel = todayKst(); load(); });
  // swipe months
  let tx = null;
  $('grid').addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
  $('grid').addEventListener('touchend', e => { if (tx == null) return; const dx = e.changedTouches[0].clientX - tx; tx = null; if (Math.abs(dx) > 60) $(dx < 0 ? 'nextBtn' : 'prevBtn').click(); });

  // ---------------- sheets ----------------
  function sheet(title, body, onClose) {
    const scrim = el('div', { class: 'scrim' }), sh = el('div', { class: 'sheet', role: 'dialog', 'aria-label': title });
    const close = () => { scrim.remove(); document.body.style.overflow = ''; onClose && onClose(); };
    sh.append(el('div', { class: 'grab' }), el('div', { class: 'sh' }, el('h2', {}, title), el('button', { class: 'ib', 'aria-label': '닫기', onclick: close }, '✕')), body);
    scrim.append(sh); scrim.addEventListener('click', e => { if (e.target === scrim) close(); });
    document.body.append(scrim); document.body.style.overflow = 'hidden';
    return close;
  }
  function openDetail(e) {
    const mine = canEdit(S.user, e), past = e.end_date < todayKst();
    const body = el('div', {},
      el('div', { style: 'margin-bottom:10px' }, el('span', { class: 'badge' + (past ? ' locked' : '') }, past ? '지난 행사' : e.start_date > todayKst() ? '예정 행사' : '진행 중')),
      el('dl', { class: 'kv' },
        el('dt', {}, '채널'), el('dd', {}, chDisp(e)),
        el('dt', {}, '행사명'), el('dd', {}, e.title),
        el('dt', {}, '제품'), el('dd', {}, `${e.product_name}`, el('br'), el('span', { class: 's', style: 'color:var(--muted);font-size:13px' }, `${e.product_code} · ${[catOf(e).l, catOf(e).s].filter(Boolean).join(' / ')}`)),
        el('dt', {}, '기간'), el('dd', {}, `${fmtD(e.start_date)} ~ ${fmtD(e.end_date)}`),
        el('dt', {}, '단위당 정상가'), el('dd', {}, won(e.list_price)),
        el('dt', {}, '단위당 입수량'), el('dd', {}, e.pack_qty != null ? Number(e.pack_qty).toLocaleString('ko-KR') + '개' : '-'),
        el('dt', {}, '단위당 판매가'), el('dd', {}, el('b', {}, won(e.sale_price)), ' ', el('span', { class: 'off' }, `${discount(e.list_price, e.sale_price)}% 할인`)),
        el('dt', {}, '예상수량'), el('dd', {}, e.expected_qty != null ? Number(e.expected_qty).toLocaleString('ko-KR') + '개' : '-'),
        el('dt', {}, '메모'), el('dd', {}, e.memo || '-'),
        el('dt', {}, '등록'), el('dd', {}, userName(e.created_by)),
        el('dt', {}, '최근 수정'), el('dd', {}, `${userName(e.updated_by)} · ${new Date(e.updated_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}`)));
    let close;
    if (mine) body.append(el('div', { class: 'acts' },
      el('button', { class: 'btn del', onclick: async () => { if (!confirm('이 일정을 삭제할까요?')) return; try { await api.deleteEvent(e.id); close(); toast('삭제했습니다.'); load(); } catch (x) { toast(x.message); } } }, '삭제'),
      el('button', { class: 'btn pri', onclick: () => { close(); openForm(e); } }, '수정')));
    else if (canRequest(S.user, e)) {
      const pend = S.requests.filter(r => r.event_id === e.id && r.status === 'pending');
      body.append(pend.length
        ? el('div', { class: 'ok', style: 'margin-top:14px' }, `⏳ 마스터 승인 대기 중인 요청이 ${pend.length}건 있습니다. (☰ 메뉴 → 내 요청에서 확인)`)
        : el('div', {}, el('div', { class: 'pick', style: 'margin-top:14px' }, '고칠 내용이 있으면 수정 요청을 보내 주세요. 마스터가 승인하면 반영됩니다.'),
          el('div', { class: 'acts' },
            el('button', { class: 'btn del', onclick: () => { close(); requestDelete(e); } }, '삭제 요청'),
            el('button', { class: 'btn pri', onclick: () => { close(); openForm(e, 'request'); } }, '수정 요청'))));
    }
    else if (S.user.role === 'manager') body.append(el('div', { class: 'pick', style: 'margin-top:14px' }, '담당 채널이 아닌 행사는 보기만 할 수 있습니다.'));
    close = sheet('행사 상세', body);
  }
  function requestDelete(e) {
    const reason = el('textarea', { class: 'in', rows: 3, placeholder: '예: 행사 취소됨' }), err = el('div', { class: 'err' }); err.hidden = true;
    const go = el('button', { class: 'btn del' }, '삭제 요청 보내기');
    let close;
    go.addEventListener('click', async () => {
      err.hidden = true; go.disabled = true;
      try { await api.createRequest({ event_id: e.id, kind: 'delete', reason: reason.value }); close(); toast('삭제 요청을 보냈습니다.'); await refreshRequests(); }
      catch (x) { err.textContent = x.message; err.hidden = false; }
      go.disabled = false;
    });
    close = sheet('삭제 요청', el('div', {},
      el('p', {}, el('b', {}, `${chLabel(e.channel_code, e.channel)} · ${e.title}`), el('br'), `${fmtD(e.start_date)} ~ ${fmtD(e.end_date)}`),
      el('div', { class: 'f' }, el('label', {}, '요청 사유 ', el('i', {}, '*')), reason), err, el('div', { class: 'acts' }, go)));
  }

  // ---------------- change requests ----------------
  const FIELD_LABEL = { channel_code: '채널', channel_detail: '세부 채널명', title: '행사명', product_code: '제품', start_date: '시작일', end_date: '종료일', list_price: '단위당 정상가', sale_price: '단위당 판매가', pack_qty: '단위당 입수량', expected_qty: '예상수량', memo: '메모' };
  const showVal = (k, v) => v == null || v === '' ? '-' : k === 'channel_code' ? chLabel(v) : k === 'product_code' ? `${v} · ${(S.products.find(p => p.code === v) || {}).name || ''}` : /price/.test(k) ? won(v) : k === 'expected_qty' || k === 'pack_qty' ? Number(v).toLocaleString('ko-KR') + '개' : String(v);
  const SEEN_KEY = () => 'evcal-req-seen-' + (S.user ? S.user.id : '');
  function badgeCount() {
    if (!S.user) return 0;
    if (S.user.role === 'master') return S.requests.filter(r => r.status === 'pending').length;
    let seen = 0; try { seen = +localStorage.getItem(SEEN_KEY()) || 0; } catch (e) {}
    return S.requests.filter(r => r.status !== 'pending' && r.decided_at && Date.parse(r.decided_at) > seen).length;
  }
  function drawBadge() { const n = badgeCount(), b = $('menuBadge'); b.hidden = !n; b.textContent = n > 99 ? '99+' : n; }
  async function refreshRequests() {
    if (!S.user || S.user.role === 'viewer') { S.requests = []; return drawBadge(); }
    try { S.requests = await api.listRequests(); } catch (x) { if (x.code === 401) return fail(x); }
    drawBadge();
  }
  setInterval(() => { if (S.user && document.visibilityState === 'visible') refreshRequests(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (S.user && document.visibilityState === 'visible') refreshRequests(); });
  function requestCard(r, isM, redraw) {
    const b = r.kind === 'create' ? (r.changes || {}) : (r.before_row || {}), st = { pending: ['⏳ 대기', 'badge'], approved: ['✅ 승인', 'badge'], rejected: ['❌ 반려', 'badge locked'] }[r.status];
    const rows = r.kind === 'delete' ? [el('div', { style: 'color:var(--danger);font-weight:600' }, '일정 삭제 요청')]
      : r.kind === 'create' ? [el('div', { style: 'color:var(--brand);font-weight:600' }, '🆕 신규 행사 등록 요청'), ...['product_code', 'list_price', 'sale_price', 'pack_qty', 'expected_qty', 'memo'].filter(k => b[k] != null && b[k] !== '').map(k => el('div', { style: 'font-size:14px' }, el('span', { style: 'color:var(--muted)' }, FIELD_LABEL[k] + ': '), showVal(k, b[k])))]
      : Object.entries(r.changes || {}).map(([k, v]) => el('div', { style: 'font-size:14px' }, el('span', { style: 'color:var(--muted)' }, FIELD_LABEL[k] + ': '), showVal(k, b[k]), ' → ', el('b', {}, showVal(k, v))));
    const box = el('div', { class: 'li', style: 'display:block' },
      el('div', { class: 'row' }, el('span', { class: st[1] }, st[0]), el('b', { class: 'grow' }, `${chDisp(b)} · ${b.title || ''}`)),
      el('div', { class: 's', style: 'color:var(--muted);font-size:12px;margin:2px 0 6px' }, `${b.start_date || ''} ~ ${b.end_date || ''} · 요청 ${userName(r.requested_by)} · ${new Date(r.requested_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}`),
      ...rows,
      el('div', { style: 'font-size:14px;margin-top:4px' }, el('span', { style: 'color:var(--muted)' }, '사유: '), r.reason),
      r.status !== 'pending' ? el('div', { class: 's', style: 'font-size:13px;margin-top:4px;color:var(--muted)' }, `${userName(r.decided_by)} · ${new Date(r.decided_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}${r.comment ? ' · ' + r.comment : ''}`) : null);
    if (isM && r.status === 'pending') {
      const act = async approve => {
        const comment = approve ? '' : prompt('반려 사유를 적어 주세요 (담당자에게 보입니다)', '');
        if (!approve && comment === null) return;
        try { await api.decideRequest(r.id, approve, comment); toast(approve ? '승인하고 일정에 반영했습니다.' : '반려했습니다.'); await refreshRequests(); load(); redraw(); }
        catch (x) { toast(x.message); }
      };
      box.append(el('div', { class: 'acts' }, el('button', { class: 'btn del', onclick: () => act(false) }, '반려'), el('button', { class: 'btn pri', onclick: () => act(true) }, '승인')));
    }
    return box;
  }
  async function showRequests() {
    await refreshRequests();
    const isM = S.user.role === 'master', wrap = el('div');
    const redraw = () => {
      const pend = S.requests.filter(r => r.status === 'pending'), done = S.requests.filter(r => r.status !== 'pending');
      wrap.replaceChildren(
        el('h3', { style: 'margin:4px 0 8px' }, isM ? `승인 대기 (${pend.length})` : `대기 중 (${pend.length})`),
        el('div', { class: 'list' }, ...(pend.length ? pend.map(r => requestCard(r, isM, redraw)) : [el('div', { class: 'li' }, '대기 중인 요청이 없습니다.')])),
        el('h3', { style: 'margin:18px 0 8px' }, `처리 완료 (${done.length})`),
        el('div', { class: 'list' }, ...(done.length ? done.slice(0, 100).map(r => requestCard(r, isM, redraw)) : [el('div', { class: 'li' }, '처리된 요청이 없습니다.')])));
    };
    redraw();
    if (!isM) { try { localStorage.setItem(SEEN_KEY(), String(Date.now())); } catch (e) {} drawBadge(); }
    sheet(isM ? '요청 승인' : '내 요청', el('div', {},
      el('p', { class: 's', style: 'color:var(--muted);margin-top:0;font-size:13px' }, isM ? '승인하면 일정에 바로 반영되고, 변경 이력에 "요청 #번호 승인"으로 남습니다.' : '내가 보낸 등록·수정·삭제 요청과 결과입니다.'),
      wrap));
  }

  // product search box: type part of the product number or name -> suggestions below
  function productPicker(initialCode, onPick) {
    const box = el('div', { class: 'f' }), input = el('input', { class: 'in', placeholder: '제품번호·제품명 일부 입력', autocomplete: 'off' });
    const sug = el('div', { class: 'sug' }); sug.hidden = true;
    const info = el('div', { class: 'pick' });
    let chosen = S.products.find(p => p.code === initialCode) || null;
    const show = p => { info.textContent = p ? `선택됨: ${p.code} · ${p.name}${p.list_price ? ' · 정상가 ' + won(p.list_price) : ''}` : '목록에서 제품을 눌러 선택해 주세요.'; info.style.color = p ? '' : 'var(--danger)'; };
    if (chosen) input.value = chosen.code + ' · ' + chosen.name;
    const search = () => {
      const q = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const hits = S.products.filter(p => p.active !== false && q.every(w => (p.code + ' ' + p.name).toLowerCase().includes(w))).slice(0, 40);
      sug.replaceChildren(...(hits.length ? hits.map(p => el('button', { type: 'button', onmousedown: ev => ev.preventDefault(), onclick: () => { chosen = p; input.value = p.code + ' · ' + p.name; sug.hidden = true; show(p); onPick(p); } },
        `${p.code} · ${p.name}`, el('small', {}, [p.cat_l, p.cat_s].filter(Boolean).join(' / ') + (p.list_price ? ' · ' + won(p.list_price) : '')))) : [el('div', { class: 'li' }, '맞는 제품이 없습니다.')]));
      sug.hidden = !q.length && !hits.length;
    };
    input.addEventListener('input', () => { chosen = null; show(null); onPick(null); search(); });
    input.addEventListener('focus', search);
    input.addEventListener('blur', () => setTimeout(() => { sug.hidden = true; }, 150));
    box.append(el('label', {}, '제품 ', el('i', {}, '*')), el('div', { style: 'position:relative' }, input, sug), info);
    show(chosen);
    return { box, get: () => chosen };
  }
  // mode 'request': same form, but it sends a change request (with a reason) instead of saving
  function openForm(e, mode) {
    const isNewReq = mode === 'create-request', isReq = mode === 'request' || isNewReq, isNew = !e, v = e ? { ...e } : { start_date: S.sel, end_date: S.sel };
    const f = id => document.getElementById(id);
    const myCh = S.user.role === 'manager' && (S.user.channels || []).length ? S.user.channels : null;
    const chList = S.channels.filter(c => (c.active !== false && (!myCh || myCh.includes(c.code))) || c.code === v.channel_code);
    const chSel = el('select', { class: 'in', id: 'fe_ch' }, el('option', { value: '' }, '채널 선택'), ...chList.map(c => el('option', { value: c.code }, chLabel(c.code))));
    chSel.value = v.channel_code || (chList.length === 1 ? chList[0].code : '');
    const chDet = el('input', { class: 'in', id: 'fe_chd', value: v.channel_detail || '', placeholder: '예: 지역 할인점명', style: 'margin-top:8px' });
    const chDetBox = el('div', {}, el('label', { style: 'display:block;font-size:13px;color:var(--muted);margin:8px 0 0' }, '세부 채널명 ', el('i', { style: 'color:var(--danger);font-style:normal' }, '*')), chDet);
    const syncEtc = () => { const c = S.channels.find(x => x.code === chSel.value); chDetBox.hidden = !(c && isEtc(c.name)); };
    chSel.addEventListener('change', syncEtc);
    const lp = el('input', { class: 'in', id: 'fe_lp', inputmode: 'numeric', value: v.list_price != null ? Number(v.list_price).toLocaleString('ko-KR') : '' });
    const sp = el('input', { class: 'in', id: 'fe_sp', inputmode: 'numeric', value: v.sale_price != null ? Number(v.sale_price).toLocaleString('ko-KR') : '' });
    const calc = el('div', { class: 'calc' });
    const upd = () => { const a = num(lp.value), b = num(sp.value); calc.textContent = a > 0 && b >= 0 ? `할인율 ${discount(a, b)}% (정상가 ${won(a)} → ${won(b)})` : '정상가와 판매단가를 넣으면 할인율이 자동 계산됩니다.'; };
    const commas = inp => inp.addEventListener('input', () => { const n = num(inp.value); if (!isNaN(n)) inp.value = n.toLocaleString('ko-KR'); upd(); });
    commas(lp); commas(sp);
    const pp = productPicker(v.product_code, p => { if (p && p.list_price && (!lp.value || isNew)) { lp.value = Number(p.list_price).toLocaleString('ko-KR'); upd(); } });
    const err = el('div', { class: 'err' }); err.hidden = true;
    const saveBtn = el('button', { class: 'btn pri', type: 'submit' }, isReq ? '마스터에게 요청 보내기' : isNew ? '등록' : '저장');
    const reason = el('textarea', { class: 'in', id: 'fe_reason', rows: 2, placeholder: isNewReq ? '(선택) 마스터에게 남길 말' : '예: 거래처 요청으로 판매단가 정정' });
    const form = el('form', {},
      el('div', { class: 'f' }, el('label', {}, '채널 ', el('i', {}, '*')), chSel, chDetBox, myCh ? el('div', { class: 'pick' }, '본인 담당 채널만 보입니다.') : null),
      el('div', { class: 'f' }, el('label', {}, '행사명 ', el('i', {}, '*')), el('input', { class: 'in', id: 'fe_title', value: v.title || '', placeholder: '예: 월초 특가' })),
      pp.box,
      el('div', { class: 'two' },
        el('div', { class: 'f' }, el('label', {}, '시작일 ', el('i', {}, '*')), el('input', { class: 'in', type: 'date', id: 'fe_s', value: v.start_date })),
        el('div', { class: 'f' }, el('label', {}, '종료일 ', el('i', {}, '*')), el('input', { class: 'in', type: 'date', id: 'fe_e', value: v.end_date }))),
      el('div', { class: 'two' },
        el('div', { class: 'f' }, el('label', {}, '단위당 정상가 (원) ', el('i', {}, '*')), lp),
        el('div', { class: 'f' }, el('label', {}, '단위당 판매가 (원) ', el('i', {}, '*')), sp)),
      calc,
      el('div', { class: 'f' }, el('label', {}, '단위당 입수량 ', el('i', {}, '*')), el('input', { class: 'in', id: 'fe_pk', inputmode: 'numeric', value: v.pack_qty ?? '', placeholder: '예: 24' })),
      el('div', { class: 'f' }, el('label', {}, '예상수량 (선택)'), el('input', { class: 'in', id: 'fe_q', inputmode: 'numeric', value: v.expected_qty ?? '' })),
      el('div', { class: 'f' }, el('label', {}, '메모 (선택)'), el('textarea', { class: 'in', id: 'fe_memo', rows: 2 }, v.memo || '')),
      isReq ? el('div', { class: 'f' }, el('label', {}, isNewReq ? '전달 메모 (선택)' : '요청 사유 ', isNewReq ? null : el('i', {}, '*')), reason) : null,
      el('div', { class: 'pick' }, isNewReq ? '등록 요청을 보내면 마스터가 승인한 뒤 달력에 올라갑니다.' : isReq ? '바꿀 값만 고친 뒤 사유를 적어 보내세요. 마스터가 승인하면 반영됩니다.' : '마스터가 직접 저장하면 바로 반영됩니다.'),
      err, el('div', { class: 'acts' }, saveBtn));
    upd(); syncEtc();
    let close;
    form.addEventListener('submit', async ev => {
      ev.preventDefault(); err.hidden = true;
      const p = pp.get(); const q = f('fe_q').value.trim();
      const pk = f('fe_pk').value.trim(), chObj = S.channels.find(x => x.code === chSel.value);
      if (chObj && isEtc(chObj.name) && !chDet.value.trim()) { err.textContent = '"기타" 채널은 세부 채널명을 적어 주세요.'; err.hidden = false; return; }
      const out = { id: v.id, channel_code: chSel.value, channel_detail: chObj && isEtc(chObj.name) ? chDet.value.trim() : '', title: f('fe_title').value, product_code: p ? p.code : '', start_date: f('fe_s').value, end_date: f('fe_e').value,
        list_price: num(lp.value), sale_price: num(sp.value), pack_qty: pk === '' ? null : num(pk), expected_qty: q === '' ? null : num(q), memo: f('fe_memo').value.trim() };
      if (!p) { err.textContent = '제품을 목록에서 눌러 선택해 주세요.'; err.hidden = false; return; }
      if (isNewReq) {
        const changes = {}; for (const k of REQ_FIELDS) changes[k] = out[k] ?? null;
        saveBtn.disabled = true;
        try { await api.createRequest({ kind: 'create', changes, reason: reason.value }); close(); toast('등록 요청을 보냈습니다. 마스터가 승인하면 달력에 올라갑니다.'); await refreshRequests(); }
        catch (x) { err.textContent = x.message; err.hidden = false; }
        saveBtn.disabled = false; return;
      }
      if (isReq) {
        const changes = {}; for (const k of REQ_FIELDS) { const a = out[k] ?? null, b = v[k] ?? null; if (String(a ?? '') !== String(b ?? '')) changes[k] = a; }
        saveBtn.disabled = true;
        try { await api.createRequest({ event_id: v.id, kind: 'update', changes, reason: reason.value }); close(); toast('요청을 보냈습니다. 마스터가 승인하면 반영됩니다.'); await refreshRequests(); }
        catch (x) { err.textContent = x.message; err.hidden = false; }
        saveBtn.disabled = false; return;
      }
      saveBtn.disabled = true;
      try { const r = await api.saveEvent(out); close(); toast(isNew ? '등록했습니다.' : '저장했습니다.'); S.sel = r.start_date <= S.sel && r.end_date >= S.sel ? S.sel : r.start_date; const [yy, mm] = S.sel.split('-').map(Number); S.y = yy; S.m = mm - 1; load(); }
      catch (x) { err.textContent = x.message; err.hidden = false; }
      saveBtn.disabled = false;
    });
    close = sheet(isNewReq ? '신규 행사 등록 요청' : isReq ? '수정 요청' : isNew ? '행사 등록' : '행사 수정', form);
  }
  $('addBtn').addEventListener('click', () => openForm(null, S.user.role === 'master' ? null : 'create-request'));
  $('delBtn').addEventListener('click', pickDelete);
  // − button: pick several events of the month shown; master deletes them, managers send delete requests
  function pickDelete() {
    const isM = S.user.role === 'master', m0 = ymd(S.y, S.m, 1), m1 = ymd(S.y, S.m + 1, 0);
    const pend = new Set(S.requests.filter(r => r.status === 'pending' && r.event_id).map(r => r.event_id));
    const all = visible().filter(e => e.start_date <= m1 && e.end_date >= m0).sort((a, b) => a.start_date.localeCompare(b.start_date) || chDisp(a).localeCompare(chDisp(b)));
    const ok = all.filter(e => isM || (canRequest(S.user, e) && !pend.has(e.id)));
    const skipped = all.length - ok.length;
    const q = el('input', { class: 'in', type: 'search', placeholder: '찾기: 채널·행사명·제품' }), list = el('div', { class: 'dlist' }), cnt = el('span', {});
    const reason = el('textarea', { class: 'in', rows: 2, placeholder: '예: 행사 취소됨' }), err = el('div', { class: 'err' }); err.hidden = true;
    const go = el('button', { class: 'btn del' }, isM ? '삭제하기' : '삭제 요청 보내기');
    const picked = new Set();
    const upd = () => { cnt.textContent = picked.size ? `${picked.size}건 선택` : ''; go.disabled = !picked.size; };
    const rows = ok.map(e => {
      const cb = el('input', { type: 'checkbox' });
      cb.addEventListener('change', () => { cb.checked ? picked.add(e.id) : picked.delete(e.id); upd(); });
      const r = el('label', { class: 'dpick' }, cb, el('div', {},
        el('div', { class: 's' }, `${chDisp(e)} · ${fmtD(e.start_date)} ~ ${fmtD(e.end_date)}`), el('div', {}, el('b', {}, e.title)), el('div', { class: 's' }, `${e.product_code} · ${e.product_name}`)));
      r.dataset.q = [chDisp(e), e.title, e.product_code, e.product_name].join(' ').toLowerCase();
      return r;
    });
    list.append(...(rows.length ? rows : [el('div', { class: 'empty' }, isM ? '이번 달 행사가 없습니다.' : '이번 달에 삭제 요청할 수 있는 행사가 없습니다.')]));
    q.addEventListener('input', () => { const t = q.value.trim().toLowerCase(); for (const r of rows) r.hidden = !!t && !r.dataset.q.includes(t); });
    let close;
    go.addEventListener('click', async () => {
      err.hidden = true;
      if (!isM && !reason.value.trim()) { err.textContent = '요청 사유를 적어 주세요.'; err.hidden = false; return; }
      if (isM && !confirm(`고른 행사 ${picked.size}건을 삭제할까요? 되돌릴 수 없습니다.`)) return;
      go.disabled = true; let done = 0; const fails = [];
      for (const id of picked) {
        const e = ok.find(x => x.id === id);
        try { if (isM) await api.deleteEvent(id); else await api.createRequest({ event_id: id, kind: 'delete', reason: reason.value }); done++; }
        catch (x) { fails.push(`${e ? e.title : id}: ${x.message}`); }
        go.textContent = `처리 중 ${done + fails.length}/${picked.size}`;
      }
      if (fails.length) { err.textContent = `${done}건 완료, ${fails.length}건 실패 · ` + fails.join(' / '); err.hidden = false; go.textContent = isM ? '삭제하기' : '삭제 요청 보내기'; }
      else close();
      toast(isM ? `${done}건 삭제했습니다.` : `삭제 요청 ${done}건을 보냈습니다.`);
      if (isM) load(); else await refreshRequests();
    });
    upd();
    close = sheet(isM ? `행사 골라서 삭제 (${S.m + 1}월)` : `삭제 요청 (${S.m + 1}월)`, el('div', {},
      el('p', { class: 'pick', style: 'margin-top:0' }, (isM ? '지우려는 행사를 체크하세요. 바로 삭제됩니다.' : '삭제할 행사를 체크하세요. 마스터가 승인하면 삭제됩니다.') + (skipped ? ` (담당 채널이 아니거나 승인 대기 중인 ${skipped}건은 빠졌습니다)` : '') + ' 다른 달은 달력을 넘긴 뒤 − 를 누르세요.'),
      q, list, el('div', { class: 'pick' }, cnt),
      isM ? null : el('div', { class: 'f' }, el('label', {}, '요청 사유 ', el('i', {}, '*')), reason),
      err, el('div', { class: 'acts' }, go)));
  }

  // ---------------- menu ----------------
  $('menuBtn').addEventListener('click', () => {
    const isM = S.user.role === 'master', canWrite = isM || S.user.role === 'manager';
    let close;
    const mi = (label, fn) => el('button', { class: 'mi', onclick: () => { close(); fn(); } }, label);
    const body = el('div', { class: 'menu' },
      el('div', { class: 'li', style: 'border:0;padding-left:4px' }, el('div', {}, el('b', {}, S.user.name), el('div', { class: 's', style: 'color:var(--muted);font-size:13px' }, `${S.user.login} · ${isM ? '마스터' : S.user.role === 'manager' ? '담당자' : '조회'}`))),
      canWrite ? el('div', { class: 'sec' }, '요청') : null,
      canWrite ? mi((isM ? '📨 요청 승인 (등록·수정·삭제)' : '📨 내 요청 (등록·수정·삭제)') + (badgeCount() ? ` (${badgeCount()})` : ''), showRequests) : null,
      el('div', { class: 'sec' }, '엑셀'),
      mi('📥 일정 엑셀로 내려받기', exportEvents),
      canWrite ? mi(isM ? '📤 일정 엑셀로 한꺼번에 등록' : '📤 일정 엑셀로 한꺼번에 등록 요청', () => importEvents()) : null,
      isM ? el('div', { class: 'sec' }, '마스터') : null,
      isM ? mi('🔑 가입 코드 · 사용자 관리', manageUsers) : null,
      isM ? mi('📋 기준정보 (채널 · 제품) 올리기', masterData) : null,
      isM ? mi('🕘 변경 이력', showLog) : null,
      el('div', { class: 'sec' }, '기타'),
      mi('❓ 사용 안내', showHelp),
      mi('🔒 비밀번호 변경', () => changePw(false)),
      isStandalone() ? null : mi('📱 홈 화면에 앱으로 설치', install),
      mi('🌓 화면 색: ' + THEME_LABEL[getTheme()] + ' (누르면 바뀜)', () => { const order = ['auto', 'light', 'dark'], nx = order[(order.indexOf(getTheme()) + 1) % 3]; setTheme(nx); toast('화면 색: ' + THEME_LABEL[nx]); }),
      api.demo ? mi('🔄 시연 데이터 처음으로 되돌리기', () => { api.reset(); api.logout(); location.reload(); }) : null,
      mi('로그아웃', () => { api.logout(); S.user = null; showLogin(); }));
    close = sheet('메뉴', body);
  });
  function download(blob, name) { const a = el('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); }
  // upload form = download form: the first 9 columns are read back; '(자동)' columns are filled on download and ignored on upload
  const EV_HEAD = ['채널', '세부채널명', '행사명', '제품번호', '시작일', '종료일', '단위당 정상가', '단위당 판매가', '단위당 입수량', '예상수량', '메모'];
  const EV_AUTO = ['제품명(자동)', '대카테고리(자동)', '소카테고리(자동)', '할인율%(자동)', '등록자(자동)'];
  const evRow = e => [chLabel(e.channel_code, e.channel), e.channel_detail || '', e.title, e.product_code, e.start_date, e.end_date, Number(e.list_price), Number(e.sale_price), e.pack_qty ?? '', e.expected_qty ?? '', e.memo || '',
    e.product_name || '', catOf(e).l, catOf(e).s, discount(e.list_price, e.sale_price) ?? '', e.created_by ? userName(e.created_by) : ''];
  // download by month range: events that overlap [first day of from-month, last day of to-month]
  function exportEvents() {
    const t = todayKst().split('-').map(Number), cur = t[0] * 12 + t[1] - 1;
    const ym = i => `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`;
    const opts = sel => { const s = el('select', { class: 'in' }); for (let i = cur + 12; i >= 2024 * 12; i--) s.append(el('option', { value: i }, `${Math.floor(i / 12)}년 ${i % 12 + 1}월`)); s.value = sel; return s; };
    const from = opts(cur), to = opts(cur), msg = el('div', { class: 'err' }); msg.hidden = true;
    const preset = (a, b) => { from.value = a; to.value = b; };
    const go = el('button', { class: 'btn pri', style: 'margin-top:12px;width:100%' }, '엑셀로 받기');
    go.addEventListener('click', async () => {
      let a = +from.value, b = +to.value; if (a > b) [a, b] = [b, a];
      msg.hidden = true; go.disabled = true; go.textContent = '받는 중…';
      try {
        const d0 = ym(a) + '-01', d1 = ymd(Math.floor(b / 12), b % 12 + 1, 0);
        const list = await api.listEvents(d0, d1);
        if (!list.length) throw new Error('선택한 기간에 행사가 없습니다.');
        const rows = [[...EV_HEAD, ...EV_AUTO], ...list.map(evRow)];
        download(await buildXlsx([{ name: '행사일정', rows, header: true }]), `행사일정_${ym(a).replace('-', '')}${a === b ? '' : '-' + ym(b).replace('-', '')}.xlsx`);
        close(); toast(`${list.length}건 받았습니다.`);
      } catch (x) { msg.textContent = x.message; msg.hidden = false; go.disabled = false; go.textContent = '엑셀로 받기'; }
    });
    const chip = (label, a, b) => el('button', { class: 'btn', style: 'flex:1;padding:8px 4px', onclick: () => preset(a, b) }, label);
    const close = sheet('일정 엑셀로 내려받기', el('div', {},
      el('p', { class: 's', style: 'color:var(--muted);margin-top:0' }, '받을 연월을 고르세요. 기간에 하루라도 걸친 행사가 모두 들어갑니다 (예: 10/28~11/3 행사는 10월·11월 둘 다).'),
      el('div', { style: 'display:flex;gap:6px;margin-bottom:10px' }, chip('이번 달', cur, cur), chip('지난 달', cur - 1, cur - 1), chip('최근 3개월', cur - 2, cur), chip('다음 달', cur + 1, cur + 1)),
      el('div', { style: 'display:flex;gap:8px;align-items:center' }, el('div', { class: 'f', style: 'flex:1;margin:0' }, el('label', {}, '시작 월'), from), el('span', { style: 'padding-top:18px' }, '~'), el('div', { class: 'f', style: 'flex:1;margin:0' }, el('label', {}, '끝 월'), to)),
      msg, go));
  }
  function excelDate(v) {
    if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
    const m = /^(\d{4})[-./년 ]\s*(\d{1,2})[-./월 ]\s*(\d{1,2})/.exec(String(v).trim());
    return m ? ymd(+m[1], +m[2] - 1, +m[3]) : '';
  }
  function importEvents() {
    const isM = S.user.role === 'master';
    const file = el('input', { type: 'file', accept: '.xlsx,.csv', class: 'in' }), msg = el('div'), go = el('button', { class: 'btn pri', disabled: true }, isM ? '등록하기' : '등록 요청 보내기');
    let ready = [];
    file.addEventListener('change', async () => {
      msg.replaceChildren(); go.disabled = true; ready = [];
      try {
        const rows = (await readTable(file.files[0])).filter(r => r.some(c => c !== ''));
        const head = rows.shift().map(h => String(h).trim());
        const ALIAS = { '단위당 정상가': ['정상가'], '단위당 판매가': ['판매단가', '판매가'], '제품번호': ['제품코드'] };
        const ix = n => { let i = head.indexOf(n); for (const a of ALIAS[n] || []) if (i < 0) i = head.indexOf(a); return i; };
        const miss = ['채널', '행사명', '제품번호', '시작일', '종료일', '단위당 정상가', '단위당 판매가', '단위당 입수량'].filter(h => ix(h) < 0);
        if (miss.length) throw new AppError('양식의 머리글이 다릅니다. 없는 열: ' + miss.join(', '));
        const errs = [];
        rows.forEach((r, i) => {
          const g = n => (ix(n) >= 0 ? r[ix(n)] ?? '' : ''), pcode = String(g('제품번호')).trim(), p = S.products.find(x => x.code === pcode), craw = String(g('채널')).trim(), chm = S.channels.find(c => c.code === craw || c.name === craw), ccode = chm ? chm.code : craw;
          const e = { channel_code: ccode, channel_detail: String(g('세부채널명')).trim(), pack_qty: g('단위당 입수량') === '' ? null : num(g('단위당 입수량')), title: String(g('행사명')).trim(), product_code: pcode, start_date: excelDate(g('시작일')), end_date: excelDate(g('종료일')),
            list_price: g('단위당 정상가') === '' && p ? Number(p.list_price) : num(g('단위당 정상가')), sale_price: num(g('단위당 판매가')), expected_qty: g('예상수량') !== '' ? num(g('예상수량')) : null, memo: String(g('메모')).trim() };
          const why = [];
          if (!chm) why.push('채널 없음(' + craw + ')');
          if (!p) why.push('제품번호 없음(' + pcode + ')');
          if (!e.title) why.push('행사명 없음');
          if (!e.start_date || !e.end_date) why.push('날짜 확인'); else if (e.end_date < e.start_date) why.push('종료일이 시작일보다 빠름');
          if (!(e.list_price > 0)) why.push('단위당 정상가 확인'); if (!(e.sale_price >= 0)) why.push('단위당 판매가 확인');
          if (!(Number.isInteger(e.pack_qty) && e.pack_qty > 0)) why.push('단위당 입수량 확인');
          if (chm && isEtc(chm.name) && !e.channel_detail) why.push('기타 채널은 세부채널명 필요');
          if (chm && !isM && (S.user.channels || []).length && !S.user.channels.includes(chm.code)) why.push('담당 채널 아님');
          if (why.length) errs.push(`${i + 2}행: ${why.join(', ')}`); else ready.push(e);
        });
        msg.append(el('div', { class: 'ok' }, `${isM ? '등록할 수 있는 행' : '등록 요청할 수 있는 행'} ${ready.length}개`));
        if (errs.length) msg.append(el('div', { class: 'err' }, `확인이 필요한 행 ${errs.length}개 (이 행들은 빼고 등록됩니다)\n` + errs.slice(0, 30).join('\n') + (errs.length > 30 ? `\n… 외 ${errs.length - 30}개` : '')));
        go.disabled = !ready.length;
      } catch (x) { msg.append(el('div', { class: 'err' }, x.message)); }
    });
    let close;
    go.addEventListener('click', async () => {
      go.disabled = true;
      try {
        if (isM) { await api.importEvents(ready); close(); toast(`${ready.length}건 등록했습니다.`); load(); }
        else { for (const e of ready) await api.createRequest({ kind: 'create', changes: e, reason: '엑셀 일괄 등록' }); close(); toast(`${ready.length}건 등록 요청을 보냈습니다. 마스터가 승인하면 달력에 올라갑니다.`); refreshRequests(); }
      }
      catch (x) { msg.append(el('div', { class: 'err' }, x.message)); go.disabled = false; }
    });
    close = sheet(isM ? '일정 엑셀로 등록' : '일정 엑셀로 등록 요청', el('div', {},
      el('p', { class: 's', style: 'color:var(--muted);margin-top:0' }, '양식은 "엑셀로 내려받기" 파일과 같습니다. 앞의 11개 열(채널~메모)만 읽고, (자동) 열은 비워도 됩니다. 세부채널명은 "기타" 채널일 때만 씁니다. 단위당 정상가를 비우면 제품 기준정보의 정상가가 들어갑니다. 날짜는 2026-11-01 형식이나 엑셀 날짜 모두 됩니다.' + (isM ? '' : ' 담당자가 올리면 한 줄씩 등록 요청으로 마스터에게 갑니다.')),
      el('button', { class: 'btn', style: 'margin-bottom:12px', onclick: async () => download(await buildXlsx([{ name: '일정등록', rows: [[...EV_HEAD, ...EV_AUTO], ['F1.쿠팡', '', '월초 특가 (예시 줄, 지우고 쓰세요)', '2105345', todayKst(), addDays(todayKst(), 6), 1500, 1250, 24, 1000, '']], header: true },
        { name: '채널목록', rows: [['채널'], ...S.channels.map(c => [chLabel(c.code)])], header: true },
        { name: '제품번호', rows: [['제품번호', '제품번호 Name', '대카테고리', '소카테고리'], ...S.products.map(p => [p.code, p.name, p.cat_l || '', p.cat_s || ''])], header: true }]), '일정등록_양식.xlsx') }, '📄 양식 내려받기'),
      file, msg, el('div', { class: 'acts' }, go)));
  }
  function masterData() {
    const part = (kind) => {
      const isP = kind === 'products', head = isP ? ['대카테고리', '소카테고리', '제품번호', '제품번호 Name', '정상가'] : ['경로세부'];
      const file = el('input', { type: 'file', accept: '.xlsx,.csv', class: 'in' }), msg = el('div');
      file.addEventListener('change', async () => {
        msg.replaceChildren();
        try {
          const rows = (await readTable(file.files[0])).filter(r => r.some(c => c !== ''));
          // find the header row (first row that has the key column) and match columns loosely:
          // "대카테고리(기획실)" counts as 대카테고리, "제품번호 Name"/"제품명" as the name, etc.
          const norm = s => String(s).replace(/\s+/g, '').toLowerCase();
          const find = (h, ...names) => h.findIndex(x => names.some(n => norm(x) === norm(n) || norm(x).startsWith(norm(n) + '(')));
          let hi = rows.findIndex(r => find(r, ...(isP ? ['제품번호', '제품코드'] : ['경로세부', '채널', '채널코드'])) >= 0);
          if (hi < 0) throw new AppError(isP ? '"제품번호" 열을 찾지 못했습니다.' : '"경로세부" (또는 채널코드·채널명) 열을 찾지 못했습니다.');
          const h = rows[hi]; const body = rows.slice(hi + 1);
          const seen = new Set(), list = [];
          if (isP) {
            const iCode = find(h, '제품번호', '제품코드'), iName = find(h, '제품번호Name', '제품명', 'Name'), iL = find(h, '대카테고리'), iS = find(h, '소카테고리'), iP = find(h, '정상가');
            if (iName < 0) throw new AppError('"제품번호 Name" (또는 제품명) 열을 찾지 못했습니다.');
            for (const r of body) {
              const code = String(r[iCode] ?? '').trim(); if (!code || seen.has(code)) continue; seen.add(code);
              list.push({ code, name: String(r[iName] ?? '').trim(), cat_l: iL >= 0 ? String(r[iL] ?? '').trim() : '', cat_s: iS >= 0 ? String(r[iS] ?? '').trim() : '', list_price: iP >= 0 && r[iP] !== '' ? num(r[iP]) : null, active: true });
            }
          } else {
            const iC = find(h, '채널코드'), iN = find(h, '채널명'), iR = find(h, '경로세부', '채널');
            for (const r of body) {
              let code, name;
              if (iC >= 0 && iN >= 0) { code = String(r[iC] ?? '').trim(); name = String(r[iN] ?? '').trim(); }
              else { code = name = String(r[iR] ?? '').trim(); }   // "A1.상온" kept whole as the channel name
              if (!code || seen.has(code)) continue; seen.add(code); list.push({ code, name, sort_no: list.length + 1, active: true });
            }
          }
          if (!list.length) throw new AppError('올릴 내용이 없습니다.');
          const bad = list.filter(x => !x.name);
          if (bad.length) throw new AppError(`이름이 비어 있는 행이 ${bad.length}개 있습니다: ${bad.slice(0, 5).map(x => x.code).join(', ')}`);
          if (isP) await api.upsertProducts(list); else await api.upsertChannels(list);
          if (isP) S.products = await api.listProducts(); else S.channels = await api.listChannels();
          fillFilters(); draw();
          msg.append(el('div', { class: 'ok' }, `${list.length}개를 올렸습니다. 같은 코드는 새 내용으로 바뀌고, 새 코드는 추가됩니다.`));
        } catch (x) { msg.append(el('div', { class: 'err' }, x.message)); }
        file.value = '';
      });
      const cur = isP ? S.products.map(p => [p.cat_l || '', p.cat_s || '', p.code, p.name, p.list_price ?? '']) : S.channels.map(c => [chLabel(c.code)]);
      return el('div', { style: 'margin-bottom:22px' },
        el('h3', { style: 'margin:6px 0' }, isP ? `제품 (${S.products.length}개)` : `채널 (${S.channels.length}개)`),
        el('button', { class: 'btn', style: 'margin-bottom:8px', onclick: async () => download(await buildXlsx([{ name: isP ? '제품' : '채널', rows: [head, ...cur], header: true }]), (isP ? '제품' : '채널') + '_기준정보.xlsx') }, '📄 현재 목록을 양식으로 받기'),
        file, msg);
    };
    sheet('기준정보 올리기', el('div', {},
      el('p', { class: 's', style: 'color:var(--muted);margin-top:0' }, '엑셀 첫 줄에 머리글을 그대로 두고 올려 주세요. 같은 코드가 있으면 내용이 바뀌고, 없는 코드는 추가됩니다 (지워지지는 않음).'),
      part('channels'), part('products')));
  }
  // checkbox list of channels with a search box; get() returns the chosen channel codes
  function channelPicker(selected) {
    const chosen = new Set(selected || []), q = el('input', { class: 'in', placeholder: '채널 검색 (예: 쿠팡, G1)', style: 'margin-bottom:6px' });
    const info = el('div', { class: 'pick' }), list = el('div', { style: 'max-height:200px;overflow:auto;border:1px solid var(--line);border-radius:10px;padding:4px 8px' });
    const draw = () => {
      const w = q.value.trim().toLowerCase();
      list.replaceChildren(...S.channels.filter(c => !w || chLabel(c.code).toLowerCase().includes(w)).map(c => {
        const cb = el('input', { type: 'checkbox' }); cb.checked = chosen.has(c.code);
        cb.addEventListener('change', () => { cb.checked ? chosen.add(c.code) : chosen.delete(c.code); show(); });
        return el('label', { style: 'display:flex;gap:8px;align-items:center;padding:6px 0;font-size:15px' }, cb, chLabel(c.code));
      }));
    };
    const show = () => { info.textContent = chosen.size ? '담당 채널: ' + [...chosen].map(c => chLabel(c)).join(', ') : '담당 채널 미지정 (모든 채널 가능)'; };
    q.addEventListener('input', draw); draw(); show();
    return { box: el('div', {}, q, list, info), get: () => [...chosen] };
  }
  async function manageUsers() {
    let invites = [], users = [];
    try { [invites, users] = await Promise.all([api.listInvites(), api.listUsers()]); } catch (x) { return toast(x.message); }
    S.users = users;
    const role = el('select', { class: 'in', style: 'flex:1' }, el('option', { value: 'manager' }, '담당자 (등록 가능)'), el('option', { value: 'viewer' }, '조회만'), el('option', { value: 'master' }, '마스터'));
    const note = el('input', { class: 'in', placeholder: '누구에게 줄 코드인지 (예: 쿠팡 김OO)', style: 'margin-top:8px' });
    const invCh = channelPicker([]);
    const out = el('div');
    const invList = el('div', { class: 'list' });
    const roleK = r => (r === 'master' ? '마스터' : r === 'manager' ? '담당자' : '조회');
    const drawInv = () => invList.replaceChildren(...(invites.length ? invites.map(i => el('div', { class: 'li' },
      el('div', { class: 'grow' }, el('span', { class: 'code' }, i.code), el('div', { class: 's', style: 'color:var(--muted);font-size:12px' }, `${roleK(i.role)} · ${i.note || ''}${(i.channels || []).length ? ' · ' + i.channels.map(c => chLabel(c)).join(', ') : ''} · ${i.used_by ? '사용됨: ' + (users.find(u => u.id === i.used_by) || {}).display_name : i.revoked ? '회수됨' : '미사용'}`)),
      !i.used_by && !i.revoked ? el('button', { class: 'btn del', onclick: async () => { if (!confirm('이 코드를 회수할까요?')) return; await api.revokeInvite(i.code); i.revoked = true; drawInv(); } }, '회수') : null)) : [el('div', { class: 'li' }, '발급한 코드가 없습니다.')]));
    drawInv();
    const userList = el('div', { class: 'list' }, ...users.map(u => {
      const sel = el('select', { class: 'in', style: 'width:auto;padding:6px' }, ...['master', 'manager', 'viewer'].map(r => el('option', { value: r }, roleK(r))));
      sel.value = u.role; sel.disabled = u.id === S.user.id;
      sel.addEventListener('change', async () => { try { await api.setUser(u.id, { role: sel.value }); toast('권한을 바꿨습니다.'); } catch (x) { toast(x.message); } });
      const act = el('button', { class: 'btn' + (u.active ? ' del' : ''), disabled: u.id === S.user.id }, u.active ? '중지' : '다시 사용');
      act.addEventListener('click', async () => { try { await api.setUser(u.id, { active: !u.active }); u.active = !u.active; act.textContent = u.active ? '중지' : '다시 사용'; act.className = 'btn' + (u.active ? ' del' : ''); } catch (x) { toast(x.message); } });
      const chInfo = el('div', { class: 's', style: 'color:var(--muted);font-size:12px' }, (u.channels || []).length ? '담당: ' + u.channels.map(c => chLabel(c)).join(', ') : (u.role === 'manager' ? '담당 채널 미지정' : ''));
      const pwBtn = u.id === S.user.id ? null : el('button', { class: 'lnk', style: 'border:0;background:none;padding:2px 0;color:var(--accent,#2e7d6b);font-size:12px;cursor:pointer;text-decoration:underline' }, '비밀번호 초기화');
      if (pwBtn) pwBtn.addEventListener('click', async () => {
        if (!confirm(u.display_name + '(' + u.login + ')의 비밀번호를 임시 비밀번호로 바꿀까요?\n지금 쓰던 비밀번호는 바로 안 되고, 다른 기기 로그인도 끊깁니다.')) return;
        try {
          const temp = await api.resetPassword(u.id);
          const msg = '[행사 일정 캘린더] ' + location.origin + location.pathname + '\n아이디: ' + u.login + '\n임시 비밀번호: ' + temp + '\n로그인하면 새 비밀번호를 정하는 화면이 나옵니다.';
          sheet('임시 비밀번호', el('div', {},
            el('div', { class: 'ok' }, u.display_name + '님의 임시 비밀번호입니다. 본인에게만 전달하세요.\n\n', el('span', { class: 'code' }, temp)),
            el('div', { class: 'acts' }, el('button', { class: 'btn pri', onclick: () => navigator.clipboard.writeText(msg).then(() => toast('복사했습니다.')) }, '안내 문구 복사')),
            el('p', { class: 's', style: 'color:var(--muted);font-size:13px' }, '이 창을 닫으면 다시 볼 수 없습니다. 잊으면 한 번 더 초기화하면 됩니다.')));
        } catch (x) { toast(x.message); }
      });
      const chBtn = el('button', { class: 'btn', style: 'padding:6px 10px' }, '채널');
      chBtn.addEventListener('click', () => {
        const pk = channelPicker(u.channels || []); let close2;
        const save = el('button', { class: 'btn pri' }, '저장');
        save.addEventListener('click', async () => { try { const v = pk.get(); await api.setUser(u.id, { channels: v }); u.channels = v; chInfo.textContent = v.length ? '담당: ' + v.map(c => chLabel(c)).join(', ') : '담당 채널 미지정'; close2(); toast('담당 채널을 바꿨습니다.'); } catch (x) { toast(x.message); } });
        close2 = sheet(u.display_name + ' 담당 채널', el('div', {}, pk.box, el('div', { class: 'acts' }, save)));
      });
      return el('div', { class: 'li' }, el('div', { class: 'grow' }, el('b', {}, u.display_name), el('div', { class: 's', style: 'color:var(--muted);font-size:12px' }, u.login), chInfo, pwBtn), u.role === 'manager' ? chBtn : null, sel, act);
    }));
    sheet('가입 코드 · 사용자', el('div', {},
      el('h3', { style: 'margin:4px 0 8px' }, '새 가입 코드 만들기'),
      el('div', { class: 'row' }, role, el('button', { class: 'btn pri', onclick: async () => {
        try { const inv = await api.createInvite(role.value, note.value.trim(), invCh.get()); invites.unshift(inv); drawInv(); note.value = '';
          out.replaceChildren(el('div', { class: 'ok' }, '코드가 만들어졌습니다. 아래 안내를 복사해 전달하세요.\n\n', el('span', { class: 'code' }, inv.code)),
            el('button', { class: 'btn', onclick: () => navigator.clipboard.writeText(`[행사 일정 캘린더] ${location.origin + location.pathname}\n가입 코드: ${inv.code}\n처음 들어가서 "가입 코드로 등록하기"를 누르고 코드·아이디·이름·비밀번호를 넣어 주세요.`).then(() => toast('복사했습니다.')) }, '안내 문구 복사'));
        } catch (x) { toast(x.message); } } }, '만들기')),
      note, el('div', { style: 'margin-top:10px;font-size:13px;color:var(--muted)' }, '담당 채널 (여러 개 선택 가능, 담당자만 해당)'), invCh.box, out,
      el('h3', { style: 'margin:18px 0 8px' }, '발급한 코드'), invList,
      el('h3', { style: 'margin:18px 0 8px' }, `사용자 (${users.length}명)`), userList,
      el('p', { class: 's', style: 'color:var(--muted);font-size:13px' }, '중지하면 그 사람은 바로 로그인해도 아무것도 볼 수 없습니다. 등록했던 일정은 그대로 남습니다.')));
  }
  async function showLog() {
    let log; try { log = await api.listLog(200); } catch (x) { return toast(x.message); }
    const act = { insert: '등록', update: '수정', delete: '삭제' }, F = { channel: '채널', title: '행사명', product_name: '제품', start_date: '시작일', end_date: '종료일', list_price: '정상가', sale_price: '판매단가', expected_qty: '예상수량', memo: '메모' };
    sheet('변경 이력 (최근 200건)', el('div', { class: 'list' }, ...(log.length ? log.map(l => {
      const r = l.new_row || l.old_row || {}, ch = l.old_row && l.new_row ? Object.keys(F).filter(k => String(l.old_row[k] ?? '') !== String(l.new_row[k] ?? '')).map(k => `${F[k]}: ${l.old_row[k] ?? '-'} → ${l.new_row[k] ?? '-'}`) : [];
      return el('div', { class: 'li', style: 'display:block' },
        el('div', {}, el('b', {}, act[l.action] || l.action), ` · ${r.channel || ''} ${r.title || ''}`, l.note ? el('span', { class: 'badge', style: 'margin-left:6px' }, l.note) : null),
        el('div', { class: 's', style: 'color:var(--muted);font-size:12px' }, `${userName(l.actor)} · ${new Date(l.at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}`),
        ch.length ? el('div', { style: 'font-size:13px;margin-top:4px' }, ch.join(' / ')) : null);
    }) : [el('div', { class: 'li' }, '변경 이력이 없습니다.')])));
  }
  // ---------------- in-app guide ----------------
  function showHelp() {
    const role = S.user ? S.user.role : 'manager', isM = role === 'master';
    const sec = (title, ...lines) => el('div', { style: 'margin-bottom:14px' }, el('h3', { style: 'margin:0 0 6px;font-size:16px' }, title),
      el('ul', { style: 'margin:0;padding-left:20px;line-height:1.6' }, ...lines.map(l => el('li', {}, l))));
    const body = el('div', {},
      el('p', { style: 'margin-top:0;color:var(--muted)' }, '행사 일정은 마스터가 확정해서 올리고, 담당자는 요청을 보내는 방식입니다. 그래서 등록된 행사는 마스터 승인 없이 바뀌지 않습니다.'),
      sec('📅 보기',
        '달력을 좌우로 밀면 달이 바뀌고, 날짜를 누르면 아래에 그날 행사가 나옵니다.',
        '위쪽에서 채널·대카테고리로 골라 볼 수 있습니다.',
        '행사를 누르면 제품·기간·정상가·판매단가·할인율이 나옵니다. 할인율은 자동 계산입니다.'),
      isM ? sec('👑 마스터',
        '＋ 버튼이나 행사 상세의 [수정]·[삭제]로 직접 등록·수정합니다. 바로 반영됩니다.',
        '여러 개를 지울 때: 오른쪽 아래 − → 그 달 행사를 체크 → [삭제하기].',
        '☰ 옆 빨간 숫자 = 승인 대기 요청 수. ☰ → 요청 승인에서 기존 값과 요청 값을 비교한 뒤 [승인] 또는 [반려]를 누릅니다.',
        '승인하면 바로 반영되고, 변경 이력에 "요청 #번호 승인"으로 남습니다. 반려 사유는 담당자에게 보입니다.',
        '☰ → 가입 코드 관리에서 담당자 코드를 만들어 전달합니다. 그만둔 사람은 [중지]합니다.',
        '☰ → 기준정보 올리기에서 채널·제품 목록을 엑셀로 바꿉니다.')
      : sec('✍️ 담당자: 모든 변경은 요청으로',
        '신규 행사: 오른쪽 아래 ＋ → 내용 입력 → [마스터에게 요청 보내기]. 승인되면 달력에 올라갑니다.',
        '삭제 요청: 오른쪽 아래 − → 그 달 행사 중 지울 것을 체크 → 사유 적고 [삭제 요청 보내기]. 여러 건을 한 번에 보낼 수 있습니다.',
        '기존 행사 수정: 행사 누르기 → [수정 요청] → 기존 내용이 채워진 화면에서 바꿀 값만 고치고 사유를 적어 보냅니다.',
        '삭제: 행사 누르기 → [삭제 요청] → 사유 입력.',
        '수정·삭제 요청은 본인 담당 채널의 행사(또는 본인이 등록한 행사)에만 할 수 있습니다.',
        '결과(승인·반려)가 나오면 ☰ 옆에 빨간 숫자가 뜹니다. ☰ → 내 요청에서 확인합니다.'),
      sec('📊 엑셀',
        '☰ → 엑셀로 내려받기: 전체 행사를 엑셀로 받습니다.',
        '☰ → 엑셀로 한꺼번에 등록' + (isM ? '' : ' 요청') + ': 내려받은 파일과 같은 양식입니다. 앞의 11개 열(채널~메모)만 읽고 (자동) 열은 비워도 됩니다.' + (isM ? '' : ' 한 줄이 등록 요청 1건이 됩니다.')),
      sec('📱 기타',
        '☰ → 홈 화면에 앱으로 설치하면 아이콘으로 바로 열립니다.',
        '☰ → 화면 색에서 밝게·어둡게를 고를 수 있습니다.',
        '이 안내는 ☰ → 사용 안내에서 언제든 다시 볼 수 있습니다.'));
    sheet('사용 안내', body);
  }

  // ---------------- theme: follow the phone (auto) or fixed light/dark ----------------
  const THEME_LABEL = { auto: '휴대폰 설정 따라감', light: '밝게', dark: '어둡게' };
  const getTheme = () => { try { return localStorage.getItem('evcal-theme') || 'auto'; } catch (e) { return 'auto'; } };
  function setTheme(v) { try { if (v === 'auto') localStorage.removeItem('evcal-theme'); else localStorage.setItem('evcal-theme', v); } catch (e) {} if (v === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', v); }

  // ---------------- install (PWA) ----------------
  // Android Chrome / Samsung Internet / PC Edge·Chrome: the browser hands us an install prompt -> one-tap button.
  // iPhone Safari has no install API, so the button shows the two taps to do by hand.
  let installEvt = null;
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const dismissed = () => { try { return localStorage.getItem('evcal-install-x') === '1'; } catch (e) { return false; } };
  function refreshInstall() {
    const can = !isStandalone() && (installEvt || isIOS());
    $('installBar').hidden = !can || dismissed();
    $('installBtn2').hidden = !can;
  }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; refreshInstall(); });
  window.addEventListener('appinstalled', () => { installEvt = null; refreshInstall(); toast('설치했습니다. 홈 화면의 아이콘으로 열어 보세요.'); });
  async function install() {
    if (installEvt) {
      installEvt.prompt();
      const r = await installEvt.userChoice.catch(() => null);
      if (r && r.outcome === 'accepted') installEvt = null;
      refreshInstall(); return;
    }
    const ios = isIOS(), inApp = /KAKAOTALK|NAVER|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent);
    sheet('홈 화면에 설치하기', el('div', {},
      inApp ? el('div', { class: 'err' }, '카카오톡·네이버 같은 앱 안에서 열린 화면에서는 설치가 안 됩니다. 오른쪽 위 메뉴에서 "다른 브라우저로 열기"(사파리/크롬)를 누른 뒤 다시 해 주세요.') : null,
      ios ? el('div', {},
        el('h3', {}, '아이폰은 두 번만 누르면 됩니다'),
        el('p', {}, '1. 화면 아래쪽 가운데 공유 버튼 (네모에 위쪽 화살표 □↑)'),
        el('p', {}, '2. 목록을 조금 내려서 "홈 화면에 추가" → 오른쪽 위 "추가"'),
        el('p', { class: 's', style: 'color:var(--muted)' }, '※ 사파리에서만 됩니다. 크롬으로 열었다면 주소를 복사해 사파리에서 열어 주세요.'))
      : el('div', {},
        el('h3', {}, '안드로이드 (크롬·삼성 인터넷)'),
        el('p', {}, '오른쪽 위 ⋮ (또는 아래쪽 ≡) 메뉴 → "앱 설치" 또는 "홈 화면에 추가"'),
        el('p', { class: 's', style: 'color:var(--muted)' }, '※ 설치 버튼이 바로 안 뜨면 페이지를 한 번 새로고침한 뒤 다시 눌러 보세요.')),
      el('p', { class: 's', style: 'color:var(--muted)' }, '설치하면 앱 아이콘이 생기고, 누르면 주소창 없이 전체 화면으로 열립니다. 로그인은 한 번 하면 유지됩니다.')));
  }
  $('installBtn').addEventListener('click', install);
  $('installBtn2').addEventListener('click', install);
  $('installX').addEventListener('click', () => { try { localStorage.setItem('evcal-install-x', '1'); } catch (e) {} $('installBar').hidden = true; toast('나중에 ☰ 메뉴에서 설치할 수 있어요.'); });
  refreshInstall();

  // ---------------- boot ----------------
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  (async () => {
    try { S.user = await api.restore(); } catch (x) { S.user = null; }
    if (S.user) start(); else showLogin();
  })();
})();
