(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const { AppError, lockAt, isLocked, canEdit, canCreate, canRequest, REQ_FIELDS, isEtc, todayKst, discount } = window.Cal;
  const cfg = window.CAL_CONFIG || {};
  const params = new URLSearchParams(location.search);
  const useDemo = params.has('demo') || !cfg.url || !cfg.anonKey;
  const api = useDemo ? new Cal.DemoBackend() : new Cal.SupabaseBackend(cfg.url, cfg.anonKey);

  const S = { user: null, y: 0, m: 0, sel: todayKst(), events: [], channels: [], products: [], users: [], requests: [], fTeam: '', fCh: '', fBr: '', fSub: '', fPg: '', hl: '', view: (() => { try { return localStorage.getItem('evcal-view') || 'cal'; } catch (e) { return 'cal'; } })(), dv: (() => { try { return localStorage.getItem('evcal-dv') || 'sub'; } catch (e) { return 'sub'; } })() };
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
  let PIDX = null; // product lookup by code, rebuilt when S.products is replaced
  const pByCode = code => { if (!PIDX || PIDX.src !== S.products) PIDX = { src: S.products, m: new Map(S.products.map(p => [p.code, p])) }; return PIDX.m.get(code); };
  const catOf = e => { const p = pByCode(e.product_code); return { l: (p && p.cat_l) || e.cat_l || '', s: (p && p.cat_s) || e.cat_s || '' }; };
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
    fillFilters(); await load(); if (S.view === 'chart' && chartDefault()) draw(); refreshRequests();
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
  // filters: 팀 -> 채널, 대분류 -> 소분류 -> 가격구분 (each list follows the one before it).
  // Lists only hold values that appear in the loaded events (the shown month), so nothing empty can be picked.
  const opts = (sel, all, items, cur) => { sel.replaceChildren(el('option', { value: '' }, all), ...items.map(([v, t]) => el('option', { value: v }, t))); sel.value = items.some(([v]) => v === cur) ? cur : ''; return sel.value; };
  const uniq = xs => [...new Set(xs.filter(Boolean))];
  function fillFilters() {
    const ev = S.events;
    S.fTeam = opts($('fTeam'), '전체 팀', uniq(ev.map(e => divOf(e.channel_code)[1])).sort().map(t => [t, t]), S.fTeam);
    const chs = new Set(ev.filter(e => !S.fTeam || divOf(e.channel_code)[1] === S.fTeam).map(e => e.channel_code));
    S.fCh = opts($('fChannel'), '전체 채널', [...chs].sort((a, b) => chIx(a) - chIx(b)).map(c => [c, chLabel(c)]), S.fCh);
    S.fBr = opts($('fBrand'), '전체 대분류', uniq(ev.map(e => catOf(e).l)).sort().map(b => [b, b]), S.fBr);
    fillSub();
  }
  function fillSub() {
    S.fSub = opts($('fSub'), '전체 소분류', uniq(S.events.filter(e => !S.fBr || catOf(e).l === S.fBr).map(e => catOf(e).s)).sort().map(s => [s, s]), S.fSub);
    fillPg();
  }
  function fillPg() {
    const xs = S.events.filter(e => (!S.fBr || catOf(e).l === S.fBr) && (!S.fSub || catOf(e).s === S.fSub));
    S.fPg = opts($('fPg'), '전체 가격구분', uniq(xs.map(pgOf)).sort(pgSort).map(g => [g, g]), S.fPg);
  }
  $('fTeam').addEventListener('change', e => { S.fTeam = e.target.value; draw(); });
  $('fChannel').addEventListener('change', e => { S.fCh = e.target.value; draw(); });
  $('fBrand').addEventListener('change', e => { S.fBr = e.target.value; draw(); });
  $('fSub').addEventListener('change', e => { S.fSub = e.target.value; draw(); });
  $('fPg').addEventListener('change', e => { S.fPg = e.target.value; draw(); });
  // one 행사 = same channel, 세부채널, 행사명 and dates; its SKUs are grouped by 소분류
  const promoKey = e => [e.channel_code, e.channel_detail || '', e.title, e.start_date, e.end_date].join('\u0001');
  function promos(list) {
    const m = new Map();
    for (const e of list) { const k = promoKey(e); if (!m.has(k)) m.set(k, { key: k, e, list: [] }); m.get(k).list.push(e); }
    return [...m.values()];
  }
  function gridRange() {
    const first = ymd(S.y, S.m, 1), last = ymd(S.y, S.m + 1, 0);
    return { from: addDays(first, -dow(first)), to: addDays(last, 6 - dow(last)) };
  }
  async function load() {
    const { from, to } = gridRange();
    try { S.events = await api.listEvents(from, to); } catch (x) { return fail(x); }
    draw();
  }
  const visible = () => S.events.filter(e => (!S.fTeam || divOf(e.channel_code)[1] === S.fTeam) && (!S.fPg || pgOf(e) === S.fPg) && (!S.fCh || e.channel_code === S.fCh) && (!S.fBr || catOf(e).l === S.fBr) && (!S.fSub || catOf(e).s === S.fSub));
  // month grid: one lane per 팀, ranked by how many channels (incl. 세부채널) run a promo that week.
  // Lanes 1-3 show the top 3 팀 as "Hyper · 이마트 외 2개처"; the rest is "+n팀" under the day.
  function draw() {
    $('monthLabel').textContent = `${S.y}년 ${S.m + 1}월`;
    fillFilters();
    for (const b of $('viewSeg').children) b.className = b.dataset.v === S.view ? 'on' : '';
    $('calBox').hidden = S.view === 'chart'; $('chartBox').hidden = S.view !== 'chart';
    if (S.view === 'chart') { drawChart(); return drawDay(); }
    const { from, to } = gridRange(), evs = visible(), today = todayKst(), grid = $('grid');
    grid.replaceChildren();
    const LANES = 3, LH = 18, TOP = 28;
    const chKey = e => e.channel_code + '\u0001' + (e.channel_detail || '');
    for (let ws = from; ws <= to; ws = addDays(ws, 7)) {
      const we = addDays(ws, 6), wk = el('div', { class: 'week' });
      const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
      const teams = new Map(); // team -> { chs: Set, perDay: [Map chKey -> event] }
      for (const e of evs) {
        if (e.start_date > we || e.end_date < ws) continue;
        const t = divOf(e.channel_code)[1];
        if (!teams.has(t)) teams.set(t, { t, chs: new Set(), perDay: days.map(() => new Map()) });
        const T = teams.get(t); T.chs.add(chKey(e));
        days.forEach((d, i) => { if (e.start_date <= d && e.end_date >= d) T.perDay[i].set(chKey(e), e); });
      }
      const ranked = [...teams.values()].sort((a, b) => b.chs.size - a.chs.size || a.t.localeCompare(b.t));
      const shown = ranked.slice(0, LANES), rest = ranked.slice(LANES), hidden = days.map((_, i) => rest.filter(T => T.perDay[i].size).length);
      const hasMore = hidden.some(Boolean);
      wk.style.minHeight = (TOP + shown.length * LH + (hasMore ? 14 : 0) + 6) + 'px';
      days.forEach((d, i) => {
        const [, mm, dd] = d.split('-').map(Number);
        const cls = ['day', mm - 1 !== S.m && 'out', d === today && 'today', d === S.sel && 'sel'].filter(Boolean).join(' ');
        wk.append(el('div', { class: cls, onclick: () => { S.sel = d; draw(); } }, el('div', { class: 'n' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') }, dd)));
        if (hidden[i]) { const m = el('div', { class: 'more' }, `+${hidden[i]}팀`); m.style.left = (i / 7 * 100) + '%'; m.style.width = (100 / 7) + '%'; m.style.top = (TOP + shown.length * LH) + 'px'; wk.append(m); }
      });
      shown.forEach((T, li) => {
        // runs of consecutive days with at least one promo in this 팀
        for (let s = 0; s < 7; s++) {
          if (!T.perDay[s].size) continue;
          let en = s; while (en + 1 < 7 && T.perDay[en + 1].size) en++;
          const run = new Map(); for (let i = s; i <= en; i++) for (const [k, e] of T.perDay[i]) run.set(k, e);
          const list = [...run.values()].sort((a, b) => chIx(a.channel_code) - chIx(b.channel_code));
          const first = list[0], contL = s === 0 && list.some(e => e.start_date < ws), contR = en === 6 && list.some(e => e.end_date > we);
          const label = `${T.t.replace(/^[A-Z]\./, '')} · ${chName(first)}${list.length > 1 ? ` 외 ${list.length - 1}개처` : ''}`;
          const bar = el('div', { class: 'bar' + (contL ? ' cont-l' : '') + (contR ? ' cont-r' : '') }, label);
          bar.style.left = `calc(${s / 7 * 100}% + 2px)`; bar.style.width = `calc(${(en - s + 1) / 7 * 100}% - 4px)`;
          bar.style.top = (TOP + li * LH) + 'px'; bar.style.background = colorOf('team:' + T.t);
          wk.append(bar);
          s = en;
        }
      });
      grid.append(wk);
    }
    drawDay();
  }
  // ---------------- graph view ----------------
  // 달력 / 그래프 toggle next to the month. The graph shows 판매가 per day (1일 ~ 말일) for the filtered events,
  // one line per 채널(+세부채널) × 소분류 × 가격구분 (the lowest 판매가 of its SKUs that day). Gaps = no 행사.
  const CHART_MAX = 10;
  $('viewSeg').addEventListener('click', e => {
    const v = e.target.dataset && e.target.dataset.v; if (!v || v === S.view) return;
    S.view = v; try { localStorage.setItem('evcal-view', v); } catch (x) {}
    if (v === 'chart') chartDefault();
    draw();
  });
  // with no filter picked, the graph opens on 시유 GT 900 · 2입 (소분류 "…시유 GT 900", the 가격구분 of its 2입 set)
  function chartDefault() {
    if (S.fTeam || S.fCh || S.fBr || S.fSub || S.fPg) return false;
    const inSub = S.events.filter(e => /시유\s*GT\s*900$/.test(catOf(e).s));
    if (!inSub.length) return false;
    const two = inSub.find(e => /2입/.test(e.product_name || '')) || inSub[0];
    S.fBr = catOf(two).l; S.fSub = catOf(two).s; S.fPg = pgOf(two);
    return true;
  }
  function chartSeries() {
    const first = ymd(S.y, S.m, 1), nd = new Date(Date.UTC(S.y, S.m + 1, 0)).getUTCDate(), last = ymd(S.y, S.m, nd);
    const days = Array.from({ length: nd }, (_, i) => ymd(S.y, S.m, i + 1));
    const m = new Map();
    for (const e of visible()) {
      if (e.start_date > last || e.end_date < first) continue;
      const v = Number(e.sale_price); if (!(v > 0)) continue;
      const c = catOf(e), pg = pgOf(e);
      const k = [e.channel_code, e.channel_detail || '', c.s, pg].join('\u0001');
      if (!m.has(k)) m.set(k, { k, ch: chName(e), code: e.channel_code, sub: c.s, pg, vals: days.map(() => null), hi: days.map(() => null), n: new Set() });
      const s = m.get(k); s.n.add(e.product_code);
      days.forEach((d, i) => { if (e.start_date <= d && e.end_date >= d) { s.vals[i] = s.vals[i] == null ? v : Math.min(s.vals[i], v); s.hi[i] = Math.max(s.hi[i] || 0, v); } });
    }
    const all = [...m.values()].filter(s => s.vals.some(v => v != null));
    for (const s of all) { const r = s.vals.filter(v => v != null); s.min = Math.min(...r); s.max = Math.max(...r); }
    // too many lines to read: keep the 10 with the highest 판매가
    all.sort((a, b) => b.max - a.max || chIx(a.code) - chIx(b.code) || a.k.localeCompare(b.k));
    return { days, total: all.length, list: all.slice(0, CHART_MAX) };
  }
  const niceStep = span => { const raw = span / 4, p = Math.pow(10, Math.floor(Math.log10(raw || 1))); return [1, 2, 2.5, 5, 10].map(x => x * p).find(x => x >= raw) || p * 10; };
  function drawChart() {
    const box = $('chartBox'), { days, total, list } = chartSeries();
    const subShort = s => String(s || '').replace(/^[A-Za-z]?\d*\.\s*/, '');
    const label = s => `${s.ch} · ${S.fSub ? '' : subShort(s.sub) + ' '}${s.pg}`;
    const head = el('div', { class: 'ch-h' }, el('span', {}, '판매가 추이 ', el('small', {}, `${S.m + 1}/1 ~ ${S.m + 1}/${days.length}`)), el('small', {}, list.length ? `선 ${list.length}개` : ''));
    if (!list.length) return box.replaceChildren(head, el('div', { class: 'empty' }, '이 달에 고른 조건의 행사가 없습니다.'));
    const note = total > CHART_MAX ? el('div', { class: 'ch-note' }, `선이 ${total}개라 판매가 높은 ${CHART_MAX}개만 보여요. 위 필터로 좁히면 다 보여요.`) : null;
    if (S.hl && !list.some(s => s.k === S.hl)) S.hl = '';
    // geometry (px, drawn at the box's real width so text stays the same size on any screen)
    const W = Math.max(280, (box.clientWidth || 360) - 16), H = Math.round(Math.min(260, Math.max(190, W * 0.55)));
    const L = 44, R = 10, T = 10, B = 22, pw = W - L - R, ph = H - T - B;
    let lo = Math.min(...list.map(s => s.min)), hi = Math.max(...list.map(s => s.max));
    if (lo === hi) { lo -= 500; hi += 500; }
    const step = niceStep(hi - lo); lo = Math.max(0, Math.floor((lo - step * 0.2) / step) * step); hi = Math.ceil((hi + step * 0.2) / step) * step; if (hi === lo) hi = lo + step;
    const X = i => L + (days.length === 1 ? pw / 2 : i * pw / (days.length - 1)), Y = v => T + ph - (v - lo) / (hi - lo) * ph;
    const f1 = n => Math.round(n * 10) / 10;
    let g = '';
    for (let v = lo; v <= hi + 1e-9; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${f1(Y(v))}" y2="${f1(Y(v))}" style="stroke:var(--line)"/><text x="${L - 6}" y="${f1(Y(v) + 3.5)}" text-anchor="end">${Math.round(v).toLocaleString('ko-KR')}</text>`;
    const ticks = [1, 5, 10, 15, 20, 25, days.length].filter((d, i, a) => a.indexOf(d) === i && (d === days.length || days.length - d >= 3));
    for (const d of ticks) g += `<text x="${f1(X(d - 1))}" y="${H - 6}" text-anchor="middle">${d}일</text>`;
    const today = todayKst(), ti = days.indexOf(today), si = days.indexOf(S.sel);
    if (ti >= 0) g += `<line x1="${f1(X(ti))}" x2="${f1(X(ti))}" y1="${T}" y2="${T + ph}" style="stroke:var(--muted);stroke-dasharray:2 3"/>`;
    if (si >= 0) g += `<line x1="${f1(X(si))}" x2="${f1(X(si))}" y1="${T}" y2="${T + ph}" style="stroke:var(--ink);stroke-width:1.2"/>`;
    // highlighted line drawn last so it sits on top
    const order = list.map((s, i) => [s, i]).sort((a, b) => (a[0].k === S.hl) - (b[0].k === S.hl));
    for (const [s, i] of order) {
      const col = PALETTE[i % PALETTE.length], dim = S.hl && s.k !== S.hl, sw = s.k === S.hl ? 3 : 2;
      let d = '', pts = '';
      s.vals.forEach((v, j) => {
        if (v == null) return;
        const prev = j > 0 ? s.vals[j - 1] : null, next = j < s.vals.length - 1 ? s.vals[j + 1] : null;
        d += (prev == null ? 'M' : 'L') + f1(X(j)) + ' ' + f1(Y(v)) + ' ';
        // dots where a run starts / ends / the price changes
        if (prev == null || next == null || prev !== v) pts += `<circle cx="${f1(X(j))}" cy="${f1(Y(v))}" r="${prev == null && next == null ? 3 : 2.4}" fill="${col}"/>`;
      });
      g += `<g style="opacity:${dim ? 0.18 : 1}"><path d="${d}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/>${pts}</g>`;
    }
    if (si >= 0) for (const [s, i] of order) { const v = s.vals[si]; if (v != null && !(S.hl && s.k !== S.hl)) g += `<circle cx="${f1(X(si))}" cy="${f1(Y(v))}" r="4" fill="${PALETTE[i % PALETTE.length]}" style="stroke:var(--sheet);stroke-width:2"/>`; }
    const holder = el('div', {}); holder.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="일자별 판매가 그래프">${g}</svg>`;
    const svg = holder.firstChild;
    // tap / click on the graph picks that day (the list below follows it)
    svg.addEventListener('click', ev => {
      const r = svg.getBoundingClientRect(), x = (ev.clientX - r.left) * W / r.width;
      const i = Math.max(0, Math.min(days.length - 1, Math.round((x - L) / pw * (days.length - 1))));
      S.sel = days[i]; draw();
    });
    const selTxt = si >= 0 ? fmtD(S.sel) : '';
    const lg = el('div', { class: 'lg' }, el('div', { class: 'lh' }, el('span', {}, '채널 · 가격구분 (눌러서 강조)'), el('span', {}, selTxt ? selTxt + ' 판매가' : '')),
      ...list.map((s, i) => {
        const v = si >= 0 ? s.vals[si] : null, vh = si >= 0 ? s.hi[si] : null;
        return el('div', { class: 'li' + (S.hl && s.k !== S.hl ? ' dim' : ''), title: label(s), onclick: () => { S.hl = S.hl === s.k ? '' : s.k; drawChart(); } },
          el('span', { class: 'sw', style: 'background:' + PALETTE[i % PALETTE.length] }),
          el('span', { class: 'nm' }, label(s)),
          el('span', { class: 'r' }, rng(s.min, s.max, x => x.toLocaleString('ko-KR'))),
          el('span', { class: 'v' }, v == null ? '-' : rng(v, vh, x => x.toLocaleString('ko-KR')) + '원'));
      }));
    box.replaceChildren(head, note || '', svg, lg);
  }
  function drawDay() {
    const d = S.sel, list = visible().filter(e => e.start_date <= d && e.end_date >= d);
    const seg = el('div', { class: 'seg' }, ...[['sub', '소분류별'], ['promo', '행사별']].map(([v, t]) => el('button', { class: S.dv === v ? 'on' : '', onclick: () => { S.dv = v; try { localStorage.setItem('evcal-dv', v); } catch (x) {} drawDay(); } }, t)));
    $('dayHead').replaceChildren(el('span', {}, fmtD(d), ' ', el('small', {}, list.length ? `행사 채널 ${nCh(list)}곳 · SKU ${list.length}개` : '')), list.length ? seg : '');
    if (!list.length) return $('dayList').replaceChildren(el('div', { class: 'empty' }, '이 날 행사가 없습니다.'));
    if (S.dv === 'sub') $('dayList').replaceChildren(...sorted(groupBy(list, x => catOf(x).l || '(대분류 없음)')).map(([l, xs]) => catLCard(l, xs)));
    else $('dayList').replaceChildren(...byChannels(groupBy(list, x => divOf(x.channel_code)[0])).map(([dv, xs]) => divCard(dv, xs)));
  }
  // 행사 channels (incl. 세부채널) in a list; 부문 / 팀 are listed by this count, most first
  const nCh = xs => new Set(xs.map(x => x.channel_code + '\u0001' + (x.channel_detail || ''))).size;
  const byChannels = m => [...m.entries()].sort((a, b) => nCh(b[1]) - nCh(a[1]) || a[0].localeCompare(b[0]));
  const chIx = c => { const i = S.channels.findIndex(x => x.code === c); return i < 0 ? 1e9 : i; };
  const groupBy = (xs, f) => { const m = new Map(); for (const x of xs) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m; };
  const sorted = m => [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const subOf = x => catOf(x).s || '(소분류 없음)';
  // 부문 / 팀 by the channel code's letter (same structure as the 실적 data)
  const DIV = { A: ['01.도매', 'A.상온'], B: ['01.도매', 'B.유제품'], C: ['02.유통', 'C.Hyper'], D: ['02.유통', 'D.SSM'], E: ['02.유통', 'E.CVS'], F: ['03.E커머스', 'F.E-1'], G: ['03.E커머스', 'G.E-2'], H: ['04.FS', 'H.FS기획'], I: ['04.FS', 'I.FS영업1'], J: ['04.FS', 'J.FS영업2'] };
  const divOf = code => DIV[String(code)[0]] || ['09.기타', String(code)[0] + '.기타'];
  // 가격 그룹 from the product name: 단계 (1공관 / 2스틱 / 1단계) + 규격 (last size token: 800g, 250ml, 180+20T).
  // Taste and pack variants (12입 / 3*4입) fall into the same group. Later this can come from a 가격그룹 column in the product master.
  const PG = new Map();
  function pgOf(x) {
    const name = x.product_name || ''; if (PG.has(name)) return PG.get(name);
    const n = name.replace(/\s+/g, '').replace(/㎖/g, 'ml').replace(/ℓ/g, 'L');
    const st = n.match(/(\d)(공관|스틱|단계)/), sizes = [...n.matchAll(/(\d+(?:\.\d+)?(?:\+\d+)?)(T|ml|L|kg|g|매)(?![a-zA-Z가-힣])/gi)];
    const sz = sizes.length ? sizes[sizes.length - 1] : null;
    const unit = sz ? (/^ml$/i.test(sz[2]) ? 'ml' : /^kg$/i.test(sz[2]) ? 'kg' : /^g$/i.test(sz[2]) ? 'g' : /^l$/i.test(sz[2]) ? 'L' : sz[2].toUpperCase() === 'T' ? 'T' : sz[2]) : '';
    const g = [st ? st[1] + '단계' + (st[2] === '스틱' ? ' 스틱' : '') : '', sz ? sz[1] + unit : ''].filter(Boolean).join(' ') || '기타';
    PG.set(name, g); return g;
  }
  const pgSort = (a, b) => (parseFloat(a.replace(/^\d단계\s*/, '')) || 0) - (parseFloat(b.replace(/^\d단계\s*/, '')) || 0) || a.localeCompare(b);
  const pgroups = xs => [...groupBy(xs, pgOf).entries()].sort((a, b) => pgSort(a[0], b[0]));
  // open/closed state survives redraws
  const OPEN = new Set();
  const tog = k => { OPEN.has(k) ? OPEN.delete(k) : OPEN.add(k); drawDay(); };
  const rng = (a, b, f) => (a === b ? f(a) : `${f(a)}~${f(b)}`);
  const priceRange = list => { const r = list.map(e => Number(e.sale_price)).filter(x => x >= 0); if (!r.length) return ''; return rng(Math.min(...r), Math.max(...r), x => x.toLocaleString('ko-KR')) + '원'; };
  const chName = e => shortCh(chLabel(e.channel_code, e.channel)) + (e.channel_detail ? '·' + e.channel_detail : '');
  const pgSummary = gs => gs.length > 4 ? `가격 그룹 ${gs.length}개` : gs.map(([g, ys]) => `${g} ${priceRange(ys)}`).join(' · ');
  // a drill-down row at depth 1..3: label (+ small line) · price range (optional) · count · arrow
  const row = (k, depth, label, small, price, count) => el('div', { class: 'sub d' + depth + (OPEN.has(k) ? ' open' : ''), onclick: () => tog(k) },
    el('span', { class: 'nm' }, label, small ? el('small', {}, small) : null), price != null ? el('span', { class: 'pr' }, price) : null, el('span', { class: 'ct' }, count), el('span', { class: 'ct' }, OPEN.has(k) ? '▲' : '▼'));
  const pgHead = (g, depth) => el('div', { class: 'pgh d' + depth }, g);
  // top-level card (대분류 / 부문)
  function topCard(k, title, small, dot, body) {
    const box = el('div', { class: 'promo' + (OPEN.has(k) ? ' open' : '') });
    box.append(el('div', { class: 'ph', onclick: () => tog(k) }, dot ? el('div', { class: 'dot', style: 'background:' + dot }) : null,
      el('div', { class: 'grow' }, el('div', { class: 't' }, title), el('div', { class: 's' }, small)), el('div', { class: 'arr' }, '▶')));
    if (OPEN.has(k)) box.append(el('div', { class: 'subs' }, ...body()));
    return box;
  }
  // SKUs with the same 정상가 / 판매가 shown as one line (taste / pack variants)
  function skuLines(xs) {
    const g = [...groupBy(xs, x => `${x.list_price}|${x.sale_price}`).values()].sort((a, b) => a[0].sale_price - b[0].sale_price);
    return el('div', { class: 'skus' }, ...g.map(ys => el('div', { class: 'sku', onclick: () => ys.length === 1 && openDetail(ys[0]) },
      el('div', { class: 'grow' }, el('div', {}, ys[0].product_name), ys.length > 1 ? el('div', { class: 's' }, `외 ${ys.length - 1}개 같은 가격 · ` + ys.slice(1).map(y => y.product_name).join(', ')) : null),
      el('div', { class: 'pc' }, el('b', {}, won(ys[0].sale_price)), Number(ys[0].list_price) !== Number(ys[0].sale_price) ? el('div', { class: 's' }, el('del', {}, won(ys[0].list_price))) : null))));
  }
  // 소분류별: 대분류 -> 소분류 -> 가격 그룹 · 채널별 판매가 -> SKU
  function catLCard(l, xs) {
    const k = 'L\u0001' + l, subs = sorted(groupBy(xs, subOf));
    return topCard(k, l, `소분류 ${subs.length}개 · 행사 채널 ${nCh(xs)}곳 · SKU ${xs.length}개`, null, () => {
      const out = [];
      for (const [s, ys] of subs) {
        const ks = k + '\u0002' + s, gs = pgroups(ys);
        out.push(row(ks, 1, s, `채널 ${nCh(ys)}곳 · ` + pgSummary(gs), null, ys.length));
        if (!OPEN.has(ks)) continue;
        for (const [g, zs] of gs) {
          if (gs.length > 1 || g !== '기타') out.push(pgHead(g, 2));
          for (const ws of [...groupBy(zs, promoKey).values()].sort((a, b) => chIx(a[0].channel_code) - chIx(b[0].channel_code))) {
            const kc = ks + '\u0002' + g + '\u0002' + promoKey(ws[0]);
            out.push(row(kc, 2, chName(ws[0]), `${ws[0].title} · ${fmtD(ws[0].start_date)}~${fmtD(ws[0].end_date)}`, priceRange(ws), ws.length));
            if (OPEN.has(kc)) out.push(skuLines(ws));
          }
        }
      }
      return out;
    });
  }
  // 행사별: 부문 -> 팀 (when the 부문 has more than one that day) -> 채널 행사 -> 소분류 -> SKU
  function divCard(dv, xs) {
    const k = 'D\u0001' + dv, teams = byChannels(groupBy(xs, x => divOf(x.channel_code)[1]));
    return topCard(k, dv, `${teams.length > 1 ? '팀 ' + teams.length + '개 · ' : ''}행사 채널 ${nCh(xs)}곳 · SKU ${xs.length}개`, null, () => {
      const out = [];
      const promoRows = (ys, depth, kp) => {
        const pl = promos(ys).sort((a, b) => chIx(a.e.channel_code) - chIx(b.e.channel_code) || (a.e.channel_detail || '').localeCompare(b.e.channel_detail || '') || a.e.start_date.localeCompare(b.e.start_date) || a.e.title.localeCompare(b.e.title));
        for (const p of pl) {
          const kk = kp + '\u0002' + p.key, subs = sorted(groupBy(p.list, subOf));
          const pending = p.list.filter(x => S.requests.some(r => r.event_id === x.id && r.status === 'pending')).length;
          out.push(row(kk, depth, el('span', {}, el('i', { class: 'cdot', style: 'background:' + colorOf(p.e.channel_code) }), `${chName(p.e)} · ${p.e.title}`),
            `${fmtD(p.e.start_date)}~${fmtD(p.e.end_date)} · 소분류 ${subs.length}개` + (pending ? ` · ⏳ 승인 대기 ${pending}건` : ''), null, p.list.length));
          if (!OPEN.has(kk)) continue;
          for (const [s, zs] of subs) {
            const ks = kk + '\u0002' + s, gs = pgroups(zs);
            out.push(row(ks, depth + 1, s, gs.length > 1 ? pgSummary(gs) : gs[0][0] !== '기타' ? gs[0][0] : '', priceRange(zs), zs.length));
            if (OPEN.has(ks)) for (const [g, ws] of gs) { if (gs.length > 1) out.push(pgHead(g, depth + 2)); out.push(skuLines(ws)); }
          }
        }
      };
      if (teams.length === 1) promoRows(xs, 1, k);
      else for (const [t, ys] of teams) {
        const kt = k + '\u0002' + t;
        out.push(row(kt, 1, t, `행사 채널 ${nCh(ys)}곳 · ` + [...new Set(promos(ys).sort((a, b) => chIx(a.e.channel_code) - chIx(b.e.channel_code)).map(p => chName(p.e)))].join(', '), null, ys.length));
        if (OPEN.has(kt)) promoRows(ys, 2, kt);
      }
      return out;
    });
  }
  function card(e, compact) { // compact: inside a 행사 / 소분류 group, so channel, dates and 행사명 are already shown
    return el('div', { class: 'card', onclick: () => openDetail(e) },
      el('div', { class: 'dot', style: 'background:' + colorOf(e.channel_code) }),
      el('div', { class: 'grow' },
        compact ? null : el('div', { class: 's' }, `${chDisp(e)} · ${fmtD(e.start_date)} ~ ${fmtD(e.end_date)}`),
        compact ? el('div', { class: 't', style: 'font-size:14px' }, e.product_name) : el('div', { class: 't' }, e.title),
        el('div', { class: 's' }, compact ? e.product_code + (e.pack_qty > 1 ? ` · 입수 ${e.pack_qty}` : '') + (e.memo ? ' · ' + e.memo : '') : `${e.product_code} · ${e.product_name}`),
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
      isM ? mi('📥 변경 이력 엑셀로 받기', exportLog) : null,
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
        const errs = [], subs = {};
        // 제품번호 치환표 (master keeps it on the server): wrong / temporary numbers -> real product number
        const AL = new Map((await api.listAliases()).map(a => [String(a.alias).trim().toUpperCase(), String(a.code).trim()]));
        rows.forEach((r, i) => {
          const g = n => (ix(n) >= 0 ? r[ix(n)] ?? '' : ''), praw = String(g('제품번호')).trim(), pcode = AL.get(praw.toUpperCase()) || praw, p = S.products.find(x => x.code === pcode), craw = String(g('채널')).trim(), chm = S.channels.find(c => c.code === craw || c.name === craw), ccode = chm ? chm.code : craw;
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
          if (pcode !== praw) subs[praw + ' → ' + pcode] = (subs[praw + ' → ' + pcode] || 0) + 1;
          if (why.length) errs.push(`${i + 2}행: ${why.join(', ')}`); else ready.push(e);
        });
        msg.append(el('div', { class: 'ok' }, `${isM ? '등록할 수 있는 행' : '등록 요청할 수 있는 행'} ${ready.length}개`));
        const sk = Object.keys(subs);
        if (sk.length) msg.append(el('div', { class: 's', style: 'color:var(--muted);margin:6px 0' }, `제품번호 치환표로 바꾼 행 ${Object.values(subs).reduce((a, b) => a + b, 0)}개: ` + sk.map(k => `${k} (${subs[k]})`).join(', ')));
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
      el('p', { class: 's', style: 'color:var(--muted);margin-top:0' }, '양식은 "엑셀로 내려받기" 파일과 같습니다. 앞의 11개 열(채널~메모)만 읽고, (자동) 열은 비워도 됩니다. 세부채널명은 "기타" 채널일 때만 씁니다. 단위당 정상가를 비우면 제품 기준정보의 정상가가 들어갑니다. 날짜는 2026-11-01 형식이나 엑셀 날짜 모두 됩니다. 치환표에 있는 임시·오류 제품번호는 실제 번호로 자동으로 바뀝니다.' + (isM ? '' : ' 담당자가 올리면 한 줄씩 등록 요청으로 마스터에게 갑니다.')),
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
  // master: change history (event_log) + requests (edit_requests) for a month range -> xlsx with 2 sheets
  function exportLog() {
    const t = todayKst().split('-').map(Number), cur = t[0] * 12 + t[1] - 1;
    const ym = i => `${Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`;
    const kst0 = i => new Date(ym(i) + '-01T00:00:00+09:00').toISOString();
    const opts = sel => { const s = el('select', { class: 'in' }); for (let i = cur; i >= 2026 * 12; i--) s.append(el('option', { value: i }, `${Math.floor(i / 12)}년 ${i % 12 + 1}월`)); s.value = sel; return s; };
    const from = opts(cur), to = opts(cur), msg = el('div', { class: 'err' }); msg.hidden = true;
    const go = el('button', { class: 'btn pri', style: 'margin-top:12px;width:100%' }, '엑셀로 받기');
    const ACT = { insert: '등록', update: '수정', delete: '삭제' }, KIND = { create: '등록', update: '수정', delete: '삭제' }, ST = { pending: '대기', approved: '승인', rejected: '반려' };
    const F = { channel_code: '채널', channel_detail: '세부채널명', title: '행사명', product_code: '제품번호', start_date: '시작일', end_date: '종료일', list_price: '단위당 정상가', sale_price: '단위당 판매가', pack_qty: '단위당 입수량', expected_qty: '예상수량', memo: '메모' };
    const when = v => v ? new Date(v).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16) : '';
    const val = (k, v) => v == null || v === '' ? '-' : k === 'channel_code' ? chLabel(v) : String(v);
    const diff = (o, n) => Object.keys(F).filter(k => n && k in n && String(o?.[k] ?? '') !== String(n[k] ?? '')).map(k => `${F[k]}: ${val(k, o?.[k])} → ${val(k, n[k])}`).join('\n');
    const pname = r => r.product_name || (pByCode(r.product_code) || {}).name || '';
    const logRow = l => { const r = l.new_row || l.old_row || {};
      return [when(l.at), userName(l.actor), ACT[l.action] || l.action, l.event_id ?? '', chLabel(r.channel_code, r.channel), r.channel_detail || '', r.title || '', r.product_code || '', pname(r), r.start_date || '', r.end_date || '',
        l.action === 'update' ? diff(l.old_row, l.new_row) : l.action === 'delete' ? '행사 삭제' : '신규 등록', l.note || ''];
    };
    const reqRow = q => { const ch = q.changes || {}, r = { ...(q.before_row || {}), ...(q.kind === 'create' ? ch : {}) };
      return [q.id, when(q.requested_at), userName(q.requested_by), KIND[q.kind] || q.kind, q.event_id ?? '', chLabel(r.channel_code, r.channel), r.channel_detail || '', r.title || '', r.product_code || '', pname(r), r.start_date || '', r.end_date || '',
        q.kind === 'update' ? diff(q.before_row || {}, ch) : q.kind === 'delete' ? '행사 삭제' : '신규 등록', q.reason || '', ST[q.status] || q.status, q.decided_by ? userName(q.decided_by) : '', when(q.decided_at), q.comment || ''];
    };
    go.addEventListener('click', async () => {
      let a = +from.value, b = +to.value; if (a > b) [a, b] = [b, a];
      msg.hidden = true; go.disabled = true; go.textContent = '받는 중…';
      try {
        const [log, reqs] = await Promise.all([api.listLogRange(kst0(a), kst0(b + 1)), api.listRequestsRange(kst0(a), kst0(b + 1))]);
        if (!log.length && !reqs.length) throw new Error('선택한 기간에 변경 이력이 없습니다.');
        const s1 = [['일시', '작업자', '구분', '행사번호', '채널', '세부채널명', '행사명', '제품번호', '제품명', '시작일', '종료일', '바뀐 내용 (전 → 후)', '메모'], ...log.map(logRow)];
        const s2 = [['요청번호', '요청 일시', '요청자', '구분', '행사번호', '채널', '세부채널명', '행사명', '제품번호', '제품명', '시작일', '종료일', '요청 내용 (전 → 후)', '사유', '결과', '처리자', '처리 일시', '처리 의견'], ...reqs.map(reqRow)];
        const tag = ym(a).replace('-', '') + (a === b ? '' : '-' + ym(b).replace('-', ''));
        download(await buildXlsx([{ name: '변경이력', rows: s1, header: true, wrap: [11], widths: [17, 10, 6, 8, 16, 12, 22, 10, 30, 11, 11, 40, 16] },
          { name: '요청내역', rows: s2, header: true, wrap: [12, 13, 17], widths: [8, 17, 10, 6, 8, 16, 12, 22, 10, 30, 11, 11, 40, 24, 6, 10, 17, 24] }]), `행사캘린더_변경이력_${tag}.xlsx`);
        close(); toast(`변경 ${log.length}건 · 요청 ${reqs.length}건 받았습니다.`);
      } catch (x) { msg.textContent = x.message; msg.hidden = false; go.disabled = false; go.textContent = '엑셀로 받기'; }
    });
    const chip = (label, x, y) => el('button', { class: 'btn', style: 'flex:1;padding:8px 4px', onclick: () => { from.value = x; to.value = y; } }, label);
    const close = sheet('변경 이력 엑셀로 받기', el('div', {},
      el('p', { class: 's', style: 'color:var(--muted);margin-top:0' }, '변경이 일어난 연월을 고르세요. 시트1 변경이력(등록·수정·삭제, 누가·언제·전→후), 시트2 요청내역(요청·사유·승인/반려)으로 받습니다.'),
      el('div', { style: 'display:flex;gap:6px;margin-bottom:10px' }, chip('이번 달', cur, cur), chip('지난 달', cur - 1, cur - 1), chip('최근 3개월', cur - 2, cur)),
      el('div', { style: 'display:flex;gap:8px;align-items:center' }, el('div', { class: 'f', style: 'flex:1;margin:0' }, el('label', {}, '시작 월'), from), el('span', { style: 'padding-top:18px' }, '~'), el('div', { class: 'f', style: 'flex:1;margin:0' }, el('label', {}, '끝 월'), to)),
      msg, go));
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
        '☰ → 기준정보 올리기에서 채널·제품 목록을 엑셀로 바꿉니다.',
        '☰ → 변경 이력 엑셀로 받기: 고른 기간의 변경 이력(누가·언제·전→후)과 요청 내역(사유·승인/반려)을 시트 2개로 받습니다.')
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
