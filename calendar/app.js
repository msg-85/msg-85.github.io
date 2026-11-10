(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const { AppError, lockAt, isLocked, canEdit, canCreate, todayKst, discount } = window.Cal;
  const cfg = window.CAL_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const useDemo = params.has('demo') || !cfg.url || !cfg.anonKey;
  const api = useDemo ? new Cal.DemoBackend() : new Cal.SupabaseBackend(cfg.url, cfg.anonKey);

  const S = { user: null, y: 0, m: 0, sel: todayKst(), events: [], channels: [], products: [], users: [], fCh: '', fBr: '' };
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
  const userName = id => { const u = S.users.find(x => x.id === id); return u ? u.display_name : '-'; };

  // ---------------- login ----------------
  function showLogin() {
    $('mainView').hidden = true; $('loginView').hidden = false;
    if (api.demo) { $('demoLogin').hidden = false; $('demoLogin').textContent = '시연용 화면입니다 (데이터는 이 기기에만 저장). 마스터: master / 1234, 담당자: kim / 1234, 가입 코드: DEMO-2026'; }
  }
  $('toSignup').addEventListener('click', () => { const s = $('signupForm').hidden; $('signupForm').hidden = !s; $('loginForm').hidden = s; $('toSignup').textContent = s ? '이미 계정이 있으면 로그인하기' : '처음이신가요? 가입 코드로 등록하기'; });
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault(); $('lErr').hidden = true; $('lBtn').disabled = true;
    try { S.user = await api.login($('lId').value, $('lPw').value); $('lPw').value = ''; await start(); }
    catch (x) { $('lErr').textContent = x.message; $('lErr').hidden = false; }
    $('lBtn').disabled = false;
  });
  $('signupForm').addEventListener('submit', async e => {
    e.preventDefault(); $('sErr').hidden = true; $('sBtn').disabled = true;
    try { S.user = await api.signup($('sCode').value, $('sId').value, $('sName').value, $('sPw').value); $('sPw').value = ''; await start(); toast('등록되었습니다. 환영합니다!'); }
    catch (x) { $('sErr').textContent = x.message; $('sErr').hidden = false; }
    $('sBtn').disabled = false;
  });

  // ---------------- main ----------------
  async function start() {
    $('loginView').hidden = true; $('mainView').hidden = false;
    $('addBtn').hidden = !(S.user.role === 'master' || S.user.role === 'manager');
    $('demoBar').hidden = !api.demo;
    if (api.demo) $('demoBar').textContent = `시연용 · ${S.user.name}(${S.user.role === 'master' ? '마스터' : S.user.role === 'manager' ? '담당자' : '조회'})로 보는 중 · 데이터는 이 기기에만 저장`;
    const t = todayKst().split('-').map(Number); S.y = t[0]; S.m = t[1] - 1;
    try { [S.channels, S.products, S.users] = await Promise.all([api.listChannels(), api.listProducts(), api.listUsers()]); }
    catch (x) { return fail(x); }
    fillFilters(); await load();
  }
  function fail(x) { if (x.code === 401) { api.logout(); showLogin(); } else toast(x.message); }
  function fillFilters() {
    const ch = $('fChannel'), br = $('fBrand');
    ch.replaceChildren(el('option', { value: '' }, '전체 채널'), ...S.channels.map(c => el('option', { value: c.code }, c.name)));
    const brands = [...new Set(S.products.map(p => p.brand))].sort();
    br.replaceChildren(el('option', { value: '' }, '전체 브랜드'), ...brands.map(b => el('option', { value: b }, b)));
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
  const visible = () => S.events.filter(e => (!S.fCh || e.channel_code === S.fCh) && (!S.fBr || e.brand === S.fBr));
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
        const bar = el('div', { class: 'bar' + (b.e.start_date < ws ? ' cont-l' : '') + (b.e.end_date > we ? ' cont-r' : '') }, `${b.e.channel} ${b.e.title}`);
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
    const locked = isLocked(e);
    return el('div', { class: 'card', onclick: () => openDetail(e) },
      el('div', { class: 'dot', style: 'background:' + colorOf(e.channel_code) }),
      el('div', { class: 'grow' },
        el('div', { class: 's' }, `${e.channel} · ${fmtD(e.start_date)} ~ ${fmtD(e.end_date)}`),
        el('div', { class: 't' }, e.title),
        el('div', { class: 's' }, `${e.product_name} · ${e.brand}`),
        el('div', { class: 'price' }, el('b', {}, won(e.sale_price)), el('del', {}, won(e.list_price)), el('span', { class: 'off' }, `${discount(e.list_price, e.sale_price)}%↓`),
          e.expected_qty != null ? el('span', { class: 's' }, `예상 ${Number(e.expected_qty).toLocaleString('ko-KR')}개`) : null),
        locked ? el('div', { class: 'lock' }, '🔒 마감됨 (마스터만 수정)') : null));
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
    const locked = isLocked(e), mine = canEdit(S.user, e);
    const body = el('div', {},
      el('div', { style: 'margin-bottom:10px' }, el('span', { class: 'badge' + (locked ? ' locked' : '') }, locked ? '🔒 마감됨 · 마스터만 수정' : `수정 가능 · ${fmtLock(e)}부터 마감`)),
      el('dl', { class: 'kv' },
        el('dt', {}, '채널'), el('dd', {}, e.channel),
        el('dt', {}, '행사명'), el('dd', {}, e.title),
        el('dt', {}, '제품'), el('dd', {}, `${e.product_name}`, el('br'), el('span', { class: 's', style: 'color:var(--muted);font-size:13px' }, `${e.brand} · ${e.product_code}`)),
        el('dt', {}, '기간'), el('dd', {}, `${fmtD(e.start_date)} ~ ${fmtD(e.end_date)}`),
        el('dt', {}, '정상가'), el('dd', {}, won(e.list_price)),
        el('dt', {}, '판매단가'), el('dd', {}, el('b', {}, won(e.sale_price)), ' ', el('span', { class: 'off' }, `${discount(e.list_price, e.sale_price)}% 할인`)),
        el('dt', {}, '예상수량'), el('dd', {}, e.expected_qty != null ? Number(e.expected_qty).toLocaleString('ko-KR') + '개' : '-'),
        el('dt', {}, '메모'), el('dd', {}, e.memo || '-'),
        el('dt', {}, '등록'), el('dd', {}, userName(e.created_by)),
        el('dt', {}, '최근 수정'), el('dd', {}, `${userName(e.updated_by)} · ${new Date(e.updated_at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}`)));
    let close;
    if (mine) body.append(el('div', { class: 'acts' },
      el('button', { class: 'btn del', onclick: async () => { if (!confirm('이 일정을 삭제할까요?')) return; try { await api.deleteEvent(e.id); close(); toast('삭제했습니다.'); load(); } catch (x) { toast(x.message); } } }, '삭제'),
      el('button', { class: 'btn pri', onclick: () => { close(); openForm(e); } }, '수정')));
    else if (S.user.role === 'manager') body.append(el('div', { class: 'pick', style: 'margin-top:14px' }, locked ? '지난 행사는 마스터만 수정할 수 있습니다.' : '다른 담당자가 등록한 일정은 보기만 할 수 있습니다.'));
    close = sheet('행사 상세', body);
  }

  // product search box: type part of a name, brand or code -> suggestions below
  function productPicker(initialCode, onPick) {
    const box = el('div', { class: 'f' }), input = el('input', { class: 'in', placeholder: '제품명·브랜드·코드 일부 입력', autocomplete: 'off' });
    const sug = el('div', { class: 'sug' }); sug.hidden = true;
    const info = el('div', { class: 'pick' });
    let chosen = S.products.find(p => p.code === initialCode) || null;
    const show = p => { info.textContent = p ? `선택됨: ${p.name} · ${p.brand} · ${p.code}${p.list_price ? ' · 정상가 ' + won(p.list_price) : ''}` : '목록에서 제품을 눌러 선택해 주세요.'; info.style.color = p ? '' : 'var(--danger)'; };
    if (chosen) input.value = chosen.name;
    const search = () => {
      const q = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const hits = S.products.filter(p => p.active !== false && q.every(w => (p.name + ' ' + p.brand + ' ' + p.code).toLowerCase().includes(w))).slice(0, 40);
      sug.replaceChildren(...(hits.length ? hits.map(p => el('button', { type: 'button', onmousedown: ev => ev.preventDefault(), onclick: () => { chosen = p; input.value = p.name; sug.hidden = true; show(p); onPick(p); } },
        p.name, el('small', {}, `${p.brand} · ${p.code}${p.list_price ? ' · ' + won(p.list_price) : ''}`))) : [el('div', { class: 'li' }, '맞는 제품이 없습니다.')]));
      sug.hidden = !q.length && !hits.length;
    };
    input.addEventListener('input', () => { chosen = null; show(null); onPick(null); search(); });
    input.addEventListener('focus', search);
    input.addEventListener('blur', () => setTimeout(() => { sug.hidden = true; }, 150));
    box.append(el('label', {}, '제품 ', el('i', {}, '*')), el('div', { style: 'position:relative' }, input, sug), info);
    show(chosen);
    return { box, get: () => chosen };
  }
  function openForm(e) {
    const isNew = !e, v = e ? { ...e } : { start_date: S.sel, end_date: S.sel };
    const f = id => document.getElementById(id);
    const chSel = el('select', { class: 'in', id: 'fe_ch' }, el('option', { value: '' }, '채널 선택'), ...S.channels.filter(c => c.active !== false || c.code === v.channel_code).map(c => el('option', { value: c.code }, c.name)));
    chSel.value = v.channel_code || (S.channels.length === 1 ? S.channels[0].code : '');
    const lp = el('input', { class: 'in', id: 'fe_lp', inputmode: 'numeric', value: v.list_price != null ? Number(v.list_price).toLocaleString('ko-KR') : '' });
    const sp = el('input', { class: 'in', id: 'fe_sp', inputmode: 'numeric', value: v.sale_price != null ? Number(v.sale_price).toLocaleString('ko-KR') : '' });
    const calc = el('div', { class: 'calc' });
    const upd = () => { const a = num(lp.value), b = num(sp.value); calc.textContent = a > 0 && b >= 0 ? `할인율 ${discount(a, b)}% (정상가 ${won(a)} → ${won(b)})` : '정상가와 판매단가를 넣으면 할인율이 자동 계산됩니다.'; };
    const commas = inp => inp.addEventListener('input', () => { const n = num(inp.value); if (!isNaN(n)) inp.value = n.toLocaleString('ko-KR'); upd(); });
    commas(lp); commas(sp);
    const pp = productPicker(v.product_code, p => { if (p && p.list_price && (!lp.value || isNew)) { lp.value = Number(p.list_price).toLocaleString('ko-KR'); upd(); } });
    const err = el('div', { class: 'err' }); err.hidden = true;
    const saveBtn = el('button', { class: 'btn pri', type: 'submit' }, isNew ? '등록' : '저장');
    const form = el('form', {},
      el('div', { class: 'f' }, el('label', {}, '채널 ', el('i', {}, '*')), chSel),
      el('div', { class: 'f' }, el('label', {}, '행사명 ', el('i', {}, '*')), el('input', { class: 'in', id: 'fe_title', value: v.title || '', placeholder: '예: 월초 특가' })),
      pp.box,
      el('div', { class: 'two' },
        el('div', { class: 'f' }, el('label', {}, '시작일 ', el('i', {}, '*')), el('input', { class: 'in', type: 'date', id: 'fe_s', value: v.start_date })),
        el('div', { class: 'f' }, el('label', {}, '종료일 ', el('i', {}, '*')), el('input', { class: 'in', type: 'date', id: 'fe_e', value: v.end_date }))),
      el('div', { class: 'two' },
        el('div', { class: 'f' }, el('label', {}, '정상가 (원) ', el('i', {}, '*')), lp),
        el('div', { class: 'f' }, el('label', {}, '판매단가 (원) ', el('i', {}, '*')), sp)),
      calc,
      el('div', { class: 'f' }, el('label', {}, '예상수량 (선택)'), el('input', { class: 'in', id: 'fe_q', inputmode: 'numeric', value: v.expected_qty ?? '' })),
      el('div', { class: 'f' }, el('label', {}, '메모 (선택)'), el('textarea', { class: 'in', id: 'fe_memo', rows: 2 }, v.memo || '')),
      el('div', { class: 'pick' }, S.user.role === 'master' ? '마스터는 지난 행사도 등록·수정할 수 있습니다.' : '종료일 다음 날 오전 9시부터는 마스터만 수정할 수 있습니다.'),
      err, el('div', { class: 'acts' }, saveBtn));
    upd();
    let close;
    form.addEventListener('submit', async ev => {
      ev.preventDefault(); err.hidden = true;
      const p = pp.get(); const q = f('fe_q').value.trim();
      const out = { id: v.id, channel_code: chSel.value, title: f('fe_title').value, product_code: p ? p.code : '', start_date: f('fe_s').value, end_date: f('fe_e').value,
        list_price: num(lp.value), sale_price: num(sp.value), expected_qty: q === '' ? null : num(q), memo: f('fe_memo').value.trim() };
      if (!p) { err.textContent = '제품을 목록에서 눌러 선택해 주세요.'; err.hidden = false; return; }
      saveBtn.disabled = true;
      try { const r = await api.saveEvent(out); close(); toast(isNew ? '등록했습니다.' : '저장했습니다.'); S.sel = r.start_date <= S.sel && r.end_date >= S.sel ? S.sel : r.start_date; const [yy, mm] = S.sel.split('-').map(Number); S.y = yy; S.m = mm - 1; load(); }
      catch (x) { err.textContent = x.message; err.hidden = false; }
      saveBtn.disabled = false;
    });
    close = sheet(isNew ? '행사 등록' : '행사 수정', form);
  }
  $('addBtn').addEventListener('click', () => openForm(null));

  // ---------------- menu ----------------
  $('menuBtn').addEventListener('click', () => {
    const isM = S.user.role === 'master', canWrite = isM || S.user.role === 'manager';
    let close;
    const mi = (label, fn) => el('button', { class: 'mi', onclick: () => { close(); fn(); } }, label);
    const body = el('div', { class: 'menu' },
      el('div', { class: 'li', style: 'border:0;padding-left:4px' }, el('div', {}, el('b', {}, S.user.name), el('div', { class: 's', style: 'color:var(--muted);font-size:13px' }, `${S.user.login} · ${isM ? '마스터' : S.user.role === 'manager' ? '담당자' : '조회'}`))),
      el('div', { class: 'sec' }, '엑셀'),
      mi('📥 일정 엑셀로 내려받기', exportEvents),
      canWrite ? mi('📤 일정 엑셀로 한꺼번에 등록', () => importEvents()) : null,
      isM ? el('div', { class: 'sec' }, '마스터') : null,
      isM ? mi('🔑 가입 코드 · 사용자 관리', manageUsers) : null,
      isM ? mi('📋 기준정보 (채널 · 제품) 올리기', masterData) : null,
      isM ? mi('🕘 변경 이력', showLog) : null,
      el('div', { class: 'sec' }, '기타'),
      mi('📱 휴대폰 홈 화면에 추가하는 법', installHelp),
      api.demo ? mi('🔄 시연 데이터 처음으로 되돌리기', () => { api.reset(); api.logout(); location.reload(); }) : null,
      mi('로그아웃', () => { api.logout(); S.user = null; showLogin(); }));
    close = sheet('메뉴', body);
  });
  function download(blob, name) { const a = el('a', { href: URL.createObjectURL(blob), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); }
  const EV_HEAD = ['채널코드', '행사명', '제품코드', '시작일', '종료일', '정상가', '판매단가', '예상수량', '메모'];
  async function exportEvents() {
    try {
      const all = await api.listAllEvents();
      const rows = [['채널코드', '채널', '행사명', '제품코드', '제품명', '브랜드', '시작일', '종료일', '정상가', '판매단가', '할인율(%)', '예상수량', '메모', '등록자', '마감'],
        ...all.map(e => [e.channel_code, e.channel, e.title, e.product_code, e.product_name, e.brand, e.start_date, e.end_date, Number(e.list_price), Number(e.sale_price), discount(e.list_price, e.sale_price), e.expected_qty ?? '', e.memo || '', userName(e.created_by), isLocked(e) ? '마감' : ''])];
      download(await buildXlsx([{ name: '행사일정', rows, header: true }]), `행사일정_${todayKst()}.xlsx`);
    } catch (x) { toast(x.message); }
  }
  function excelDate(v) {
    if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
    const m = /^(\d{4})[-./년 ]\s*(\d{1,2})[-./월 ]\s*(\d{1,2})/.exec(String(v).trim());
    return m ? ymd(+m[1], +m[2] - 1, +m[3]) : '';
  }
  function importEvents() {
    const file = el('input', { type: 'file', accept: '.xlsx,.csv', class: 'in' }), msg = el('div'), go = el('button', { class: 'btn pri', disabled: true }, '등록하기');
    let ready = [];
    file.addEventListener('change', async () => {
      msg.replaceChildren(); go.disabled = true; ready = [];
      try {
        const rows = (await readTable(file.files[0])).filter(r => r.some(c => c !== ''));
        const head = rows.shift().map(h => String(h).trim()), ix = n => head.indexOf(n);
        const miss = EV_HEAD.slice(0, 7).filter(h => ix(h) < 0);
        if (miss.length) throw new AppError('양식의 머리글이 다릅니다. 없는 열: ' + miss.join(', '));
        const errs = [];
        rows.forEach((r, i) => {
          const g = n => r[ix(n)] ?? '', pcode = String(g('제품코드')).trim(), p = S.products.find(x => x.code === pcode), ccode = String(g('채널코드')).trim();
          const e = { channel_code: ccode, title: String(g('행사명')).trim(), product_code: pcode, start_date: excelDate(g('시작일')), end_date: excelDate(g('종료일')),
            list_price: g('정상가') === '' && p ? Number(p.list_price) : num(g('정상가')), sale_price: num(g('판매단가')), expected_qty: ix('예상수량') >= 0 && g('예상수량') !== '' ? num(g('예상수량')) : null, memo: ix('메모') >= 0 ? String(g('메모')).trim() : '' };
          const why = [];
          if (!S.channels.some(c => c.code === ccode)) why.push('채널코드 없음(' + ccode + ')');
          if (!p) why.push('제품코드 없음(' + pcode + ')');
          if (!e.title) why.push('행사명 없음');
          if (!e.start_date || !e.end_date) why.push('날짜 확인'); else if (e.end_date < e.start_date) why.push('종료일이 시작일보다 빠름');
          if (!(e.list_price > 0)) why.push('정상가 확인'); if (!(e.sale_price >= 0)) why.push('판매단가 확인');
          if (!why.length && !canCreate(S.user, e)) why.push('이미 마감된 기간 (마스터만 등록 가능)');
          if (why.length) errs.push(`${i + 2}행: ${why.join(', ')}`); else ready.push(e);
        });
        msg.append(el('div', { class: 'ok' }, `등록할 수 있는 행 ${ready.length}개`));
        if (errs.length) msg.append(el('div', { class: 'err' }, `확인이 필요한 행 ${errs.length}개 (이 행들은 빼고 등록됩니다)\n` + errs.slice(0, 30).join('\n') + (errs.length > 30 ? `\n… 외 ${errs.length - 30}개` : '')));
        go.disabled = !ready.length;
      } catch (x) { msg.append(el('div', { class: 'err' }, x.message)); }
    });
    let close;
    go.addEventListener('click', async () => {
      go.disabled = true;
      try { await api.importEvents(ready); close(); toast(`${ready.length}건 등록했습니다.`); load(); }
      catch (x) { msg.append(el('div', { class: 'err' }, x.message)); go.disabled = false; }
    });
    close = sheet('일정 엑셀로 등록', el('div', {},
      el('p', { class: 's', style: 'color:var(--muted);margin-top:0' }, '양식을 받아서 채운 뒤 올려 주세요. 정상가를 비우면 제품 기준정보의 정상가가 들어갑니다. 날짜는 2026-11-01 형식이나 엑셀 날짜 모두 됩니다.'),
      el('button', { class: 'btn', style: 'margin-bottom:12px', onclick: async () => download(await buildXlsx([{ name: '일정등록', rows: [EV_HEAD, ['(채널코드)', '월초 특가', '(제품코드)', todayKst(), addDays(todayKst(), 6), '', 27900, 1000, '']], header: true },
        { name: '채널코드', rows: [['채널코드', '채널명'], ...S.channels.map(c => [c.code, c.name])], header: true },
        { name: '제품코드', rows: [['제품코드', '제품명', '브랜드', '정상가'], ...S.products.map(p => [p.code, p.name, p.brand, p.list_price ?? ''])], header: true }]), '일정등록_양식.xlsx') }, '📄 양식 내려받기'),
      file, msg, el('div', { class: 'acts' }, go)));
  }
  function masterData() {
    const part = (kind) => {
      const isP = kind === 'products', head = isP ? ['제품코드', '제품명', '브랜드', '정상가'] : ['채널코드', '채널명'];
      const file = el('input', { type: 'file', accept: '.xlsx,.csv', class: 'in' }), msg = el('div');
      file.addEventListener('change', async () => {
        msg.replaceChildren();
        try {
          const rows = (await readTable(file.files[0])).filter(r => r.some(c => c !== ''));
          const h = rows.shift().map(x => String(x).trim()), ix = n => h.indexOf(n);
          const miss = head.slice(0, isP ? 3 : 2).filter(x => ix(x) < 0);
          if (miss.length) throw new AppError('머리글이 다릅니다. 없는 열: ' + miss.join(', '));
          const seen = new Set(), list = [];
          for (const r of rows) {
            const code = String(r[ix(head[0])] ?? '').trim(); if (!code || seen.has(code)) continue; seen.add(code);
            if (isP) list.push({ code, name: String(r[ix('제품명')] ?? '').trim(), brand: String(r[ix('브랜드')] ?? '').trim(), list_price: ix('정상가') >= 0 && r[ix('정상가')] !== '' ? num(r[ix('정상가')]) : null, active: true });
            else list.push({ code, name: String(r[ix('채널명')] ?? '').trim(), active: true });
          }
          const bad = list.filter(x => !x.name || (isP && !x.brand));
          if (bad.length) throw new AppError(`이름${isP ? '·브랜드' : ''}가 비어 있는 행이 ${bad.length}개 있습니다: ${bad.slice(0, 5).map(x => x.code).join(', ')}`);
          if (isP) await api.upsertProducts(list); else await api.upsertChannels(list);
          if (isP) S.products = await api.listProducts(); else S.channels = await api.listChannels();
          fillFilters(); draw();
          msg.append(el('div', { class: 'ok' }, `${list.length}개를 올렸습니다. 같은 코드는 새 내용으로 바뀌고, 새 코드는 추가됩니다.`));
        } catch (x) { msg.append(el('div', { class: 'err' }, x.message)); }
        file.value = '';
      });
      const cur = isP ? S.products.map(p => [p.code, p.name, p.brand, p.list_price ?? '']) : S.channels.map(c => [c.code, c.name]);
      return el('div', { style: 'margin-bottom:22px' },
        el('h3', { style: 'margin:6px 0' }, isP ? `제품 (${S.products.length}개)` : `채널 (${S.channels.length}개)`),
        el('button', { class: 'btn', style: 'margin-bottom:8px', onclick: async () => download(await buildXlsx([{ name: isP ? '제품' : '채널', rows: [head, ...cur], header: true }]), (isP ? '제품' : '채널') + '_기준정보.xlsx') }, '📄 현재 목록을 양식으로 받기'),
        file, msg);
    };
    sheet('기준정보 올리기', el('div', {},
      el('p', { class: 's', style: 'color:var(--muted);margin-top:0' }, '엑셀 첫 줄에 머리글을 그대로 두고 올려 주세요. 같은 코드가 있으면 내용이 바뀌고, 없는 코드는 추가됩니다 (지워지지는 않음).'),
      part('channels'), part('products')));
  }
  async function manageUsers() {
    let invites = [], users = [];
    try { [invites, users] = await Promise.all([api.listInvites(), api.listUsers()]); } catch (x) { return toast(x.message); }
    S.users = users;
    const role = el('select', { class: 'in', style: 'flex:1' }, el('option', { value: 'manager' }, '담당자 (등록 가능)'), el('option', { value: 'viewer' }, '조회만'), el('option', { value: 'master' }, '마스터'));
    const note = el('input', { class: 'in', placeholder: '누구에게 줄 코드인지 (예: 쿠팡 김OO)', style: 'margin-top:8px' });
    const out = el('div');
    const invList = el('div', { class: 'list' });
    const roleK = r => (r === 'master' ? '마스터' : r === 'manager' ? '담당자' : '조회');
    const drawInv = () => invList.replaceChildren(...(invites.length ? invites.map(i => el('div', { class: 'li' },
      el('div', { class: 'grow' }, el('span', { class: 'code' }, i.code), el('div', { class: 's', style: 'color:var(--muted);font-size:12px' }, `${roleK(i.role)} · ${i.note || ''} · ${i.used_by ? '사용됨: ' + (users.find(u => u.id === i.used_by) || {}).display_name : i.revoked ? '회수됨' : '미사용'}`)),
      !i.used_by && !i.revoked ? el('button', { class: 'btn del', onclick: async () => { if (!confirm('이 코드를 회수할까요?')) return; await api.revokeInvite(i.code); i.revoked = true; drawInv(); } }, '회수') : null)) : [el('div', { class: 'li' }, '발급한 코드가 없습니다.')]));
    drawInv();
    const userList = el('div', { class: 'list' }, ...users.map(u => {
      const sel = el('select', { class: 'in', style: 'width:auto;padding:6px' }, ...['master', 'manager', 'viewer'].map(r => el('option', { value: r }, roleK(r))));
      sel.value = u.role; sel.disabled = u.id === S.user.id;
      sel.addEventListener('change', async () => { try { await api.setUser(u.id, { role: sel.value }); toast('권한을 바꿨습니다.'); } catch (x) { toast(x.message); } });
      const act = el('button', { class: 'btn' + (u.active ? ' del' : ''), disabled: u.id === S.user.id }, u.active ? '중지' : '다시 사용');
      act.addEventListener('click', async () => { try { await api.setUser(u.id, { active: !u.active }); u.active = !u.active; act.textContent = u.active ? '중지' : '다시 사용'; act.className = 'btn' + (u.active ? ' del' : ''); } catch (x) { toast(x.message); } });
      return el('div', { class: 'li' }, el('div', { class: 'grow' }, el('b', {}, u.display_name), el('div', { class: 's', style: 'color:var(--muted);font-size:12px' }, u.login)), sel, act);
    }));
    sheet('가입 코드 · 사용자', el('div', {},
      el('h3', { style: 'margin:4px 0 8px' }, '새 가입 코드 만들기'),
      el('div', { class: 'row' }, role, el('button', { class: 'btn pri', onclick: async () => {
        try { const inv = await api.createInvite(role.value, note.value.trim()); invites.unshift(inv); drawInv(); note.value = '';
          out.replaceChildren(el('div', { class: 'ok' }, '코드가 만들어졌습니다. 아래 안내를 복사해 전달하세요.\n\n', el('span', { class: 'code' }, inv.code)),
            el('button', { class: 'btn', onclick: () => navigator.clipboard.writeText(`[행사 일정 캘린더] ${location.origin + location.pathname}\n가입 코드: ${inv.code}\n처음 들어가서 "가입 코드로 등록하기"를 누르고 코드·아이디·이름·비밀번호를 넣어 주세요.`).then(() => toast('복사했습니다.')) }, '안내 문구 복사'));
        } catch (x) { toast(x.message); } } }, '만들기')),
      note, out,
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
        el('div', {}, el('b', {}, act[l.action] || l.action), ` · ${r.channel || ''} ${r.title || ''}`),
        el('div', { class: 's', style: 'color:var(--muted);font-size:12px' }, `${userName(l.actor)} · ${new Date(l.at).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' })}`),
        ch.length ? el('div', { style: 'font-size:13px;margin-top:4px' }, ch.join(' / ')) : null);
    }) : [el('div', { class: 'li' }, '변경 이력이 없습니다.')])));
  }
  function installHelp() {
    sheet('홈 화면에 추가하기', el('div', {},
      el('h3', {}, '아이폰 (사파리)'), el('p', {}, '아래쪽 공유 버튼(□↑) → "홈 화면에 추가" → 추가'),
      el('h3', {}, '안드로이드 (크롬·삼성 인터넷)'), el('p', {}, '오른쪽 위 ⋮ 메뉴 → "홈 화면에 추가" 또는 "앱 설치"'),
      el('p', { class: 's', style: 'color:var(--muted)' }, '추가하면 앱 아이콘이 생기고, 누르면 전체 화면으로 열립니다. 로그인은 한 번 하면 유지됩니다.')));
  }

  // ---------------- boot ----------------
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  (async () => {
    try { S.user = await api.restore(); } catch (x) { S.user = null; }
    if (S.user) start(); else showLogin();
  })();
})();
