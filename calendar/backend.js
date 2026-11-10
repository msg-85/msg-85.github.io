// Data backends with one interface. SupabaseBackend talks to the real server with plain fetch;
// DemoBackend keeps everything in this browser (localStorage) and applies the same rules, for trying the app.
(function () {
  const KST = 9 * 3600 * 1000;
  // lock time: 09:00 KST the day after end_date (= 00:00 UTC that day)
  const lockAt = end => { const [y, m, d] = end.split('-').map(Number); return Date.UTC(y, m - 1, d + 1, 0, 0, 0); };
  const isLocked = ev => Date.now() >= lockAt(ev.end_date);
  const todayKst = () => new Date(Date.now() + KST).toISOString().slice(0, 10);
  const discount = (lp, sp) => (lp > 0 ? Math.round(((lp - sp) / lp) * 1000) / 10 : null);
  const EMAIL_DOMAIN = '@users.event-calendar.app';
  class AppError extends Error { constructor(msg, code) { super(msg); this.code = code; } }

  function canEdit(user, ev) {
    if (!user) return false;
    if (user.role === 'master') return true;
    return user.role === 'manager' && ev.created_by === user.id && !isLocked(ev);
  }
  function canCreate(user, ev) {
    if (!user) return false;
    if (user.role === 'master') return true;
    return user.role === 'manager' && !isLocked(ev);
  }
  function validate(ev) {
    const need = { channel_code: '채널', title: '행사명', product_code: '제품', start_date: '시작일', end_date: '종료일', list_price: '정상가', sale_price: '판매단가' };
    for (const [k, label] of Object.entries(need)) if (ev[k] === '' || ev[k] == null || (typeof ev[k] === 'number' && isNaN(ev[k]))) throw new AppError(label + '을(를) 입력해 주세요.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(ev.end_date)) throw new AppError('날짜 형식이 맞지 않습니다.');
    if (ev.end_date < ev.start_date) throw new AppError('종료일이 시작일보다 빠릅니다.');
    if (!(ev.list_price > 0)) throw new AppError('정상가는 0보다 커야 합니다.');
    if (!(ev.sale_price >= 0)) throw new AppError('판매단가를 확인해 주세요.');
    if (ev.expected_qty != null && !(ev.expected_qty >= 0)) throw new AppError('예상수량을 확인해 주세요.');
  }
  const randomCode = () => { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; const r = crypto.getRandomValues(new Uint8Array(8)); for (const x of r) s += a[x % a.length]; return s.slice(0, 4) + '-' + s.slice(4); };

  // ======================= Supabase =======================
  class SupabaseBackend {
    constructor(url, key) { this.url = url.replace(/\/$/, ''); this.key = key; this.sess = null; this.user = null; this.demo = false; this.SKEY = 'evcal-session'; }
    async _auth(path, body) {
      const r = await fetch(this.url + '/auth/v1/' + path, { method: 'POST', headers: { apikey: this.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new AppError(j.msg || j.error_description || j.message || ('로그인 오류 ' + r.status), r.status);
      return j;
    }
    _save(j) {
      this.sess = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, uid: j.user && j.user.id };
      try { localStorage.setItem(this.SKEY, JSON.stringify(this.sess)); } catch (e) {}
    }
    async _token() {
      if (!this.sess) throw new AppError('다시 로그인해 주세요.', 401);
      if (Date.now() > this.sess.expires_at - 60000) {
        try { this._save(await this._auth('token?grant_type=refresh_token', { refresh_token: this.sess.refresh_token })); }
        catch (e) { this.sess = null; try { localStorage.removeItem(this.SKEY); } catch (x) {} throw new AppError('로그인이 만료되었습니다. 다시 로그인해 주세요.', 401); }
      }
      return this.sess.access_token;
    }
    async _rest(path, opts = {}) {
      const t = await this._token();
      const r = await fetch(this.url + '/rest/v1/' + path, {
        method: opts.method || 'GET',
        headers: { apikey: this.key, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json', Prefer: opts.prefer || 'return=representation' },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
      if (r.status === 204) return null;
      const j = await r.json().catch(() => null);
      if (!r.ok) {
        const m = (j && (j.message || j.hint)) || '';
        if (/row-level security|permission denied/i.test(m)) throw new AppError('수정 권한이 없습니다. 담당자는 본인이 등록한 일정만, 종료일 다음 날 오전 9시 전까지 수정할 수 있습니다.', 403);
        throw new AppError(m || ('서버 오류 ' + r.status), r.status);
      }
      return j;
    }
    async restore() {
      try { this.sess = JSON.parse(localStorage.getItem(this.SKEY) || 'null'); } catch (e) { this.sess = null; }
      if (!this.sess) return null;
      try { return await this._loadMe(); } catch (e) { if (e.code === 401) return null; throw e; }
    }
    async _loadMe() {
      const rows = await this._rest('profiles?select=*&id=eq.' + this.sess.uid);
      const p = rows && rows[0];
      if (!p) throw new AppError('가입 코드 등록이 끝나지 않은 계정입니다.', 'noprofile');
      if (!p.active) throw new AppError('사용이 중지된 계정입니다. 마스터에게 문의해 주세요.', 'inactive');
      this.user = { id: p.id, login: p.login, name: p.display_name, role: p.role };
      return this.user;
    }
    async login(login, pw) {
      this._save(await this._auth('token?grant_type=password', { email: login.trim().toLowerCase() + EMAIL_DOMAIN, password: pw }).catch(e => { throw new AppError(e.code === 400 ? '아이디 또는 비밀번호가 맞지 않습니다.' : e.message); }));
      return this._loadMe();
    }
    async signup(code, login, name, pw) {
      const email = login.trim().toLowerCase() + EMAIL_DOMAIN;
      let j;
      try { j = await this._auth('signup', { email, password: pw }); }
      catch (e) {
        if (/already|registered|exists/i.test(e.message)) j = await this._auth('token?grant_type=password', { email, password: pw }).catch(() => { throw new AppError('이미 있는 아이디입니다. 다른 아이디를 써 주세요.'); });
        else if (/password/i.test(e.message)) throw new AppError('비밀번호는 6자 이상으로 정해 주세요.');
        else throw e;
      }
      if (!j.access_token) throw new AppError('가입 설정을 확인해야 합니다 (이메일 확인 끄기). 마스터에게 알려 주세요.');
      this._save(j);
      await this._rest('rpc/redeem_invite', { method: 'POST', body: { p_code: code, p_login: login, p_name: name } });
      return this._loadMe();
    }
    logout() { this.sess = null; this.user = null; try { localStorage.removeItem(this.SKEY); } catch (e) {} }
    listEvents(from, to) { return this._rest(`events?select=*&start_date=lte.${to}&end_date=gte.${from}&order=start_date.asc,channel.asc`); }
    listAllEvents() { return this._rest('events?select=*&order=start_date.asc'); }
    async saveEvent(ev) {
      validate(ev);
      const body = { channel_code: ev.channel_code, title: ev.title.trim(), product_code: ev.product_code, start_date: ev.start_date, end_date: ev.end_date,
        list_price: ev.list_price, sale_price: ev.sale_price, expected_qty: ev.expected_qty ?? null, memo: ev.memo || null };
      const r = ev.id ? await this._rest('events?id=eq.' + ev.id, { method: 'PATCH', body }) : await this._rest('events', { method: 'POST', body });
      if (!r || !r.length) throw new AppError('수정 권한이 없습니다. 담당자는 본인이 등록한 일정만, 종료일 다음 날 오전 9시 전까지 수정할 수 있습니다.', 403);
      return r[0];
    }
    async importEvents(list) { for (const e of list) validate(e); return this._rest('events', { method: 'POST', body: list }); }
    async deleteEvent(id) { const r = await this._rest('events?id=eq.' + id, { method: 'DELETE' }); if (!r || !r.length) throw new AppError('삭제 권한이 없습니다. 담당자는 본인이 등록한 일정만, 종료일 다음 날 오전 9시 전까지 삭제할 수 있습니다.', 403); }
    listProducts() { return this._rest('products?select=*&order=brand.asc,name.asc'); }
    listChannels() { return this._rest('channels?select=*&order=name.asc'); }
    upsertChannels(rows) { return this._rest('channels?on_conflict=code', { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=representation' }); }
    upsertProducts(rows) { return this._rest('products?on_conflict=code', { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=representation' }); }
    listUsers() { return this._rest('profiles?select=*&order=created_at.asc'); }
    setUser(id, patch) { return this._rest('profiles?id=eq.' + id, { method: 'PATCH', body: patch }); }
    listInvites() { return this._rest('invites?select=*&order=created_at.desc'); }
    async createInvite(role, note) { const r = await this._rest('invites', { method: 'POST', body: { code: randomCode(), role, note: note || null, created_by: this.user.id } }); return r[0]; }
    revokeInvite(code) { return this._rest('invites?code=eq.' + encodeURIComponent(code), { method: 'PATCH', body: { revoked: true } }); }
    listLog(limit = 200) { return this._rest('event_log?select=*&order=at.desc&limit=' + limit); }
  }

  // ======================= Demo (this browser only) =======================
  class DemoBackend {
    constructor() { this.demo = true; this.K = 'evcal-demo-v2'; this.user = null; this._load(); }
    _load() {
      let d = null; try { d = JSON.parse(localStorage.getItem(this.K) || 'null'); } catch (e) {}
      this.db = d || this._seed(); this._persist();
    }
    _persist() { try { localStorage.setItem(this.K, JSON.stringify(this.db)); } catch (e) {} }
    _seed() {
      const users = [
        { id: 'u-master', login: 'master', display_name: '마스터', role: 'master', active: true, pw: '1234', created_at: new Date().toISOString() },
        { id: 'u-kim', login: 'kim', display_name: '김담당 (쿠팡)', role: 'manager', active: true, pw: '1234', created_at: new Date().toISOString() },
        { id: 'u-lee', login: 'lee', display_name: '이담당 (네이버)', role: 'manager', active: true, pw: '1234', created_at: new Date().toISOString() },
      ];
      const channels = [{ code: 'CP', name: '쿠팡', active: true }, { code: 'NV', name: '네이버', active: true }, { code: 'EM', name: '이마트', active: true }, { code: 'ST', name: '11번가', active: true }, { code: 'OWN', name: '자사몰', active: true }];
      const products = [
        { code: 'A1001', name: '예시분유 1단계 800g', brand: '브랜드A', list_price: 32000, active: true },
        { code: 'A1002', name: '예시분유 2단계 800g', brand: '브랜드A', list_price: 33000, active: true },
        { code: 'A1003', name: '예시분유 3단계 800g', brand: '브랜드A', list_price: 34000, active: true },
        { code: 'B2001', name: '샘플분유 1단계 750g', brand: '브랜드B', list_price: 24000, active: true },
        { code: 'B2002', name: '샘플분유 2단계 750g', brand: '브랜드B', list_price: 25000, active: true },
        { code: 'C3001', name: '테스트 산양분유 1단계', brand: '브랜드C', list_price: 41000, active: true },
      ];
      const t = new Date(Date.now() + KST); const y = t.getUTCFullYear(), m = t.getUTCMonth();
      const D = (dd, mm = m) => new Date(Date.UTC(y, mm, dd)).toISOString().slice(0, 10);
      const P = c => products.find(p => p.code === c);
      const CH = n => channels.find(c => c.name === n).code;
      const mk = (id, channel, title, code, s, e, sp, qty, by, memo) => ({ id, channel_code: CH(channel), channel, title, product_code: code, product_name: P(code).name, brand: P(code).brand,
        start_date: s, end_date: e, list_price: P(code).list_price, sale_price: sp, expected_qty: qty, memo: memo || '', created_by: by, created_at: new Date().toISOString(), updated_by: by, updated_at: new Date().toISOString() });
      const events = [
        mk(1, '쿠팡', '월초 특가', 'A1001', D(1), D(5), 27900, 1200, 'u-kim'),
        mk(2, '네이버', '브랜드데이', 'A1002', D(3), D(9), 28500, 800, 'u-lee', '쿠폰 10% 별도'),
        mk(3, '이마트', '행사 매대', 'B2001', D(7), D(20), 21000, 500, 'u-master'),
        mk(4, '쿠팡', '타임딜', 'C3001', D(12), D(13), 34900, 300, 'u-kim'),
        mk(5, '11번가', '십일절', 'B2002', D(11), D(11), 19900, 1500, 'u-master'),
        mk(6, '네이버', '라이브 방송', 'A1003', D(18), D(18), 29000, 400, 'u-lee'),
        mk(7, '자사몰', '정기구독 할인', 'A1001', D(15), D(28), 28800, null, 'u-master', '정기구독 고객 한정'),
        mk(8, '쿠팡', '월말 특가', 'A1002', D(25), D(30), 29500, 900, 'u-kim'),
        mk(9, '네이버', '다음달 예고 행사', 'B2001', D(2, m + 1), D(8, m + 1), 21500, 600, 'u-lee'),
      ];
      return { users, channels, products, events, invites: [{ code: 'DEMO-2026', role: 'manager', note: '시험용', created_by: 'u-master', created_at: new Date().toISOString(), used_by: null, used_at: null, revoked: false }], log: [], seq: 10 };
    }
    _me(u) { this.user = { id: u.id, login: u.login, name: u.display_name, role: u.role }; try { sessionStorage.setItem(this.K + '-me', u.id); } catch (e) {} return this.user; }
    async restore() { let id = null; try { id = sessionStorage.getItem(this.K + '-me'); } catch (e) {} const u = this.db.users.find(x => x.id === id && x.active); return u ? this._me(u) : null; }
    async login(login, pw) {
      const u = this.db.users.find(x => x.login === login.trim().toLowerCase());
      if (!u || u.pw !== pw) throw new AppError('아이디 또는 비밀번호가 맞지 않습니다.');
      if (!u.active) throw new AppError('사용이 중지된 계정입니다. 마스터에게 문의해 주세요.');
      return this._me(u);
    }
    async signup(code, login, name, pw) {
      const inv = this.db.invites.find(i => i.code === code.trim().toUpperCase());
      if (!inv || inv.revoked || inv.used_by) throw new AppError('사용할 수 없는 가입 코드입니다.');
      if (pw.length < 6) throw new AppError('비밀번호는 6자 이상으로 정해 주세요.');
      if (this.db.users.some(u => u.login === login.trim().toLowerCase())) throw new AppError('이미 있는 아이디입니다. 다른 아이디를 써 주세요.');
      const u = { id: 'u-' + Date.now(), login: login.trim().toLowerCase(), display_name: name.trim(), role: inv.role, active: true, pw, created_at: new Date().toISOString() };
      this.db.users.push(u); inv.used_by = u.id; inv.used_at = new Date().toISOString(); this._persist();
      return this._me(u);
    }
    logout() { this.user = null; try { sessionStorage.removeItem(this.K + '-me'); } catch (e) {} }
    _guard() { if (!this.user) throw new AppError('다시 로그인해 주세요.', 401); }
    async listEvents(from, to) { this._guard(); return this.db.events.filter(e => e.start_date <= to && e.end_date >= from).sort((a, b) => a.start_date.localeCompare(b.start_date) || a.channel.localeCompare(b.channel)).map(e => ({ ...e, discount_rate: discount(e.list_price, e.sale_price) })); }
    async listAllEvents() { return this.listEvents('0000-01-01', '9999-12-31'); }
    _log(action, oldRow, newRow) { this.db.log.unshift({ id: Date.now() + Math.random(), event_id: (newRow || oldRow).id, action, actor: this.user.id, at: new Date().toISOString(), old_row: oldRow, new_row: newRow }); this.db.log = this.db.log.slice(0, 500); }
    async saveEvent(ev) {
      this._guard(); validate(ev);
      const p = this.db.products.find(x => x.code === ev.product_code); if (!p) throw new AppError('등록되지 않은 제품 코드입니다: ' + ev.product_code);
      const c = this.db.channels.find(x => x.code === ev.channel_code); if (!c) throw new AppError('등록되지 않은 채널 코드입니다: ' + ev.channel_code);
      const base = { channel_code: c.code, channel: c.name, title: ev.title.trim(), product_code: p.code, product_name: p.name, brand: p.brand, start_date: ev.start_date, end_date: ev.end_date,
        list_price: ev.list_price, sale_price: ev.sale_price, expected_qty: ev.expected_qty ?? null, memo: ev.memo || '', updated_by: this.user.id, updated_at: new Date().toISOString() };
      if (ev.id) {
        const cur = this.db.events.find(x => x.id === ev.id); if (!cur) throw new AppError('일정을 찾지 못했습니다.');
        if (!canEdit(this.user, cur) || !canEdit(this.user, { ...cur, ...base })) throw new AppError('수정 권한이 없습니다. 담당자는 본인이 등록한 일정만, 종료일 다음 날 오전 9시 전까지 수정할 수 있습니다.', 403);
        const old = { ...cur }; Object.assign(cur, base); this._log('update', old, { ...cur }); this._persist(); return cur;
      }
      if (!canCreate(this.user, base)) throw new AppError('이미 잠긴 기간의 행사는 마스터만 등록할 수 있습니다.', 403);
      const row = { id: ++this.db.seq, ...base, created_by: this.user.id, created_at: new Date().toISOString() };
      this.db.events.push(row); this._log('insert', null, row); this._persist(); return row;
    }
    async importEvents(list) { const out = []; for (const e of list) out.push(await this.saveEvent(e)); return out; }
    async deleteEvent(id) {
      this._guard(); const cur = this.db.events.find(x => x.id === id); if (!cur) return;
      if (!canEdit(this.user, cur)) throw new AppError('삭제 권한이 없습니다. 담당자는 본인이 등록한 일정만, 종료일 다음 날 오전 9시 전까지 삭제할 수 있습니다.', 403);
      this.db.events = this.db.events.filter(x => x.id !== id); this._log('delete', cur, null); this._persist();
    }
    async listProducts() { this._guard(); return [...this.db.products].sort((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name)); }
    async listChannels() { this._guard(); return [...this.db.channels].sort((a, b) => a.name.localeCompare(b.name)); }
    async upsertChannels(rows) { this._master(); for (const r of rows) { const i = this.db.channels.findIndex(p => p.code === r.code); if (i >= 0) this.db.channels[i] = { ...this.db.channels[i], ...r }; else this.db.channels.push({ active: true, ...r }); } this._persist(); return rows; }
    async upsertProducts(rows) { this._master(); for (const r of rows) { const i = this.db.products.findIndex(p => p.code === r.code); if (i >= 0) this.db.products[i] = { ...this.db.products[i], ...r }; else this.db.products.push({ active: true, ...r }); } this._persist(); return rows; }
    _master() { this._guard(); if (this.user.role !== 'master') throw new AppError('마스터만 할 수 있습니다.', 403); }
    async listUsers() { this._guard(); return this.db.users.map(({ pw, ...u }) => u); }
    async setUser(id, patch) { this._master(); const u = this.db.users.find(x => x.id === id); Object.assign(u, patch); this._persist(); }
    async listInvites() { this._master(); return [...this.db.invites].reverse(); }
    async createInvite(role, note) { this._master(); const inv = { code: randomCode(), role, note: note || null, created_by: this.user.id, created_at: new Date().toISOString(), used_by: null, used_at: null, revoked: false }; this.db.invites.push(inv); this._persist(); return inv; }
    async revokeInvite(code) { this._master(); const i = this.db.invites.find(x => x.code === code); if (i) i.revoked = true; this._persist(); }
    async listLog() { this._master(); return this.db.log; }
    reset() { localStorage.removeItem(this.K); this._load(); }
  }

  window.Cal = { SupabaseBackend, DemoBackend, AppError, lockAt, isLocked, canEdit, canCreate, todayKst, discount };
})();
