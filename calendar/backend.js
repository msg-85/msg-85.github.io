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

  // Only the master writes events directly. Managers send requests (new / change / delete) that the master approves.
  function canEdit(user, ev) { return !!user && user.role === 'master'; }
  function canCreate(user, ev) { return !!user && user.role === 'master'; }
  function validate(ev) {
    const need = { channel_code: '채널', title: '행사명', product_code: '제품', start_date: '시작일', end_date: '종료일', list_price: '정상가', sale_price: '판매단가' };
    for (const [k, label] of Object.entries(need)) if (ev[k] === '' || ev[k] == null || (typeof ev[k] === 'number' && isNaN(ev[k]))) throw new AppError(label + '을(를) 입력해 주세요.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(ev.end_date)) throw new AppError('날짜 형식이 맞지 않습니다.');
    if (ev.end_date < ev.start_date) throw new AppError('종료일이 시작일보다 빠릅니다.');
    if (!(ev.list_price > 0)) throw new AppError('정상가는 0보다 커야 합니다.');
    if (!(ev.sale_price >= 0)) throw new AppError('판매단가를 확인해 주세요.');
    if (ev.expected_qty != null && !(ev.expected_qty >= 0)) throw new AppError('예상수량을 확인해 주세요.');
    if (!(Number.isInteger(ev.pack_qty) && ev.pack_qty > 0)) throw new AppError('단위당 입수량을 1 이상의 정수로 적어 주세요.');
  }
  // temporary password a master hands out: no look-alike characters, easy to read out
  const tempPassword = () => { const a = 'abcdefghjkmnpqrstuvwxyz23456789'; let s = ''; for (const x of crypto.getRandomValues(new Uint8Array(8))) s += a[x % a.length]; return s; };
  function checkNewPw(cur, next) {
    if (!next || next.length < 6) throw new AppError('새 비밀번호는 6자 이상으로 정해 주세요.');
    if (cur === next) throw new AppError('지금 비밀번호와 다른 비밀번호로 정해 주세요.');
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
      this.sess = { access_token: j.access_token, refresh_token: j.refresh_token, expires_at: Date.now() + (j.expires_in || 3600) * 1000, uid: j.user && j.user.id, email: (j.user && j.user.email) || (this.sess && this.sess.email) || null };
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
        if (/row-level security|permission denied/i.test(m)) throw new AppError('수정은 마스터만 직접 할 수 있습니다. 담당자는 행사를 누르고 [수정 요청]을 보내 주세요.', 403);
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
      this.user = { id: p.id, login: p.login, name: p.display_name, role: p.role, channels: p.channels || [], mustChange: !!p.must_change_pw };
      return this.user;
    }
    // change my own password: the current one is checked first by signing in with it
    async changePassword(cur, next) {
      checkNewPw(cur, next);
      let email = this.sess && this.sess.email;
      if (!email) { const t = await this._token(); const r = await fetch(this.url + '/auth/v1/user', { headers: { apikey: this.key, Authorization: 'Bearer ' + t } }); email = r.ok ? (await r.json()).email : (this.user.login || '').toLowerCase() + EMAIL_DOMAIN; }
      this._save(await this._auth('token?grant_type=password', { email, password: cur }).catch(e => { throw new AppError(e.code === 400 ? '지금 비밀번호가 맞지 않습니다.' : e.message); }));
      const r = await fetch(this.url + '/auth/v1/user', { method: 'PUT', headers: { apikey: this.key, Authorization: 'Bearer ' + this.sess.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: next }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})), m = j.msg || j.message || j.error_description || ''; throw new AppError(/different/i.test(m) ? '지금 비밀번호와 다른 비밀번호로 정해 주세요.' : /weak|length|short/i.test(m) ? '비밀번호가 너무 쉽습니다. 6자 이상으로 다시 정해 주세요.' : ('비밀번호를 바꾸지 못했습니다. ' + m)); }
      // the password is already changed here; a server without migrate-password.sql has no flag to clear
      try { await this._rest('rpc/password_changed', { method: 'POST', body: {} }); } catch (e) { if (this.user.mustChange) throw e; }
      this.user.mustChange = false;
    }
    // master: give someone a temporary password (they must change it at their next login)
    async resetPassword(userId) {
      const temp = tempPassword();
      try { await this._rest('rpc/admin_reset_password', { method: 'POST', body: { p_user: userId, p_temp: temp } }); }
      catch (e) { if (e.code === 404 || /admin_reset_password/.test(e.message)) throw new AppError('서버 설정이 아직 안 됐습니다 (migrate-password.sql 실행 필요).'); throw e; }
      return temp;
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
    // the server returns at most 1000 rows per request, so page through
    async listEvents(from, to) {
      const out = [];
      for (let off = 0; ; off += 1000) {
        const r = await this._rest(`events?select=*&start_date=lte.${to}&end_date=gte.${from}&order=start_date.asc,channel.asc,id.asc&limit=1000&offset=${off}`);
        out.push(...(r || [])); if (!r || r.length < 1000) return out;
      }
    }
    listAllEvents() { return this._rest('events?select=*&order=start_date.asc'); }
    async saveEvent(ev) {
      validate(ev);
      const body = { channel_code: ev.channel_code, title: ev.title.trim(), product_code: ev.product_code, start_date: ev.start_date, end_date: ev.end_date,
        list_price: ev.list_price, sale_price: ev.sale_price, pack_qty: ev.pack_qty ?? null, expected_qty: ev.expected_qty ?? null, memo: ev.memo || null, channel_detail: (ev.channel_detail || '').trim() || null };
      const r = ev.id ? await this._rest('events?id=eq.' + ev.id, { method: 'PATCH', body }) : await this._rest('events', { method: 'POST', body });
      if (!r || !r.length) throw new AppError('수정은 마스터만 직접 할 수 있습니다. 담당자는 행사를 누르고 [수정 요청]을 보내 주세요.', 403);
      return r[0];
    }
    async importEvents(list) { for (const e of list) validate(e); return this._rest('events', { method: 'POST', body: list }); }
    async deleteEvent(id) { const r = await this._rest('events?id=eq.' + id, { method: 'DELETE' }); if (!r || !r.length) throw new AppError('삭제는 마스터만 직접 할 수 있습니다. 담당자는 행사를 누르고 [삭제 요청]을 보내 주세요.', 403); }
    listProducts() { return this._rest('products?select=*&order=code.asc'); }
    listChannels() { return this._rest('channels?select=*&order=sort_no.asc,code.asc'); }
    upsertChannels(rows) { return this._rest('channels?on_conflict=code', { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=representation' }); }
    upsertProducts(rows) { return this._rest('products?on_conflict=code', { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=representation' }); }
    listUsers() { return this._rest('profiles?select=*&order=created_at.asc'); }
    setUser(id, patch) { return this._rest('profiles?id=eq.' + id, { method: 'PATCH', body: patch }); }
    listInvites() { return this._rest('invites?select=*&order=created_at.desc'); }
    async createInvite(role, note, channels) { const r = await this._rest('invites', { method: 'POST', body: { code: randomCode(), role, note: note || null, channels: channels || [], created_by: this.user.id } }); return r[0]; }
    revokeInvite(code) { return this._rest('invites?code=eq.' + encodeURIComponent(code), { method: 'PATCH', body: { revoked: true } }); }
    listLog(limit = 200) { return this._rest('event_log?select=*&order=at.desc&limit=' + limit); }
  }

  // ======================= Demo (this browser only) =======================
  class DemoBackend {
    constructor() { this.demo = true; this.K = 'evcal-demo-v11'; this.user = null; this._load(); }
    _load() {
      let d = null; try { d = JSON.parse(localStorage.getItem(this.K) || 'null'); } catch (e) {}
      this.db = d || this._seed(); this._persist();
    }
    _persist() { try { localStorage.setItem(this.K, JSON.stringify(this.db)); } catch (e) {} }
    _seed() {
      const users = [
        { id: 'u-master', login: 'master', display_name: '마스터', role: 'master', channels: [], active: true, pw: '1234', created_at: new Date().toISOString() },
        { id: 'u-kim', login: 'kim', display_name: '김담당 (쿠팡)', role: 'manager', channels: ['F1.쿠팡'], active: true, pw: '1234', created_at: new Date().toISOString() },
        { id: 'u-lee', login: 'lee', display_name: '이담당 (네이버)', role: 'manager', channels: ['G1.네이버', 'G4.직영몰'], active: true, pw: '1234', created_at: new Date().toISOString() },
      ];
      const channels = ['A1.상온', 'B1.시판', 'B2.방판', 'C1.이마트', 'C2.롯데마트', 'C3.홈플러스', 'C4.H기타', 'D1.농협', 'D2.GS슈퍼', 'D3.롯데슈퍼', 'D4.이마트에브리', 'D5.익스프레스', 'D6.코스트코', 'D7.트레이더스', 'D8.VIC', 'D9.서원유통', 'D10.백화점', 'D11.바다마트', 'D12.다이소', 'D13.S기타', 'E1.CU', 'E2.GS', 'E3.세븐', 'E4.이마트24', 'E5.코레일', 'E6.C-Space', 'E7.C기타', 'F1.쿠팡', 'F2.벤더', 'F3.E1기타', 'G1.네이버', 'G2.마켓컬리', 'G3.B마트', 'G4.직영몰', 'G5.올리브영', 'G6.생협', 'G7.병조리원', 'G9.E2기타', 'G8.오픈마켓', 'H1.단체급식', 'H2.F기획기타', 'I1.군납', 'I2.미군납', 'I3.커피빵', 'I4.분식', 'I5.교정협회', 'I6.F1기타', 'J1.스타벅스', 'J2.분식', 'J3.커피빵', 'J4.F2기타', '글로벌', '외주', '기타'].map((n, i) => ({ code: n, name: n, sort_no: i + 1, active: true }));
      const products = (window.DEMO_PRODUCTS || []).map(p => ({ ...p }));
      const t = new Date(Date.now() + KST); const y = t.getUTCFullYear(), m = t.getUTCMonth();
      const D = (dd, mm = m) => new Date(Date.UTC(y, mm, dd)).toISOString().slice(0, 10);
      const P = c => products.find(p => p.code === c) || { name: c, cat_l: '', cat_s: '' };
      const CH = n => channels.find(c => c.name.endsWith('.' + n)).code;
      // demo prices are made up (the product list has no 정상가)
      const mk = (id, channel, title, code, s, e, lp, sp, qty, by, memo) => ({ id, channel_code: CH(channel), channel: CH(channel), title, product_code: code, product_name: P(code).name, cat_l: P(code).cat_l, cat_s: P(code).cat_s,
        start_date: s, end_date: e, list_price: lp, sale_price: sp, pack_qty: P(code).name.match(/\((\d+)입\)/) ? +P(code).name.match(/\((\d+)입\)/)[1] : 1, expected_qty: qty, memo: memo || '', channel_detail: '', created_by: by, created_at: new Date().toISOString(), updated_by: by, updated_at: new Date().toISOString() });
      const events = [
        mk(1, '쿠팡', '월초 특가', '9000101', D(1), D(5), 38000, 31900, 1200, 'u-kim'),
        mk(2, '네이버', '브랜드데이', '9000102', D(3), D(9), 62000, 52900, 800, 'u-lee', '쿠폰 10% 별도'),
        mk(3, '이마트', '행사 매대', '9002001', D(7), D(20), 24000, 19900, 500, 'u-master'),
        mk(4, '쿠팡', '타임딜', '9000201', D(12), D(13), 21000, 16900, 300, 'u-kim'),
        mk(5, 'CU', '1+1 행사', '9000501', D(11), D(11), 15000, 12000, 1500, 'u-master'),
        mk(6, '네이버', '라이브 방송', '9002002', D(18), D(18), 18000, 14900, 400, 'u-lee'),
        mk(7, '직영몰', '정기구독 할인', '9001301', D(15), D(28), 36000, 30600, null, 'u-master', '정기구독 고객 한정'),
        mk(8, '쿠팡', '월말 특가', '9001901', D(25), D(30), 96000, 79900, 900, 'u-kim'),
        mk(9, '네이버', '다음달 예고 행사', '9000202', D(2, m + 1), D(8, m + 1), 27000, 22900, 600, 'u-lee'),
      ];
      return { users, channels, products, events, invites: [{ code: 'DEMO-2026', role: 'manager', note: '시험용', created_by: 'u-master', created_at: new Date().toISOString(), used_by: null, used_at: null, revoked: false }], log: [], seq: 20,
        // two waiting requests so the master sees how approval works
        requests: [
          { id: 10, event_id: 1, kind: 'update', changes: { sale_price: 29900 }, before_row: { ...events[0] }, reason: '쿠팡 추가 할인 반영 (거래처 확정)', status: 'pending', requested_by: 'u-kim', requested_at: new Date().toISOString(), decided_by: null, decided_at: null, comment: null },
          { id: 11, event_id: null, kind: 'create', changes: { channel_code: CH('네이버'), title: '주말 특가', product_code: '9000101', start_date: D(21), end_date: D(23), list_price: 36000, sale_price: 29900, pack_qty: 24, expected_qty: 700, memo: '' }, before_row: null, reason: '신규 등록', status: 'pending', requested_by: 'u-lee', requested_at: new Date().toISOString(), decided_by: null, decided_at: null, comment: null },
        ] };
    }
    _me(u) { this.user = { id: u.id, login: u.login, name: u.display_name, role: u.role, channels: u.channels || [], mustChange: !!u.must_change_pw }; try { sessionStorage.setItem(this.K + '-me', u.id); } catch (e) {} return this.user; }
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
      const u = { id: 'u-' + Date.now(), login: login.trim().toLowerCase(), display_name: name.trim(), role: inv.role, channels: inv.channels || [], active: true, pw, created_at: new Date().toISOString() };
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
      const base = { channel_code: c.code, channel: c.name, title: ev.title.trim(), product_code: p.code, product_name: p.name, cat_l: p.cat_l || '', cat_s: p.cat_s || '', start_date: ev.start_date, end_date: ev.end_date,
        list_price: ev.list_price, sale_price: ev.sale_price, pack_qty: ev.pack_qty ?? null, expected_qty: ev.expected_qty ?? null, memo: ev.memo || '', channel_detail: (ev.channel_detail || '').trim(), updated_by: this.user.id, updated_at: new Date().toISOString() };
      if (isEtc(c.name) && !base.channel_detail) throw new AppError('"기타" 채널은 세부 채널명을 적어 주세요.');
      if (ev.id) {
        const cur = this.db.events.find(x => x.id === ev.id); if (!cur) throw new AppError('일정을 찾지 못했습니다.');
        if (!canEdit(this.user, cur) || !canEdit(this.user, { ...cur, ...base })) throw new AppError('수정은 마스터만 직접 할 수 있습니다. 담당자는 행사를 누르고 [수정 요청]을 보내 주세요.', 403);
        const old = { ...cur }; Object.assign(cur, base); this._log('update', old, { ...cur }); this._persist(); return cur;
      }
      if (!canCreate(this.user, base)) throw new AppError('행사 등록은 마스터만 직접 할 수 있습니다. 담당자는 등록 요청을 보내 주세요.', 403);
      const row = { id: ++this.db.seq, ...base, created_by: ev._owner || this.user.id, created_at: new Date().toISOString() };
      this.db.events.push(row); this._log('insert', null, row); this._persist(); return row;
    }
    async importEvents(list) { const out = []; for (const e of list) out.push(await this.saveEvent(e)); return out; }
    async deleteEvent(id) {
      this._guard(); const cur = this.db.events.find(x => x.id === id); if (!cur) return;
      if (!canEdit(this.user, cur)) throw new AppError('삭제는 마스터만 직접 할 수 있습니다. 담당자는 행사를 누르고 [삭제 요청]을 보내 주세요.', 403);
      this.db.events = this.db.events.filter(x => x.id !== id); this._log('delete', cur, null); this._persist();
    }
    async listProducts() { this._guard(); return [...this.db.products].sort((a, b) => a.code.localeCompare(b.code)); }
    async listChannels() { this._guard(); return [...this.db.channels].sort((a, b) => (a.sort_no || 0) - (b.sort_no || 0)); }
    async upsertChannels(rows) { this._master(); for (const r of rows) { const i = this.db.channels.findIndex(p => p.code === r.code); if (i >= 0) this.db.channels[i] = { ...this.db.channels[i], ...r }; else this.db.channels.push({ active: true, ...r }); } this._persist(); return rows; }
    async upsertProducts(rows) { this._master(); for (const r of rows) { const i = this.db.products.findIndex(p => p.code === r.code); if (i >= 0) this.db.products[i] = { ...this.db.products[i], ...r }; else this.db.products.push({ active: true, ...r }); } this._persist(); return rows; }
    _master() { this._guard(); if (this.user.role !== 'master') throw new AppError('마스터만 할 수 있습니다.', 403); }
    async listUsers() { this._guard(); return this.db.users.map(({ pw, ...u }) => u); }
    async changePassword(cur, next) {
      this._guard(); checkNewPw(cur, next);
      const u = this.db.users.find(x => x.id === this.user.id);
      if (u.pw !== cur) throw new AppError('지금 비밀번호가 맞지 않습니다.');
      u.pw = next; u.must_change_pw = false; this.user.mustChange = false; this._persist();
    }
    async resetPassword(userId) {
      this._master(); if (userId === this.user.id) throw new AppError('본인 비밀번호는 ☰ → 비밀번호 변경에서 바꿔 주세요.');
      const u = this.db.users.find(x => x.id === userId); if (!u) throw new AppError('사용자를 찾지 못했습니다.');
      const temp = tempPassword(); u.pw = temp; u.must_change_pw = true; this._persist(); return temp;
    }
    async setUser(id, patch) { this._master(); const u = this.db.users.find(x => x.id === id); Object.assign(u, patch); this._persist(); }
    async listInvites() { this._master(); return [...this.db.invites].reverse(); }
    async createInvite(role, note, channels) { this._master(); const inv = { code: randomCode(), role, note: note || null, channels: channels || [], created_by: this.user.id, created_at: new Date().toISOString(), used_by: null, used_at: null, revoked: false }; this.db.invites.push(inv); this._persist(); return inv; }
    async revokeInvite(code) { this._master(); const i = this.db.invites.find(x => x.code === code); if (i) i.revoked = true; this._persist(); }
    async listLog() { this._master(); return this.db.log; }
    // ---- change requests (plan A: after the lock a manager asks, the master approves) ----
    async listRequests() {
      this._guard(); const all = this.db.requests || [];
      return (this.user.role === 'master' ? all : all.filter(r => r.requested_by === this.user.id)).slice().sort((a, b) => b.id - a.id);
    }
    async createRequest(req) {
      this._guard(); const ev = req.kind === 'create' ? null : this.db.events.find(x => x.id === req.event_id);
      checkRequest(this.user, ev, req);
      this.db.requests = this.db.requests || [];
      const row = { id: ++this.db.seq, event_id: ev ? ev.id : null, kind: req.kind, changes: req.kind === 'delete' ? {} : req.changes, before_row: ev ? { ...ev } : null, reason: (req.reason || '').trim(),
        status: 'pending', requested_by: this.user.id, requested_at: new Date().toISOString(), decided_by: null, decided_at: null, comment: null };
      this.db.requests.push(row); this._persist(); return row;
    }
    async decideRequest(id, approve, comment) {
      this._master(); const r = (this.db.requests || []).find(x => x.id === id);
      if (!r || r.status !== 'pending') throw new AppError('이미 처리된 요청입니다.');
      if (approve && r.kind === 'create') {
        const row = await this.saveEvent({ ...r.changes, _owner: r.requested_by }); this.db.log[0].note = `요청 #${r.id} 승인`; r.event_id = row.id;
      } else if (approve) {
        const ev = this.db.events.find(x => x.id === r.event_id); if (!ev) throw new AppError('일정이 이미 삭제되어 반영할 수 없습니다. 반려해 주세요.');
        if (r.kind === 'delete') { this.db.events = this.db.events.filter(x => x.id !== ev.id); this._log('delete', ev, null); this.db.log[0].note = `요청 #${r.id} 승인`; }
        else { await this.saveEvent({ ...ev, ...r.changes }); this.db.log[0].note = `요청 #${r.id} 승인`; }
      }
      Object.assign(r, { status: approve ? 'approved' : 'rejected', decided_by: this.user.id, decided_at: new Date().toISOString(), comment: (comment || '').trim() || null });
      this._persist(); return r;
    }
    reset() { localStorage.removeItem(this.K); this._load(); }
  }

  // fields a request may change, and the request rules shared by both backends
  const REQ_FIELDS = ['channel_code', 'channel_detail', 'title', 'product_code', 'start_date', 'end_date', 'list_price', 'sale_price', 'pack_qty', 'expected_qty', 'memo'];
  // channels whose name ends with 기타 (기타, C4.H기타, G9.E2기타 …) need a free-text detail name
  const isEtc = name => /기타$/.test(String(name || '').trim());
  // managers: new-event requests any time; change/delete requests on events in their assigned channels, or events they registered
  const canRequest = (user, ev) => !!user && user.role === 'manager' && (!ev || ev.created_by === user.id || (user.channels || []).includes(ev.channel_code));
  function checkRequest(user, ev, req) {
    if (!user || user.role !== 'manager') throw new AppError('요청은 담당자만 보낼 수 있습니다. 마스터는 직접 등록·수정하면 됩니다.', 403);
    if (req.kind === 'create') {
      validate(req.changes || {});
      const mine = user.channels || [];
      if (mine.length && !mine.includes(req.changes.channel_code)) throw new AppError('본인 담당 채널만 등록 요청할 수 있습니다: ' + mine.join(', '));
      return;
    }
    if (!ev) throw new AppError('일정을 찾지 못했습니다.');
    if (!canRequest(user, ev)) throw new AppError('수정·삭제 요청은 본인 담당 채널의 행사(또는 본인이 등록한 행사)에만 할 수 있습니다.', 403);
    if (!req.reason || !req.reason.trim()) throw new AppError('요청 사유를 적어 주세요.');
    if (req.kind === 'update') {
      const keys = Object.keys(req.changes || {}).filter(k => REQ_FIELDS.includes(k));
      if (!keys.length) throw new AppError('바뀐 내용이 없습니다. 고칠 값을 바꿔 주세요.');
      validate({ ...ev, ...req.changes });
    } else if (req.kind !== 'delete') throw new AppError('요청 종류가 맞지 않습니다.');
  }
  // Supabase versions (table edit_requests + decide_request RPC, see setup.sql)
  Object.assign(SupabaseBackend.prototype, {
    listRequests() { return this._rest('edit_requests?select=*&order=id.desc&limit=300'); },
    async createRequest(req) {
      const evs = req.kind === 'create' ? [null] : await this._rest('events?select=*&id=eq.' + req.event_id); checkRequest(this.user, evs && evs[0], req);
      const r = await this._rest('edit_requests', { method: 'POST', body: { event_id: req.kind === 'create' ? null : req.event_id, kind: req.kind, changes: req.kind === 'delete' ? {} : req.changes, reason: (req.reason || '').trim() || '신규 등록' } });
      return r[0];
    },
    async decideRequest(id, approve, comment) { return this._rest('rpc/decide_request', { method: 'POST', body: { p_id: id, p_approve: !!approve, p_comment: comment || null } }); },
  });

  window.Cal = { SupabaseBackend, DemoBackend, AppError, lockAt, isLocked, canEdit, canCreate, canRequest, REQ_FIELDS, isEtc, todayKst, discount };
})();
