/**
 * gas-harness.js — Mock runtime Google Apps Script untuk pengujian lokal (Node.js).
 *
 * Memuat seluruh file .gs dari ../src ke satu konteks V8 (sama seperti Apps Script
 * memuat semua file ke satu global scope) dan menyediakan tiruan:
 * SpreadsheetApp, CacheService, PropertiesService, LockService, Utilities, DriveApp,
 * HtmlService, Logger, ContentService, Session.
 *
 * Data uji: JSON {namaSheet: [[baris]...]} — hasil ekspor workbook (tidak di-commit).
 *   tanggal ditulis sebagai {"__date": "2026-11-07T00:00:00"}.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const SRC = path.join(__dirname, '..', 'src');
const TZ = 'Asia/Jakarta';

function reviveValue(v) {
  if (v && typeof v === 'object' && v.__date) {
    // Nilai tanggal dari Sheets = waktu lokal spreadsheet (Asia/Jakarta, UTC+7)
    return new Date(v.__date + '+07:00');
  }
  return v;
}

/** Tiru parsing nilai string oleh Sheets saat setValues/appendRow. */
function sheetParse(v) {
  if (typeof v !== 'string') return v;
  if (v.startsWith("'")) return v.slice(1);
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}+07:00`);
  if (/^-?\d+(\.\d+)?$/.test(v) && v.length < 15) return Number(v);
  if (v === 'TRUE') return true;
  if (v === 'FALSE') return false;
  return v;
}

class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr: nr || 1, nc: nc || 1 }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = this.sheet.data[this.r - 1 + i] || [];
      const o = [];
      for (let j = 0; j < this.nc; j++) { const v = row[this.c - 1 + j]; o.push(v === undefined || v === null ? '' : v); }
      out.push(o);
    }
    this.sheet.ss.stats.reads++;
    return out;
  }
  getValue() { return this.getValues()[0][0]; }
  getFormulas() { return this.getValues().map(r => r.map(() => '')); }
  setValues(vals) {
    if (vals.length !== this.nr || vals[0].length !== this.nc) throw new Error(`Range size mismatch ${vals.length}x${vals[0].length} vs ${this.nr}x${this.nc}`);
    for (let i = 0; i < this.nr; i++) {
      const ri = this.r - 1 + i;
      while (this.sheet.data.length <= ri) this.sheet.data.push([]);
      for (let j = 0; j < this.nc; j++) this.sheet.data[ri][this.c - 1 + j] = sheetParse(vals[i][j]);
    }
    this.sheet.ss.stats.writes++;
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setBackground() { return this; } setFontColor() { return this; } setFontWeight() { return this; }
  setFontSize() { return this; } setWrap() { return this; } createFilter() { return this; }
}

class Sheet {
  constructor(ss, name, data) { this.ss = ss; this.name = name; this.data = (data || []).map(r => r.map(reviveValue)); }
  getName() { return this.name; }
  getLastRow() {
    for (let i = this.data.length - 1; i >= 0; i--) if ((this.data[i] || []).some(v => v !== '' && v !== null && v !== undefined)) return i + 1;
    return 0;
  }
  getLastColumn() {
    let m = 0;
    this.data.forEach(r => { for (let j = (r || []).length - 1; j >= 0; j--) if (r[j] !== '' && r[j] !== null && r[j] !== undefined) { m = Math.max(m, j + 1); break; } });
    return m;
  }
  getMaxRows() { return Math.max(1000, this.data.length); }
  getRange(r, c, nr, nc) {
    if (typeof r === 'string') throw new Error('A1 notation not supported in mock');
    if (r < 1 || c < 1 || (nr !== undefined && nr < 1) || (nc !== undefined && nc < 1)) throw new Error(`Invalid range ${r},${c},${nr},${nc}`);
    return new Range(this, r, c, nr, nc);
  }
  appendRow(row) { const r = this.getLastRow() + 1; new Range(this, r, 1, 1, row.length).setValues([row]); return this; }
  deleteRow(i) { this.data.splice(i - 1, 1); return this; }
  setFrozenRows() {} autoResizeColumns() {} getFilter() { return null; }
  clear() { this.data = []; return this; }
}

class Spreadsheet {
  constructor(json) {
    this.stats = { reads: 0, writes: 0 };
    this.sheets = Object.keys(json).map(n => new Sheet(this, n, json[n]));
  }
  getId() { return 'SS_TEST'; } getUrl() { return 'https://docs.google.com/spreadsheets/d/SS_TEST'; }
  getSheets() { return this.sheets.slice(); }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }   // GAS: case-sensitive (asumsi terburuk)
  insertSheet(n) {
    if (this.sheets.some(s => s.name.toLowerCase() === n.toLowerCase())) throw new Error('A sheet with the name "' + n + '" already exists.');
    const s = new Sheet(this, n, []); this.sheets.push(s); return s;
  }
}

function createGas(dataJson, opts) {
  opts = opts || {};
  const ss = new Spreadsheet(JSON.parse(JSON.stringify(dataJson)));
  const cacheStore = new Map(); // key -> {v, exp}
  const props = {};
  const logs = [];
  const drive = new Map();
  let now = opts.now ? new Date(opts.now) : null;

  const cache = {
    get(k) { const e = cacheStore.get(k); if (!e) return null; if (e.exp < Date.now()) { cacheStore.delete(k); return null; } return e.v; },
    put(k, v, ttl) {
      if (typeof v !== 'string') throw new Error('Cache value must be string');
      if (v.length > 100 * 1024) throw new Error('Argument too large: value');
      if (k.length > 250) throw new Error('Key too long');
      cacheStore.set(k, { v, exp: Date.now() + (ttl || 600) * 1000 });
    },
    putAll(o, ttl) { Object.keys(o).forEach(k => cache.put(k, o[k], ttl)); },
    getAll(keys) { const r = {}; keys.forEach(k => { const v = cache.get(k); if (v !== null) r[k] = v; }); return r; },
    remove(k) { cacheStore.delete(k); },
    removeAll(keys) { keys.forEach(k => cacheStore.delete(k)); }
  };
  let lockHeld = false;
  const lock = {
    tryLock() { if (lockHeld) throw new Error('Nested lock detected (mock)'); lockHeld = true; return true; },
    waitLock() { if (lockHeld) throw new Error('Nested lock detected (mock)'); lockHeld = true; },
    releaseLock() { lockHeld = false; }, hasLock() { return lockHeld; }
  };

  function formatDate(d, tz, fmt) {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz || TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(d);
    const g = t => parts.find(p => p.type === t).value;
    return fmt.replace('yyyy', g('year')).replace('MM', g('month')).replace('dd', g('day'))
      .replace('HH', g('hour')).replace('mm', g('minute')).replace('ss', g('second'));
  }

  const RealDate = Date;
  class MockDate extends RealDate {
    constructor(...a) { if (a.length === 0 && now) super(now.getTime()); else super(...a); }
    static now() { return now ? now.getTime() : RealDate.now(); }
    static [Symbol.hasInstance](v) { return v instanceof RealDate; }
  }

  const ctx = {
    console, JSON, Math, Object, Array, String, Number, Boolean, RegExp, Error, Set, Map, Intl, isFinite, isNaN, parseInt, parseFloat,
    Date: MockDate,
    Logger: { log: (...a) => { logs.push(a.map(String).join(' ')); } },
    Session: { getScriptTimeZone: () => TZ },
    SpreadsheetApp: {
      openById: () => ss, getActiveSpreadsheet: () => ss, flush() {},
      getUi() { throw new Error('No UI in this context'); }
    },
    CacheService: { getScriptCache: () => cache, getUserCache: () => cache },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); },
      setProperties: o => { Object.keys(o).forEach(k => { props[k] = String(o[k]); }); }, getProperties: () => Object.assign({}, props),
      deleteProperty: k => { delete props[k]; } }) },
    LockService: { getScriptLock: () => lock },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      formatDate,
      base64Decode: s => { const b = Buffer.from(String(s), 'base64'); if (!b.length && s) throw new Error('bad'); return Array.from(b).map(x => (x > 127 ? x - 256 : x)); },
      base64Encode: bytes => Buffer.from(bytes.map(b => (b < 0 ? b + 256 : b))).toString('base64'),
      newBlob: (bytes, type, name) => ({ bytes, type, name, getBytes: () => bytes, getName: () => name }),
      sleep() {}
    },
    DriveApp: {
      Access: { ANYONE_WITH_LINK: 'ANYONE_WITH_LINK', PRIVATE: 'PRIVATE' }, Permission: { VIEW: 'VIEW', NONE: 'NONE' },
      getFolderById: id => { if (!drive.has('folder')) throw new Error('nf'); return drive.get('folder'); },
      getFoldersByName: () => ({ hasNext: () => drive.has('folder'), next: () => drive.get('folder') }),
      createFolder: name => { const f = { name, getId: () => 'FOLDER1', getName: () => name,
        createFile: blob => { const id = 'FILE' + (drive.size + 1); const file = { id, blob, sharing: 'PRIVATE', getId: () => id,
          getUrl: () => 'https://drive.google.com/file/d/' + id, getBlob: () => blob, getSharingAccess: () => file.sharing,
          setSharing: (a) => { file.sharing = a; } }; drive.set(id, file); return file; } };
        drive.set('folder', f); return f; },
      getFileById: id => { const f = drive.get(id); if (!f) throw new Error('File not found'); return f; }
    },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' },
      createHtmlOutputFromFile: n => ({ getContent: () => fs.readFileSync(path.join(SRC, n + '.html'), 'utf8') }),
      createTemplateFromFile: n => ({ evaluate: () => ({ setTitle() { return this; }, addMetaTag() { return this; }, setXFrameOptionsMode() { return this; } }) })
    },
    ContentService: { createTextOutput: s => ({ setMimeType() { return s; } }), MimeType: { JSON: 'json' } }
  };
  vm.createContext(ctx);
  const files = fs.readdirSync(SRC).filter(f => f.endsWith('.gs')).sort();
  // Apps Script memuat file sebagai script terpisah di global yang sama → duplikasi const akan error (sama seperti GAS).
  files.forEach(f => vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f }));

  return {
    ctx, ss, props, logs, drive, cacheStore,
    setNow: d => { now = d ? new RealDate(d) : null; },
    /** Panggil fungsi global seperti google.script.run (memo eksekusi di-reset per panggilan). */
    run(fn, ...args) {
      vm.runInContext('_EXEC = { ss: null, sheets: {}, tables: {}, cols: {}, headers: {} }; _VERSIONS = null;', ctx);
      if (lockHeld) throw new Error('Lock leaked from previous call');
      const res = ctx[fn](...JSON.parse(JSON.stringify(args)));
      if (lockHeld) throw new Error('Lock not released by ' + fn);
      return JSON.parse(JSON.stringify(res === undefined ? null : res));
    },
    sheet: n => ss.getSheetByName(n)
  };
}

module.exports = { createGas };
