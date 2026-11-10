// xlsx writer (no library) — copied from data-window page
(function () {
  const colName = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - m - 1) / 26; } return s; };
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (b, c = 0xffffffff) => { for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return c; };
  async function deflate(blob) {
    if (!('CompressionStream' in window)) return null;
    try { return new Blob([await new Response(blob.stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()]); }
    catch (e) { return null; }
  }
  async function zip(entries) {   // entries: [{name, data: string or array of strings}]
    const enc = new TextEncoder(), out = [], dir = []; let off = 0;
    const u16 = v => [v & 255, (v >>> 8) & 255], u32 = v => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
    for (const e of entries) {
      const parts = (Array.isArray(e.data) ? e.data : [e.data]).map(s => enc.encode(s));
      let c = 0xffffffff, rawLen = 0;
      for (const p of parts) { c = crc32(p, c); rawLen += p.length; }
      const crc = (c ^ 0xffffffff) >>> 0, raw = new Blob(parts); parts.length = 0;
      const z = await deflate(raw), name = enc.encode(e.name);
      const method = z ? 8 : 0, body = z || raw;
      const common = [...u16(20), ...u16(0x0800), ...u16(method), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(body.size), ...u32(rawLen), ...u16(name.length), ...u16(0)];
      const head = new Uint8Array([...u32(0x04034b50), ...common]);
      out.push(head, name, body);
      dir.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), name);
      off += head.length + name.length + body.size;
    }
    const dirLen = dir.reduce((s, b) => s + b.length, 0);
    const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(dirLen), ...u32(off), ...u16(0)]);
    return new Blob([...out, ...dir, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const xesc = s => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // styles: 0 plain, 1 bold header, 2 percent, 3 wrapped text, 4 thousands
  function cellXml(ref, v, style) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${v}</v></c>`;
    const s = String(v).trim();
    if (!style && /^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?%$/.test(s)) return `<c r="${ref}" s="2"><v>${+(parseFloat(s.replace(/,/g, '')) / 100).toPrecision(12)}</v></c>`;
    if (!style && /^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$/.test(s) && !/^-?0\d/.test(s) && s.replace(/[-,.]/g, '').length <= 15)
      return `<c r="${ref}"${s.includes(',') ? ' s="4"' : ''}><v>${+s.replace(/,/g, '')}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xesc(v)}</t></is></c>`;
  }
  // sheet: {name, rows: [[...]], header: bool (bold first row), wrap: [column indexes], widths?: [..]}
  function sheetXml(sh) {
    const cols = sh.rows.reduce((m, r) => Math.max(m, r.length), 0), w = [];
    for (let c = 0; c < cols; c++) {
      let m = 6; for (let r = 0; r < Math.min(sh.rows.length, 2000); r++) { const v = String(sh.rows[r][c] ?? ''); let n = 0; for (const ch of v.split('\n')[0]) n += ch.charCodeAt(0) > 0x2e80 ? 2 : 1; m = Math.max(m, n); }
      w.push(sh.widths && sh.widths[c] || Math.min(60, m + 2));
    }
    const out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      (sh.header ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '') +
      (cols ? '<cols>' + w.map((x, i) => `<col min="${i + 1}" max="${i + 1}" width="${x}" customWidth="1"/>`).join('') + '</cols>' : '') + '<sheetData>'];
    const names = Array.from({ length: cols }, (_, i) => colName(i));
    for (let s = 0; s < sh.rows.length; s += 5000) {   // pieces, so a big sheet is never one huge string
      let piece = '';
      for (let ri = s; ri < Math.min(s + 5000, sh.rows.length); ri++) piece += `<row r="${ri + 1}">` + sh.rows[ri].map((v, ci) => cellXml(names[ci] + (ri + 1), v,
        sh.header && ri === 0 ? 1 : (sh.wrap || []).includes(ci) ? 3 : 0)).join('') + '</row>';
      out.push(piece);
    }
    out.push('</sheetData></worksheet>');
    return out;
  }
  async function buildXlsx(sheets) {
    const used = new Set();
    const names = sheets.map(s => { let n = s.name.replace(/[\[\]:*?\/\\]/g, ' ').slice(0, 31), k = 2; while (used.has(n)) n = s.name.slice(0, 28) + ' ' + k++; used.add(n); return n; });
    const ns = 'http://schemas.openxmlformats.org/', hdr = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
    return zip([
      { name: '[Content_Types].xml', data: hdr + `<Types xmlns="${ns}package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '</Types>' },
      { name: '_rels/.rels', data: hdr + `<Relationships xmlns="${ns}package/2006/relationships"><Relationship Id="rId1" Type="${ns}officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', data: hdr + `<workbook xmlns="${ns}spreadsheetml/2006/main" xmlns:r="${ns}officeDocument/2006/relationships"><sheets>` +
        names.map((n, i) => `<sheet name="${xesc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: hdr + `<Relationships xmlns="${ns}package/2006/relationships">` +
        sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="${ns}officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="${ns}officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: hdr + `<styleSheet xmlns="${ns}spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="0.0%"/></numFmts>` +
        '<fonts count="2"><font><sz val="10"/><name val="맑은 고딕"/><family val="3"/></font><font><b/><sz val="10"/><name val="맑은 고딕"/><family val="3"/></font></fonts>' +
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3E9E6"/></patternFill></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
        '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>' },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
    ]);
  }
  window.buildXlsx = buildXlsx;
})();
