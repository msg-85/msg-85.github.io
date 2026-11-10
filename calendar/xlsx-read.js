// Minimal .xlsx / .csv reader (no library). readTable(file) -> array of rows (array of cell values).
// Numbers come back as numbers (dates stay Excel serials; the caller converts), text as strings.
(function () {
  async function inflate(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer());
  }
  async function unzip(buf) {
    const b = new Uint8Array(buf), dv = new DataView(buf), files = {};
    let eocd = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('엑셀(.xlsx) 파일이 아닙니다.');
    const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    for (let k = 0; k < n; k++) {
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
      files[name] = { method, csize, off };
      p += 46 + nlen + elen + clen;
    }
    return {
      has: name => name in files,
      async text(name) {
        const f = files[name]; if (!f) return null;
        const lnlen = dv.getUint16(f.off + 26, true), lelen = dv.getUint16(f.off + 28, true);
        const start = f.off + 30 + lnlen + lelen, raw = b.subarray(start, start + f.csize);
        return dec.decode(f.method === 8 ? await inflate(raw) : raw);
      },
    };
  }
  const colIndex = ref => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  async function readXlsx(buf) {
    const z = await unzip(buf), P = new DOMParser();
    const ssText = await z.text('xl/sharedStrings.xml'), ss = [];
    if (ssText) for (const si of P.parseFromString(ssText, 'application/xml').getElementsByTagName('si'))
      ss.push([...si.getElementsByTagName('t')].map(t => t.textContent).join(''));
    // first sheet in workbook order
    let target = 'xl/worksheets/sheet1.xml';
    const wb = await z.text('xl/workbook.xml'), rels = await z.text('xl/_rels/workbook.xml.rels');
    if (wb && rels) {
      const first = P.parseFromString(wb, 'application/xml').getElementsByTagName('sheet')[0];
      const rid = first && (first.getAttribute('r:id') || first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
      for (const r of P.parseFromString(rels, 'application/xml').getElementsByTagName('Relationship'))
        if (r.getAttribute('Id') === rid) { const t = r.getAttribute('Target'); target = t.startsWith('/') ? t.slice(1) : 'xl/' + t; }
    }
    const sx = await z.text(target); if (!sx) throw new Error('시트를 찾지 못했습니다.');
    const doc = P.parseFromString(sx, 'application/xml'), rows = [];
    for (const row of doc.getElementsByTagName('row')) {
      const ri = (+row.getAttribute('r') || rows.length + 1) - 1, arr = [];
      for (const c of row.getElementsByTagName('c')) {
        const t = c.getAttribute('t'), ref = c.getAttribute('r'), v = c.getElementsByTagName('v')[0];
        let val = '';
        if (t === 's') val = ss[+v.textContent] ?? '';
        else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map(x => x.textContent).join('');
        else if (t === 'str' || t === 'b' || t === 'e') val = v ? v.textContent : '';
        else if (v) val = +v.textContent;
        arr[ref ? colIndex(ref) : arr.length] = val;
      }
      rows[ri] = Array.from(arr, x => x ?? '');
    }
    return Array.from(rows, r => r || []);
  }
  function readCsv(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
      else if (ch === '"') q = true;
      else if (ch === ',' || ch === '\t') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.map(r => r.map(v => (/^-?\d+(\.\d+)?$/.test(v.trim()) ? +v : v.trim())));
  }
  window.readTable = async function (file) {
    const buf = await file.arrayBuffer();
    if (/\.(csv|txt|tsv)$/i.test(file.name)) return readCsv(new TextDecoder().decode(buf).replace(/^﻿/, ''));
    return readXlsx(buf);
  };
})();
