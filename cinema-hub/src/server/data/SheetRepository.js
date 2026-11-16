/**
 * CINEMA HUB — Repository generik di atas Google Sheets.
 *
 * Antarmuka (dapat diimplementasikan ulang untuk Firestore / Cloud SQL tanpa mengubah service):
 *   all() · find(pred) · findOne(pred) · findById(id) · findFresh(column, value)
 *   insertMany(records, ctx) · insert(record, ctx) · append(record)
 *   update(id, patch, ctx, opts) · updateWhere(pred, patchFn, ctx) · recent(n)
 *
 * Prinsip:
 *   - Baca: satu getValues() per tabel, di-cache berversi (CacheService) + memo per eksekusi.
 *   - Tulis: di dalam LockService, membaca ulang data segar, satu setValues() per operasi.
 *   - Objek hasil all() bersifat read-only (dipakai bersama dalam satu eksekusi).
 */
const Repo = (() => {
  const instances = {};

  function actorId(ctx) {
    return ctx && ctx.user && ctx.user.user_id ? ctx.user.user_id : CH.SYSTEM_ACTOR;
  }

  function defaultFor(type) {
    switch (type) {
      case 'int': case 'number': return null;
      case 'bool': return false;
      case 'json': return null;
      default: return '';
    }
  }

  function serialize(type, v) {
    if (v === undefined || v === null) return '';
    switch (type) {
      case 'int':
      case 'number': {
        if (v === '') return '';
        const n = Number(v);
        return isNaN(n) ? '' : n;
      }
      case 'bool':
        return v === true || v === 'TRUE' || v === 'true';
      case 'json':
        return Sanitize.forSheet(typeof v === 'string' ? v : JSON.stringify(v));
      case 'csv':
        return Sanitize.forSheet(Array.isArray(v) ? v.join(',') : String(v));
      default:
        return Sanitize.forSheet(String(v));
    }
  }

  function deserialize(type, raw) {
    let v = raw;
    if (v instanceof Date) {
      if (type === 'date') return Utils.fmt(v, 'yyyy-MM-dd');
      if (type === 'time') return Utils.fmt(v, 'HH:mm');
      return Utils.fmt(v, "yyyy-MM-dd'T'HH:mm:ssXXX");
    }
    v = Sanitize.fromSheet(v);
    switch (type) {
      case 'int':
      case 'number': {
        if (v === '' || v === null || v === undefined) return null;
        const n = Number(v);
        return isNaN(n) ? null : (type === 'int' ? Math.round(n) : n);
      }
      case 'bool':
        return v === true || String(v).toUpperCase() === 'TRUE';
      case 'json':
        if (v === '' || v === null || v === undefined) return null;
        try { return JSON.parse(String(v)); } catch (e) { return null; }
      case 'time': {
        if (typeof v === 'number') { // fraksi hari dari Sheets
          const total = Math.round(v * 1440) % 1440;
          return ('0' + Math.floor(total / 60)).slice(-2) + ':' + ('0' + (total % 60)).slice(-2);
        }
        return v === null || v === undefined ? '' : String(v);
      }
      default:
        return v === null || v === undefined ? '' : String(v);
    }
  }

  function create(name) {
    const def = Schema.get(name);
    const types = {};
    def.columns.forEach((c) => { types[c.name] = c.type; });

    function sheet() { return Database.sheet(name); }

    function headers(sh) {
      return Scope.get('repo:hdr:' + name, () => {
        const lastCol = sh.getLastColumn();
        if (!lastCol) throw Errors.create('NOT_INSTALLED', 'Header tabel ' + name + ' tidak ditemukan.');
        return sh.getRange(1, 1, 1, lastCol).getValues()[0].map((h) => String(h).trim());
      });
    }

    function decodeRow(hdr, row) {
      return hdr.map((h, i) => (h && types[h] !== undefined ? deserialize(types[h], row[i]) : row[i]));
    }

    function readRaw() {
      const sh = sheet();
      const hdr = headers(sh);
      const lastRow = sh.getLastRow();
      if (lastRow < 2) return { h: hdr, r: [] };
      const values = sh.getRange(2, 1, lastRow - 1, hdr.length).getValues();
      return { h: hdr, r: values.map((row) => decodeRow(hdr, row)) };
    }

    function snapshot() {
      return Scope.get('repo:snap:' + name, () => {
        if (!def.cache) return readRaw();
        const key = 't:' + name + ':' + Cache.version(name);
        let snap = Cache.getJson(key);
        if (!snap) {
          snap = readRaw();
          Cache.putJson(key, snap);
        }
        return snap;
      });
    }

    function materialize(hdr, row, rowNum) {
      const o = {};
      hdr.forEach((h, i) => { if (h) o[h] = row[i]; });
      def.columns.forEach((c) => {
        if (!Object.prototype.hasOwnProperty.call(o, c.name)) o[c.name] = defaultFor(c.type);
      });
      Object.defineProperty(o, '__row', { value: rowNum, enumerable: false });
      return o;
    }

    function all() {
      return Scope.get('repo:all:' + name, () => {
        const snap = snapshot();
        const keyIdx = snap.h.indexOf(def.key);
        const out = [];
        snap.r.forEach((row, i) => {
          if (keyIdx < 0 || row[keyIdx] === '' || row[keyIdx] === null) return;
          out.push(materialize(snap.h, row, i + 2));
        });
        return out;
      });
    }

    function find(pred) { return all().filter(pred); }
    function findOne(pred) { return all().find(pred) || null; }

    function findById(id) {
      if (id === null || id === undefined || id === '') return null;
      const index = Scope.get('repo:idx:' + name, () => {
        const m = {};
        all().forEach((o) => { m[o[def.key]] = o; });
        return m;
      });
      return Object.prototype.hasOwnProperty.call(index, id) ? index[id] : null;
    }

    function invalidate() {
      Scope.clear('repo:snap:' + name);
      Scope.clear('repo:all:' + name);
      Scope.clear('repo:idx:' + name);
      if (def.cache) Cache.bump(name);
    }

    function columnIndex(hdr, column) {
      const i = hdr.indexOf(column);
      if (i < 0) throw new Error('Kolom ' + column + ' tidak ada di ' + name);
      return i;
    }

    /** Membaca satu kolom segar dari sheet (tanpa cache). */
    function readColumn(sh, hdr, column) {
      const lastRow = sh.getLastRow();
      if (lastRow < 2) return [];
      const col = columnIndex(hdr, column) + 1;
      return sh.getRange(2, col, lastRow - 1, 1).getValues().map((r) => Sanitize.fromSheet(r[0]));
    }

    function readRow(sh, hdr, rowNum) {
      const raw = sh.getRange(rowNum, 1, 1, hdr.length).getValues()[0];
      return { raw, obj: materialize(hdr, decodeRow(hdr, raw), rowNum) };
    }

    /** Cari baris pertama dengan nilai kolom tertentu, langsung dari sheet. */
    function findFresh(column, value) {
      const sh = sheet();
      const hdr = headers(sh);
      const values = readColumn(sh, hdr, column);
      const idx = values.findIndex((v) => String(v) === String(value));
      if (idx < 0) return null;
      return readRow(sh, hdr, idx + 2).obj;
    }

    function stamp(o, ctx, isNew) {
      if (!def.audit) return o;
      const now = Utils.nowIso();
      const actor = actorId(ctx);
      if (isNew) {
        o.status = o.status || def.defaultStatus;
        o.created_at = now;
        o.created_by = actor;
        o.row_version = 1;
      }
      o.updated_at = now;
      o.updated_by = actor;
      return o;
    }

    function toRow(hdr, o) {
      return hdr.map((h) => (h && types[h] !== undefined ? serialize(types[h], o[h]) : ''));
    }

    function insertMany(records, ctx) {
      if (!records || !records.length) return [];
      return Lock.run(() => {
        const sh = sheet();
        const hdr = headers(sh);
        const keys = {};
        readColumn(sh, hdr, def.key).forEach((k) => { if (k !== '') keys[String(k)] = true; });
        const prepared = records.map((r) => {
          const o = Object.assign({}, r);
          if (o[def.key] === undefined || o[def.key] === null || o[def.key] === '') {
            if (!def.prefix) throw Errors.create('BAD_REQUEST', 'ID wajib diisi untuk ' + def.label + '.');
            do { o[def.key] = Utils.newId(def.prefix); } while (keys[o[def.key]]);
          } else if (keys[String(o[def.key])]) {
            throw Errors.create('DUPLICATE', def.label + ' dengan ID ' + o[def.key] + ' sudah ada.');
          }
          keys[String(o[def.key])] = true;
          if (!def.audit && !o.status && types.status !== undefined) o.status = def.defaultStatus;
          return stamp(o, ctx, true);
        });
        const rows = prepared.map((o) => toRow(hdr, o));
        const start = sh.getLastRow() + 1;
        Database.ensureRows(sh, start + rows.length - 1);
        sh.getRange(start, 1, rows.length, hdr.length).setValues(rows);
        invalidate();
        return prepared;
      });
    }

    function insert(record, ctx) {
      return insertMany([record], ctx)[0];
    }

    /** Tambah satu baris secara atomik tanpa lock (khusus tabel log append-only). */
    function append(record) {
      const sh = sheet();
      const hdr = headers(sh);
      const o = Object.assign({}, record);
      if (!o[def.key]) o[def.key] = Utils.newId(def.prefix || 'ROW');
      sh.appendRow(toRow(hdr, o));
      invalidate();
      return o;
    }

    function update(id, patch, ctx, opts) {
      const options = opts || {};
      return Lock.run(() => {
        const sh = sheet();
        const hdr = headers(sh);
        const keyValues = readColumn(sh, hdr, def.key);
        const idx = keyValues.findIndex((v) => String(v) === String(id));
        if (idx < 0) throw Errors.create('NOT_FOUND', def.label + ' tidak ditemukan.');
        const rowNum = idx + 2;
        const current = readRow(sh, hdr, rowNum);
        if (def.audit && options.expectedVersion !== undefined && options.expectedVersion !== null &&
          Number(current.obj.row_version) !== Number(options.expectedVersion)) {
          throw Errors.create('CONFLICT');
        }
        const next = Object.assign({}, current.obj, patch);
        next[def.key] = current.obj[def.key];
        if (def.audit) {
          next.created_at = current.obj.created_at;
          next.created_by = current.obj.created_by;
          next.row_version = (Number(current.obj.row_version) || 0) + 1;
          stamp(next, ctx, false);
        }
        const row = hdr.map((h, i) => (h && types[h] !== undefined ? serialize(types[h], next[h]) : current.raw[i]));
        sh.getRange(rowNum, 1, 1, hdr.length).setValues([row]);
        invalidate();
        return next;
      });
    }

    /**
     * Update massal: baca seluruh tabel segar, terapkan patchFn pada baris yang cocok,
     * tulis kembali dalam satu setValues(). Mengembalikan jumlah baris yang berubah.
     */
    function updateWhere(pred, patchFn, ctx) {
      return Lock.run(() => {
        const sh = sheet();
        const hdr = headers(sh);
        const lastRow = sh.getLastRow();
        if (lastRow < 2) return 0;
        const raw = sh.getRange(2, 1, lastRow - 1, hdr.length).getValues();
        let changed = 0;
        const out = raw.map((r, i) => {
          const obj = materialize(hdr, decodeRow(hdr, r), i + 2);
          if (!obj[def.key] || !pred(obj)) return r;
          const patch = patchFn(obj);
          if (!patch) return r;
          const next = Object.assign({}, obj, patch);
          if (def.audit) {
            next.row_version = (Number(obj.row_version) || 0) + 1;
            stamp(next, ctx, false);
          }
          changed++;
          return hdr.map((h, j) => (h && types[h] !== undefined ? serialize(types[h], next[h]) : r[j]));
        });
        if (changed) {
          sh.getRange(2, 1, out.length, hdr.length).setValues(out);
          invalidate();
        }
        return changed;
      });
    }

    /** N baris terakhir (terbaru dahulu) — untuk tabel log besar tanpa membaca seluruh sheet. */
    function recent(n, offset) {
      const sh = sheet();
      const hdr = headers(sh);
      const lastRow = sh.getLastRow();
      const total = Math.max(lastRow - 1, 0);
      const skip = offset || 0;
      const end = lastRow - skip;
      const count = Math.min(n, end - 1);
      if (count <= 0) return { items: [], total };
      const start = end - count + 1;
      const values = sh.getRange(start, 1, count, hdr.length).getValues();
      const items = values.map((r, i) => materialize(hdr, decodeRow(hdr, r), start + i)).reverse();
      return { items, total };
    }

    function count() { return all().length; }

    return { def, all, find, findOne, findById, findFresh, insert, insertMany, append, update, updateWhere, recent, count, invalidate };
  }

  function table(name) {
    if (!instances[name]) instances[name] = create(name);
    return instances[name];
  }

  return { table, serialize, deserialize };
})();
