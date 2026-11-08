/**
 * CleaningService.gs
 * Cleaning Compliance Monitoring (Cuci Kursi / Cuci Karpet) per Class outlet.
 * @version 2.0.0
 *
 * Business logic (PRD §7.4, tidak diubah dari v1 kecuali perbaikan bug):
 *   NextDue       = TanggalCleaningTerakhir + IntervalBulan(Class, Jenis)
 *   SisaHari      = NextDue − TanggalAcuan(OR date / hari ini)
 *   Status        = OVERDUE (sisa < 0) | WARNING (sisa ≤ warning_threshold_days) | OK
 *                   No History  : belum ada transaksi
 *                   No Interval : Class outlet tidak punya interval valid di sheet INTERVAL
 *   Perhitungan per Outlet + Studio + Jenis; status outlet = status terburuk antar studio.
 *
 * Perbaikan v2:
 *   - Relasi memakai KodeOutlet (nama hanya fallback untuk data lama).
 *   - Class diambil dari master KODE (bukan salinan di transaksi).
 *   - Nilai INTERVAL non-angka (mis. tanggal) / kosong tidak lagi dianggap "OK".
 *   - Jenis "Kursi", "Karpet", "Cuci Karpet" dinormalisasi.
 *   - Seluruh view dihitung dari SATU kali baca sheet (view 'all').
 */

const CL_STATUS = Object.freeze({ OK: 'OK', WARNING: 'WARNING', OVERDUE: 'OVERDUE', NO_HISTORY: 'No History', NO_INTERVAL: 'No Interval' });
const _CL_RANK = { OVERDUE: 0, 'No Interval': 1, WARNING: 2, 'No History': 3, OK: 4 };

function _normalizeJenis(jenis) {
  const j = norm_(jenis);
  if (j.indexOf('kursi') >= 0 || j.indexOf('seat') >= 0) return 'Cuci Kursi';
  if (j.indexOf('karpet') >= 0 || j.indexOf('carpet') >= 0) return 'Cuci Karpet';
  return null;
}

function _worstStatus(a, b) {
  if (a === undefined || a === null) return b;
  return (_CL_RANK[b] !== undefined ? _CL_RANK[b] : 9) < (_CL_RANK[a] !== undefined ? _CL_RANK[a] : 9) ? b : a;
}

function _parseOrDate(orDate) {
  const d = orDate ? toDate_(orDate) : null;
  return fmtDate_(d || new Date());
}

/** Peta interval per Class: {kursi, karpet} (null bila tidak valid). */
function getIntervalMap_() {
  const map = {};
  getMasterCache_().interval.forEach(iv => {
    const k = norm_(iv.Class);
    if (!k || map[k]) return;   // baris pertama yang berlaku
    map[k] = { kursi: toPositiveNumber_(iv.BulanCuciKursi), karpet: toPositiveNumber_(iv.BulanCuciKarpet) };
  });
  return map;
}

/**
 * Seluruh transaksi cleaning ternormalisasi (cache global per versi data).
 * Selective fetching: hanya 10 kolom yang dibaca.
 */
function getCleaningTx_() {
  if (_EXEC.cleaningTx) return _EXEC.cleaningTx;
  const key = 'cl_tx_' + dataVersion_('cleaning', 'master');
  _EXEC.cleaningTx = cached_(key, CACHE_TTL_MASTER, function () {
    const rows = readColumns_('TRANSAKSI_CLEANING',
      ['IDCleaning', 'Tanggal', 'KodeOutlet', 'NamaOutlet', 'Studio', 'JenisCleaning', 'Vendor', 'Keterangan', 'TargetInterval', 'Status']);
    const out = [];
    rows.forEach(t => {
      if (norm_(t.Status) === 'deleted') return;
      const tgl = toDate_(t.Tanggal);
      if (!tgl) return;
      const o = findOutlet_(t.KodeOutlet, t.NamaOutlet);
      out.push({
        id: String(t.IDCleaning || ('ROW' + t.__rowIndex)),
        tgl: fmtDate_(tgl),
        kode: o ? o.KodeOutlet : String(t.KodeOutlet || ''),
        nama: o ? o.NamaOutlet : String(t.NamaOutlet || ''),
        studio: String(t.Studio || '').trim() || '-',
        jenis: _normalizeJenis(t.JenisCleaning),
        vendor: String(t.Vendor || ''),
        ket: String(t.Keterangan || ''),
        target: String(t.TargetInterval || ''),
        row: t.__rowIndex
      });
    });
    return out;
  });
  return _EXEC.cleaningTx;
}

/** Hitung status untuk satu transaksi terakhir. */
function _clStatus_(lastTgl, bln, orDay, warnDays) {
  if (!lastTgl) return { status: CL_STATUS.NO_HISTORY, due: null, sisa: null };
  if (!bln) return { status: CL_STATUS.NO_INTERVAL, due: null, sisa: null };
  const due = fmtDate_(addMonths_(toDate_(lastTgl), bln));
  const sisa = dayDiff_(orDay, due);
  return { status: sisa < 0 ? CL_STATUS.OVERDUE : (sisa <= warnDays ? CL_STATUS.WARNING : CL_STATUS.OK), due: due, sisa: sisa };
}

/**
 * Engine perhitungan cleaning untuk user (semua view sekaligus).
 * @returns {Object}
 */
function computeCleaning_(u, f) {
  f = f || {};
  const orDay     = _parseOrDate(f.orDate);
  const warnDays  = getConfigNum_('warning_threshold_days', 30);
  const scopeRows = getScope_(u);
  const sm        = scopeMap_(scopeRows);
  const ivMap     = getIntervalMap_();
  const tx        = getCleaningTx_().filter(t => outletInScope_(sm, t.kode, t.nama));

  // Transaksi terakhir per kode|studio|jenis + riwayat untuk rata-rata interval
  const last = {}, hist = {};
  tx.forEach(t => {
    if (!t.jenis) return;
    const k = norm_(t.kode) + '|' + norm_(t.studio) + '|' + t.jenis;
    if (!last[k] || t.tgl > last[k].tgl) last[k] = t;
    (hist[k] = hist[k] || []).push(t.tgl);
  });

  const rows = [], outlets = [];
  const summary = { totalOutlet: scopeRows.length, statusOK: 0, statusWarning: 0, statusOverdue: 0, noHistory: 0, noInterval: 0 };
  const comp = { kursi: { ok: 0, total: 0 }, karpet: { ok: 0, total: 0 } };

  scopeRows.forEach(k => {
    const iv = ivMap[norm_(k.Class)] || { kursi: null, karpet: null };
    const og = { outlet: k.NamaOutlet, kodeOutlet: k.KodeOutlet, kelas: k.Class, area: k.Area, region: k.RM,
                 intervalKursi: iv.kursi, intervalKarpet: iv.karpet };
    let outletWorst;

    ['Cuci Kursi', 'Cuci Karpet'].forEach(jenis => {
      const bln = jenis === 'Cuci Kursi' ? iv.kursi : iv.karpet;
      const prefix = norm_(k.KodeOutlet) + '|';
      const keys = Object.keys(last).filter(key => key.indexOf(prefix) === 0 && key.slice(-jenis.length) === jenis);
      let jenisWorst, lastTgl = null, minDue = null;

      if (!keys.length) {
        rows.push({ outlet: k.NamaOutlet, kodeOutlet: k.KodeOutlet, kelas: k.Class, area: k.Area, region: k.RM,
                    studio: '-', jenis: jenis, terakhir: '-', interval: bln || 0, jatuhTempo: '-', sisa: null,
                    status: CL_STATUS.NO_HISTORY, intervalValid: !!bln, vendor: '', idCleaning: '' });
        jenisWorst = CL_STATUS.NO_HISTORY;
      } else {
        keys.forEach(key => {
          const t = last[key];
          const c = _clStatus_(t.tgl, bln, orDay, warnDays);
          rows.push({ outlet: k.NamaOutlet, kodeOutlet: k.KodeOutlet, kelas: k.Class, area: k.Area, region: k.RM,
                      studio: t.studio, jenis: jenis, terakhir: t.tgl, interval: bln || 0, jatuhTempo: c.due || '-',
                      sisa: c.sisa, status: c.status, intervalValid: !!bln, vendor: t.vendor, idCleaning: t.id,
                      riwayat: hist[key].length });
          jenisWorst = _worstStatus(jenisWorst, c.status);
          if (!lastTgl || t.tgl > lastTgl) lastTgl = t.tgl;
          if (c.due && (!minDue || c.due < minDue)) minDue = c.due;
        });
      }
      const key2 = jenis === 'Cuci Kursi' ? 'Kursi' : 'Karpet';
      og['last' + key2] = lastTgl;
      og['nextDue' + key2] = minDue;
      og['status' + key2] = jenisWorst;
      const cc = jenis === 'Cuci Kursi' ? comp.kursi : comp.karpet;
      if (bln) { cc.total++; if (jenisWorst === CL_STATUS.OK || jenisWorst === CL_STATUS.WARNING) cc.ok++; }
      outletWorst = _worstStatus(outletWorst, jenisWorst);
    });

    og.status = outletWorst;
    outlets.push(og);
    if (outletWorst === CL_STATUS.OK) summary.statusOK++;
    else if (outletWorst === CL_STATUS.WARNING) summary.statusWarning++;
    else if (outletWorst === CL_STATUS.OVERDUE) summary.statusOverdue++;
    else if (outletWorst === CL_STATUS.NO_INTERVAL) summary.noInterval++;
    else summary.noHistory++;
  });
  summary.outletTanpaInterval = scopeRows.filter(k => { const iv = ivMap[norm_(k.Class)]; return !iv || !iv.kursi || !iv.karpet; }).length;
  summary.complianceKursi  = comp.kursi.total  ? round_(comp.kursi.ok  / comp.kursi.total  * 100, 1) : 0;
  summary.complianceKarpet = comp.karpet.total ? round_(comp.karpet.ok / comp.karpet.total * 100, 1) : 0;

  // Rata-rata jarak antar pencucian (hari)
  let gapSum = 0, gapN = 0;
  Object.keys(hist).forEach(k => {
    const ds = hist[k].slice().sort();
    for (let i = 1; i < ds.length; i++) { const g = dayDiff_(ds[i - 1], ds[i]); if (g > 0) { gapSum += g; gapN++; } }
  });
  summary.avgIntervalDays = gapN ? Math.round(gapSum / gapN) : null;

  rows.sort((a, b) => {
    const ra = _CL_RANK[a.status], rb = _CL_RANK[b.status];
    if (ra !== rb) return ra - rb;
    if (a.sisa !== null && b.sisa !== null && a.sisa !== b.sisa) return a.sisa - b.sisa;
    return String(a.outlet).localeCompare(String(b.outlet), 'id');
  });

  return { rows: rows, outlets: outlets, summary: summary, tx: tx, orDate: orDay, warningDays: warnDays };
}

function _clEvents_(tx) {
  return tx.map(t => ({
    tanggal: t.tgl, outlet: t.nama, kodeOutlet: t.kode, studio: t.studio,
    jenis: t.jenis || 'Tidak Dikenal', vendor: t.vendor, keterangan: t.ket,
    targetInterval: t.target, idCleaning: t.id
  })).sort((a, b) => a.tanggal.localeCompare(b.tanggal));
}

function _clMonthly_(tx) {
  const m = {};
  tx.forEach(t => {
    const ym = t.tgl.slice(0, 7);
    if (!m[ym]) m[ym] = { bulan: ym, totalKursi: 0, totalKarpet: 0, outletKursi: {}, outletKarpet: {} };
    if (t.jenis === 'Cuci Kursi') { m[ym].totalKursi++; m[ym].outletKursi[t.nama] = 1; }
    if (t.jenis === 'Cuci Karpet') { m[ym].totalKarpet++; m[ym].outletKarpet[t.nama] = 1; }
  });
  return Object.values(m).map(x => ({ bulan: x.bulan, totalKursi: x.totalKursi, totalKarpet: x.totalKarpet,
    outletKursi: Object.keys(x.outletKursi), outletKarpet: Object.keys(x.outletKarpet) })).sort((a, b) => a.bulan.localeCompare(b.bulan));
}

// ─── API: Data Cleaning ───────────────────────────────────────────────────────

/**
 * @param {Object} filters {orDate, outletFilter, statusFilter, view: table|calendar|monthly|outlet-group|all, bulan, tahun}
 */
function apiCleaning(token, filters) {
  return run_(token, function (u) {
    const f = filters || {};
    const view = String(f.view || 'table').toLowerCase();
    const c = computeCleaning_(u, f);
    const of = norm_(f.outletFilter);
    const byOutlet = r => !of || norm_(r.outlet) === of || norm_(r.kodeOutlet) === of;

    if (view === 'calendar') return { events: _clEvents_(c.tx).filter(byOutlet) };
    if (view === 'monthly')  return { monthly: _clMonthly_(c.tx) };
    if (view === 'outlet-group') return { outlets: c.outlets.filter(byOutlet) };

    let rows = c.rows.filter(byOutlet);
    if (f.statusFilter) rows = rows.filter(r => norm_(r.status) === norm_(f.statusFilter));
    if (view === 'all') {
      const ym = c.orDate.slice(0, 7);
      return {
        rows: rows, summary: c.summary, orDate: c.orDate, warningDays: c.warningDays,
        events: _clEvents_(c.tx), outlets: c.outlets, monthly: _clMonthly_(c.tx),
        comparison: _comparisonOR_(u, c.tx, Number(f.bulan || ym.slice(5, 7)), Number(f.tahun || ym.slice(0, 4)))
      };
    }
    return { rows: rows, summary: c.summary, orDate: c.orDate };
  });
}

/** Ringkasan cleaning untuk dashboard (hari ini). */
function cleaningSummary_(u) {
  return computeCleaning_(u, {}).summary;
}

// ─── Comparison OR (definisi v1 dipertahankan) ────────────────────────────────
/**
 * Target OR per outlet+jenis = TargetInterval terbesar yang diinput pada bulan tsb (default 1).
 * CATATAN: definisi "OR" belum dikunci di PRD (§9.3) → logika v1 tidak diubah.
 */
function _comparisonOR_(u, tx, bln, thn) {
  const ym = thn + '-' + String(bln).padStart(2, '0');
  const scopeRows = getScope_(u);
  const act = {}, tgt = {};
  tx.filter(t => t.tgl.indexOf(ym) === 0 && t.jenis).forEach(t => {
    const k = norm_(t.kode) + '|' + t.jenis;
    act[k] = (act[k] || 0) + 1;
    const ti = Number(t.target) || 1;
    if (!tgt[k] || ti > tgt[k]) tgt[k] = ti;
  });
  const rows = [];
  scopeRows.forEach(k => ['Cuci Kursi', 'Cuci Karpet'].forEach(jenis => {
    const key = norm_(k.KodeOutlet) + '|' + jenis;
    const actual = act[key] || 0, target = tgt[key] || 1;
    rows.push({ outlet: k.NamaOutlet, kodeOutlet: k.KodeOutlet, kelas: k.Class, jenis: jenis, actual: actual, target: target,
                selisih: actual - target, persentase: Math.round(actual / target * 100),
                keterangan: actual >= target ? 'Tercapai' : 'Belum tercapai' });
  }));
  const ta = rows.reduce((s, r) => s + r.actual, 0), tt = rows.reduce((s, r) => s + r.target, 0);
  return { bulan: bln, tahun: thn, rows: rows,
           summary: { totalActual: ta, totalTarget: tt, selisih: ta - tt, persentase: tt ? Math.round(ta / tt * 100) : 0 } };
}

function apiComparisonOR(token, filters) {
  return run_(token, function (u) {
    const f = filters || {};
    const now = new Date();
    const c = computeCleaning_(u, {});
    return _comparisonOR_(u, c.tx, Number(f.bulan || (now.getMonth() + 1)), Number(f.tahun || now.getFullYear()));
  });
}

// ─── Validasi input ───────────────────────────────────────────────────────────

function _validateCleaningInput_(u, p, sm) {
  required_(p.tanggal, 'Tanggal');
  required_(p.outlet || p.kodeOutlet, 'Outlet');
  required_(p.studio, 'Studio');
  required_(p.jenis, 'Jenis Cleaning');
  const jenis = _normalizeJenis(p.jenis);
  if (!jenis) throw new Error('VALIDATION_ERROR: Jenis cleaning harus "Cuci Kursi" atau "Cuci Karpet".');
  const tgl = toDate_(p.tanggal);
  if (!tgl) throw new Error('VALIDATION_ERROR: Format tanggal tidak valid.');
  const tanggal = fmtDate_(tgl);
  if (tanggal > todayStr_()) throw new Error('VALIDATION_ERROR: Tanggal cleaning tidak boleh melebihi hari ini.');

  const outlet = outletInScope_(sm, p.kodeOutlet, p.outlet) || outletInScope_(sm, p.outlet, p.outlet);
  if (!outlet) throw new Error('ACCESS_DENIED: Outlet di luar cakupan akses Anda.');
  if (!String(outlet.Class || '').trim()) {
    throw new Error('VALIDATION_ERROR: Outlet "' + outlet.NamaOutlet + '" belum memiliki Class di master KODE. Lengkapi master terlebih dahulu.');
  }
  const studio = sanitizeStr_(p.studio);
  validMaxLen_(studio, 60, 'Studio');
  const target = p.targetInterval === undefined || p.targetInterval === '' ? 1 : Number(p.targetInterval);
  if (!isFinite(target) || target < 1 || target > 31) throw new Error('VALIDATION_ERROR: Target OR harus 1–31.');
  return { jenis: jenis, tanggal: tanggal, outlet: outlet, studio: studio, target: target,
           vendor: sanitizeStr_(p.vendor), keterangan: sanitizeStr_(p.keterangan) };
}

function _isDuplicateCleaning_(v, excludeId) {
  return getCleaningTxFresh_().some(t =>
    t.id !== String(excludeId || '') && norm_(t.kode) === norm_(v.outlet.KodeOutlet) &&
    norm_(t.studio) === norm_(v.studio) && t.jenis === v.jenis && t.tgl === v.tanggal);
}

/** Transaksi langsung dari sheet (tanpa cache) — dipakai di dalam lock. */
function getCleaningTxFresh_() {
  _EXEC.cleaningTx = null;
  cacheDel_('cl_tx_' + dataVersion_('cleaning', 'master'));
  return getCleaningTx_();
}

// ─── API: Simpan / Ubah / Hapus ───────────────────────────────────────────────

function apiSaveCleaning(token, p) {
  return run_(token, function (u) {
    if (!getPerms_(u.role).canInputCleaning) {
      throw new Error('ACCESS_DENIED: Role Anda tidak memiliki akses untuk mencatat cleaning.');
    }
    p = p || {};
    const v = _validateCleaningInput_(u, p, scopeMap_(u));
    const id = uuid_();
    withLock_(() => {
      if (_isDuplicateCleaning_(v)) {
        throw new Error('VALIDATION_ERROR: Data cleaning untuk outlet, studio, jenis, dan tanggal yang sama sudah ada.');
      }
      const now = fmtDateTime_(new Date());
      appendRow_('TRANSAKSI_CLEANING', {
        IDCleaning: id, Timestamp: now, Tanggal: v.tanggal,
        KodeOutlet: v.outlet.KodeOutlet, NamaOutlet: v.outlet.NamaOutlet,
        Class: v.outlet.Class, Area: v.outlet.Area, Region: v.outlet.RM,
        Studio: v.studio, JenisCleaning: v.jenis, Vendor: v.vendor, Keterangan: v.keterangan,
        TargetInterval: v.target, Status: 'Active',
        CreatedAt: now, CreatedBy: u.username, UpdatedAt: now, UpdatedBy: u.username
      });
    });
    bumpVersion_('cleaning');
    auditLog_(u, 'CREATE_CLEANING', 'TRANSAKSI_CLEANING', id, null,
      { kode: v.outlet.KodeOutlet, studio: v.studio, jenis: v.jenis, tanggal: v.tanggal });
    return { idCleaning: id, pesan: 'Data cleaning berhasil disimpan.' };
  });
}

function apiUpdateCleaning(token, id, p) {
  return run_(token, function (u) {
    if (!getPerms_(u.role).canEditCleaning) throw new Error('ACCESS_DENIED: Hanya QC Office yang dapat mengubah data cleaning.');
    required_(id, 'ID Cleaning');
    p = p || {};
    const res = withLock_(() => {
      const tx = getCleaningTxFresh_().find(t => t.id === String(id));
      if (!tx) throw new Error('NOT_FOUND: Data cleaning tidak ditemukan.');
      const v = _validateCleaningInput_(u, Object.assign({ kodeOutlet: tx.kode, outlet: tx.nama }, p,
        { kodeOutlet: tx.kode, outlet: tx.nama }), scopeMap_(u));
      if (_isDuplicateCleaning_(v, id)) throw new Error('VALIDATION_ERROR: Perubahan menghasilkan data duplikat.');
      const upd = { Tanggal: v.tanggal, Studio: v.studio, JenisCleaning: v.jenis, Vendor: v.vendor,
                    Keterangan: v.keterangan, TargetInterval: v.target,
                    UpdatedAt: fmtDateTime_(new Date()), UpdatedBy: u.username };
      updateRow_('TRANSAKSI_CLEANING', tx.row, upd);
      return { before: tx, after: upd };
    });
    bumpVersion_('cleaning');
    auditLog_(u, 'UPDATE_CLEANING', 'TRANSAKSI_CLEANING', id, res.before, res.after);
    return { updated: true, idCleaning: id };
  });
}

function apiDeleteCleaning(token, id) {
  return run_(token, function (u) {
    if (!getPerms_(u.role).canEditCleaning) throw new Error('ACCESS_DENIED: Hanya QC Office yang dapat menghapus data cleaning.');
    required_(id, 'ID Cleaning');
    const before = withLock_(() => {
      const tx = getCleaningTxFresh_().find(t => t.id === String(id));
      if (!tx) throw new Error('NOT_FOUND: Data cleaning tidak ditemukan atau sudah dihapus.');
      updateRow_('TRANSAKSI_CLEANING', tx.row, { Status: 'Deleted', UpdatedAt: fmtDateTime_(new Date()), UpdatedBy: u.username });
      return tx;
    });
    bumpVersion_('cleaning');
    auditLog_(u, 'DELETE_CLEANING', 'TRANSAKSI_CLEANING', id, before, 'Status=Deleted');
    return { deleted: true, idCleaning: id };
  });
}
