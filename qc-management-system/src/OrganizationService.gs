/**
 * OrganizationService.gs
 * QC Workforce Mapping (QC Office, QC Area / Kabag Area, Specialist), Master Outlet & OP,
 * serta konfigurasi aplikasi.
 * @version 2.0.0
 *
 * Sumber penugasan QC Area (digabung, kunci = nama dinormalisasi):
 *   1. KODE.KabagQCArea         → outlet yang menjadi tanggung jawab (sumber utama, PRD §3.4)
 *   2. OP (DIVISI/JABATAN QC AREA) → roster personel + penugasan outlet tambahan (kolom OUTLET)
 *   3. USERS role "QC Area"     → akun login
 * Perbaikan v2: personel OP tanpa kolom OUTLET tidak lagi hilang dari tampilan.
 */

/** Roster QC Area: compact(nama) → {nama, jabatan, area, regio, divisi, outlets[kode], sources[]} */
function getQcAreaRoster_() {
  if (_EXEC.roster) return _EXEC.roster;
  const key = 'roster_' + dataVersion_('master', 'users');
  _EXEC.roster = cached_(key, CACHE_TTL_MASTER, function () {
    const m = getMasterCache_();
    const R = {};
    const get = (nama) => {
      const k = compact_(nama);
      if (!k) return null;
      if (!R[k]) R[k] = { nama: String(nama).trim(), jabatan: 'QC Area', area: '', regio: '', divisi: 'QC AREA', outlets: [], sources: [] };
      return R[k];
    };
    const addSrc = (p, s) => { if (p.sources.indexOf(s) < 0) p.sources.push(s); };
    m.op.forEach(o => {
      const tag = norm_(o.DIVISI) + ' ' + norm_(o.JABATAN);
      if (tag.indexOf('office') >= 0 || (tag.trim() && tag.indexOf('qc area') < 0 && tag.indexOf('kabag') < 0 && tag.indexOf('area') < 0)) return;
      const p = get(o.NAMA);
      if (!p) return;
      p.nama = String(o.NAMA).trim();
      if (o.JABATAN) p.jabatan = String(o.JABATAN).trim();
      if (o.AREA) p.area = String(o.AREA).trim();
      if (o.REGIO) p.regio = String(o.REGIO).trim();
      if (o.DIVISI) p.divisi = String(o.DIVISI).trim();
      addSrc(p, 'OP');
      if (String(o.OUTLET || '').trim()) {
        const r = findOutlet_(o.OUTLET);
        if (r && p.outlets.indexOf(r.KodeOutlet) < 0) p.outlets.push(r.KodeOutlet);
      }
    });
    m.kode.forEach(r => {
      if (!String(r.KabagQCArea || '').trim()) return;
      const p = get(r.KabagQCArea);
      addSrc(p, 'KODE');
      if (p.outlets.indexOf(r.KodeOutlet) < 0) p.outlets.push(r.KodeOutlet);
    });
    Object.values(getUserIndex_()).forEach(u => {
      if (u.role !== ROLES.QC_AREA) return;
      const p = get(u.nama);
      addSrc(p, 'USERS');
      p.username = u.username;
    });
    // Area/region otomatis dari outlet terbanyak bila OP kosong
    Object.values(R).forEach(p => {
      if ((!p.area || !p.regio) && p.outlets.length) {
        const cnt = {}, cntR = {};
        p.outlets.forEach(k => { const o = findOutlet_(k); if (!o) return; cnt[o.Area] = (cnt[o.Area] || 0) + 1; cntR[o.RM] = (cntR[o.RM] || 0) + 1; });
        const top = c => Object.keys(c).sort((a, b) => c[b] - c[a])[0] || '';
        if (!p.area) p.area = Object.keys(cnt).length > 1 ? top(cnt) + ' +' + (Object.keys(cnt).length - 1) : top(cnt);
        if (!p.regio) p.regio = top(cntR);
      }
    });
    return R;
  });
  return _EXEC.roster;
}

function _inisial(nama) {
  const parts = String(nama || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// ─── API: Mapping Organisasi ──────────────────────────────────────────────────

function apiMapping(token) {
  return run_(token, function (u) {
    const scope = getScope_(u);
    const sc = {};
    scope.forEach(r => { sc[r.KodeOutlet] = r; });
    const admin = isAdminRole_(u.role);
    const users = Object.values(getUserIndex_());

    const office = users.filter(x => x.role === ROLES.QC).map(x => ({
      nama: x.nama, username: admin ? x.username : '', status: x.status, jabatan: 'QC Office', role: x.rawRole || 'QC Office',
      lokasi: 'Head Office', inisial: _inisial(x.nama)
    }));
    getMasterCache_().op.forEach(o => {
      const tag = norm_(o.DIVISI) + ' ' + norm_(o.JABATAN);
      if (tag.indexOf('office') >= 0 && !office.some(x => compact_(x.nama) === compact_(o.NAMA))) {
        office.push({ nama: String(o.NAMA).trim(), username: '', status: 'Active', jabatan: 'QC Office', role: 'QC Office', lokasi: 'Office', inisial: _inisial(o.NAMA) });
      }
    });

    const specialist = users.filter(x => x.role === ROLES.SPECIALIST).map(x => ({ nama: x.nama, jabatan: 'Specialist (Kabag)', status: x.status, inisial: _inisial(x.nama) }));

    let team = Object.values(getQcAreaRoster_()).map(p => {
      const outs = p.outlets.filter(k => sc[k]);
      return { nama: p.nama, jabatan: p.jabatan || 'QC Area', area: p.area, region: p.regio, divisi: p.divisi,
               inisial: _inisial(p.nama), outletCount: outs.length, outlets: outs.map(k => sc[k].NamaOutlet),
               totalOutlet: p.outlets.length, punyaAkun: p.sources.indexOf('USERS') >= 0 };
    });
    if (!admin) team = team.filter(t => t.outletCount > 0);
    team.sort((a, b) => b.outletCount - a.outletCount || a.nama.localeCompare(b.nama, 'id'));

    const assigned = {};
    Object.values(getQcAreaRoster_()).forEach(p => p.outlets.forEach(k => { assigned[k] = true; }));
    const regionDist = {};
    team.forEach(t => { const r = t.region || '-'; regionDist[r] = (regionDist[r] || 0) + 1; });

    return {
      office: office, kabag: team, area: team, specialist: specialist,
      summary: {
        totalOffice: office.length, totalQCArea: team.length, totalSpecialist: specialist.length,
        totalOutlet: scope.length, outletTanpaQC: scope.filter(r => !assigned[r.KodeOutlet]).length,
        qcTanpaOutlet: team.filter(t => !t.outletCount).length, distribusiRegion: regionDist
      }
    };
  });
}

// ─── API: Detail Personel ─────────────────────────────────────────────────────

function apiGetPersonnel(token, id) {
  return run_(token, function (u) {
    required_(id, 'Nama personel');
    const p = getQcAreaRoster_()[compact_(id)];
    if (!p) throw new Error('NOT_FOUND: Personel "' + id + '" tidak ditemukan.');
    const sm = scopeMap_(u);
    const outlets = p.outlets.map(k => sm[norm_(k)]).filter(Boolean).map(r => ({
      kode: r.KodeOutlet, nama: r.NamaOutlet, kelas: r.Class, area: r.Area, region: r.RM, status: r.StatusOutlet || 'Active',
      // kompatibilitas v1
      kodeOutlet: r.KodeOutlet, namaOutlet: r.NamaOutlet
    }));
    if (!isAdminRole_(u.role) && !outlets.length) throw new Error('ACCESS_DENIED: Personel di luar cakupan akses Anda.');
    return { nama: p.nama, jabatan: p.jabatan, area: p.area, region: p.regio, regio: p.regio, divisi: p.divisi,
             inisial: _inisial(p.nama), outletCount: outlets.length, outlets: outlets, username: p.username || '',
             canEdit: isAdminRole_(u.role) };
  });
}

/**
 * Perbarui penugasan personel (Admin).
 * @param {Object} data {nama, jabatan, outlets: [kodeOutlet], area?, regio?}
 * - Jabatan QC Office → tidak boleh memiliki outlet cinema (PRD §5.5).
 * - Penugasan outlet ditulis ke KODE.KabagQCArea (sumber utama scope QC Area).
 */
function apiUpdatePersonnel(token, data) {
  return run_(token, function (u) {
    requireAdmin_(u);
    data = data || {};
    required_(data.nama, 'Nama personel');
    required_(data.jabatan, 'Jabatan');
    const nama = sanitizeStr_(data.nama);
    const jab = sanitizeStr_(data.jabatan);
    const isOffice = norm_(jab).indexOf('office') >= 0;
    const want = (Array.isArray(data.outlets) ? data.outlets : []).map(k => findOutlet_(k)).filter(Boolean);
    if (isOffice && want.length) throw new Error('VALIDATION_ERROR: Jabatan QC Office hanya ditempatkan di Office (tanpa outlet cinema).');
    if (!isOffice && !want.length) throw new Error('VALIDATION_ERROR: QC Area wajib memiliki minimal satu outlet.');
    if ((Array.isArray(data.outlets) ? data.outlets.length : 0) !== want.length) {
      throw new Error('VALIDATION_ERROR: Ada outlet yang tidak ditemukan di master KODE. Muat ulang halaman.');
    }

    const result = withLock_(() => {
      const kodeRows = readColumns_('KODE', ['KodeOutlet', 'KabagQCArea']);
      const wantSet = {};
      want.forEach(r => { wantSet[norm_(r.KodeOutlet)] = true; });
      const updates = [], reassigned = [], removed = [];
      kodeRows.forEach(r => {
        const mine = compact_(r.KabagQCArea) === compact_(nama);
        const shouldBe = !!wantSet[norm_(r.KodeOutlet)];
        if (shouldBe && !mine) {
          if (String(r.KabagQCArea || '').trim()) reassigned.push({ kode: r.KodeOutlet, dari: r.KabagQCArea });
          updates.push({ row: r.__rowIndex, value: nama });
        } else if (!shouldBe && mine) {
          removed.push(r.KodeOutlet);
          updates.push({ row: r.__rowIndex, value: '' });
        }
      });
      if (updates.length) updateColumn_('KODE', 'KabagQCArea', updates);
      // OP: perbarui / tambah baris roster (tanpa menghapus data lama)
      const op = readTable_('OP');
      const mineOp = op.filter(o => compact_(o['NAMA']) === compact_(nama));
      const area = sanitizeStr_(data.area || (want[0] ? want[0].Area : ''));
      const regio = sanitizeStr_(data.regio || (want[0] ? want[0].RM : ''));
      if (mineOp.length) {
        mineOp.forEach(o => updateRow_('OP', o.__rowIndex, { JABATAN: jab, AREA: area, REGIO: regio,
          DIVISI: isOffice ? 'QC OFFICE' : (o['DIVISI'] || 'QC AREA'), OUTLET: isOffice ? 'OFFICE' : o['OUTLET'] }));
      } else {
        appendRow_('OP', { NAMA: nama, OUTLET: isOffice ? 'OFFICE' : '', JABATAN: jab, AREA: area, REGIO: regio, DIVISI: isOffice ? 'QC OFFICE' : 'QC AREA' });
      }
      return { updated: updates.length, reassigned: reassigned, removed: removed };
    });
    bumpVersion_('master');
    auditLog_(u, 'UPDATE_PERSONNEL', 'KODE/OP', nama, { removed: result.removed, reassigned: result.reassigned },
      { jabatan: jab, outlets: want.map(r => r.KodeOutlet) });
    return Object.assign({ saved: true, nama: nama }, result);
  });
}

/** Daftar personel QC Area dalam scope (filter area/region/search). */
function apiGetPersonnelList(token, filters) {
  return run_(token, function (u) {
    const f = filters || {};
    const sm = scopeMap_(u);
    let list = Object.values(getQcAreaRoster_()).map(p => {
      const outs = p.outlets.map(k => sm[norm_(k)]).filter(Boolean);
      return { nama: p.nama, jabatan: p.jabatan, area: p.area, regio: p.regio, divisi: p.divisi, inisial: _inisial(p.nama),
               outletCount: outs.length, outlets: outs.map(o => o.NamaOutlet) };
    });
    if (!isAdminRole_(u.role)) list = list.filter(p => p.outletCount);
    if (f.area) list = list.filter(p => norm_(p.area).indexOf(norm_(f.area)) >= 0);
    if (f.region) list = list.filter(p => norm_(p.regio) === norm_(f.region));
    if (f.search) { const q = norm_(f.search); list = list.filter(p => norm_(p.nama).indexOf(q) >= 0 || norm_(p.area).indexOf(q) >= 0); }
    list.sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
    return { total: list.length, data: list };
  });
}

// ─── API: App Config ──────────────────────────────────────────────────────────

function apiGetAppConfig(token, key) {
  return run_(token, function (u) {
    if (key) {
      if (!isAdminRole_(u.role) && !(key in getClientConfig_())) throw new Error('ACCESS_DENIED: Konfigurasi tidak tersedia.');
      return { key: key, value: getConfig_(key, null) };
    }
    requireAdmin_(u);
    const map = getConfigMap_();
    const rows = readTable_('APP_CONFIG');
    const desc = {};
    DEFAULT_CONFIG.forEach(c => { desc[c[0]] = c[2]; });
    return Object.keys(map).map(k => {
      const r = rows.find(x => String(x['ConfigKey']).trim() === k) || {};
      return { key: k, value: map[k], deskripsi: String(r['Deskripsi'] || desc[k] || ''), updatedAt: r['UpdatedAt'] || '',
               updatedBy: r['UpdatedBy'] || (r['ConfigKey'] ? '' : '(default)') };
    });
  });
}

function apiUpdateAppConfig(token, data) {
  return run_(token, function (u) {
    requireAdmin_(u);
    data = data || {};
    required_(data.key, 'Config key');
    required_(data.value, 'Config value');
    const key = String(data.key).trim();
    if (!/^[a-zA-Z0-9_]{2,60}$/.test(key)) throw new Error('VALIDATION_ERROR: Nama key tidak valid.');
    const value = _validateConfigValue_(key, data.value);
    const before = getConfig_(key, '');
    withLock_(() => setAppConfig_(key, value, data.deskripsi || '', u));
    auditLog_(u, 'UPDATE_APP_CONFIG', 'APP_CONFIG', key, before, value);
    return { updated: true, key: key, value: value };
  });
}

// ─── API: Master Data (KODE & OP) ─────────────────────────────────────────────

function apiMaster(token) {
  return run_(token, function (u) {
    const admin = isAdminRole_(u.role);
    const scope = getScope_(u);
    const sm = scopeMap_(scope);
    const outlets = (admin ? getMasterCache_().kode : scope).map(r => Object.assign({}, r));
    const ivMap = getIntervalMap_();
    outlets.forEach(r => { const iv = ivMap[norm_(r.Class)]; r.IntervalValid = !!(iv && iv.kursi && iv.karpet); });
    const op = getMasterCache_().op
      .filter(o => admin ? true : !!(String(o.OUTLET || '').trim() && sm[norm_(o.OUTLET)]))
      .map(o => Object.assign({}, o));
    return { outlets: outlets, op: op, canManage: admin, intervals: getMasterCache_().interval };
  });
}

function _afterMasterChange_() { bumpVersion_('master'); }

/**
 * Tambah / edit outlet KODE (Admin). Saat edit, KodeOutlet dikunci (identitas relasi).
 * @param {Object} p {origKode?, kodeOutlet, namaOutlet, lob, kelas, area, am, kota, rm, kabagQCArea, statusOutlet}
 */
function apiSaveOutlet(token, p) {
  return run_(token, function (u) {
    requireAdmin_(u);
    p = p || {};
    const res = withLock_(() => {
      const rows = readTable_('KODE');
      const isEdit = !!String(p.origKode || '').trim();
      const kelas = sanitizeStr_(p.kelas);
      if (kelas && !getIntervalMap_()[norm_(kelas)]) {
        Logger.log('[apiSaveOutlet] Class %s belum ada di INTERVAL', kelas);
      }
      const common = {
        LOB: sanitizeStr_(p.lob), Class: kelas, Area: sanitizeStr_(p.area), AM: sanitizeStr_(p.am),
        Kota: sanitizeStr_(p.kota), RM: sanitizeStr_(p.rm), KabagQCArea: sanitizeStr_(p.kabagQCArea),
        StatusOutlet: norm_(p.statusOutlet) === 'inactive' ? 'Inactive' : 'Active'
      };
      if (isEdit) {
        const row = rows.find(r => norm_(r['KodeOutlet']) === norm_(p.origKode));
        if (!row) throw new Error('NOT_FOUND: Outlet tidak ditemukan.');
        if (p.namaOutlet && norm_(p.namaOutlet) !== norm_(row['NamaOutlet'])) {
          const nama = sanitizeStr_(p.namaOutlet);
          if (rows.some(r => r !== row && norm_(r['NamaOutlet']) === norm_(nama))) throw new Error('VALIDATION_ERROR: Nama outlet "' + nama + '" sudah dipakai.');
          common.NamaOutlet = nama;
        }
        updateRow_('KODE', row.__rowIndex, common);
        return { created: false, kode: String(row['KodeOutlet']), before: row, after: common };
      }
      required_(p.kodeOutlet, 'Kode Outlet');
      required_(p.namaOutlet, 'Nama Outlet');
      const kode = String(p.kodeOutlet).trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9_\-]{1,29}$/.test(kode)) throw new Error('VALIDATION_ERROR: Kode outlet hanya huruf/angka/-/_ (2–30 karakter).');
      const nama = sanitizeStr_(p.namaOutlet);
      if (rows.some(r => norm_(r['KodeOutlet']) === norm_(kode))) throw new Error('VALIDATION_ERROR: Kode outlet "' + kode + '" sudah terdaftar.');
      if (rows.some(r => norm_(r['NamaOutlet']) === norm_(nama))) throw new Error('VALIDATION_ERROR: Nama outlet "' + nama + '" sudah terdaftar.');
      const payload = Object.assign({ KodeOutlet: kode, NamaOutlet: nama }, common);
      appendRow_('KODE', payload);
      return { created: true, kode: kode, before: null, after: payload };
    });
    _afterMasterChange_();
    auditLog_(u, res.created ? 'CREATE_OUTLET' : 'UPDATE_OUTLET', 'KODE', res.kode, res.before, res.after);
    return { saved: true, created: res.created, kodeOutlet: res.kode };
  });
}

/** Hapus outlet — diblokir bila sudah dipakai transaksi (gunakan status Inactive). */
function apiDeleteOutlet(token, kodeOutlet) {
  return run_(token, function (u) {
    requireAdmin_(u);
    required_(kodeOutlet, 'Kode Outlet');
    const row = readTable_('KODE').find(r => norm_(r['KodeOutlet']) === norm_(kodeOutlet));
    if (!row) throw new Error('NOT_FOUND: Outlet tidak ditemukan.');
    const kode = String(row['KodeOutlet']);
    const refs = [];
    const nCl = getCleaningTx_().filter(t => norm_(t.kode) === norm_(kode)).length;
    if (nCl) refs.push(nCl + ' transaksi cleaning');
    const nVs = getVisits_().filter(v => norm_(v._kode) === norm_(kode)).length;
    if (nVs) refs.push(nVs + ' data kunjungan');
    const nOp = getMasterCache_().op.filter(o => findOutlet_(o.OUTLET) && findOutlet_(o.OUTLET).KodeOutlet === kode).length;
    if (nOp) refs.push(nOp + ' penugasan OP');
    if (refs.length) {
      throw new Error('VALIDATION_ERROR: Outlet tidak dapat dihapus karena memiliki ' + refs.join(', ') + '. Ubah status menjadi Inactive.');
    }
    withLock_(() => deleteRow_('KODE', row.__rowIndex));
    _afterMasterChange_();
    auditLog_(u, 'DELETE_OUTLET', 'KODE', kode, row, null);
    return { deleted: true, kodeOutlet: kode };
  });
}

/** Tambah / edit baris OP (Admin). */
function apiSaveOP(token, p) {
  return run_(token, function (u) {
    requireAdmin_(u);
    p = p || {};
    required_(p.nama, 'Nama Personel');
    const nama = sanitizeStr_(p.nama);
    const jab = sanitizeStr_(p.jabatan || 'QC Area');
    const isOffice = norm_(jab).indexOf('office') >= 0 || norm_(p.divisi).indexOf('office') >= 0;
    let outlet = '', kodeRow = null;
    if (isOffice) {
      outlet = 'OFFICE';
      if (p.outlet && norm_(p.outlet) !== 'office') throw new Error('VALIDATION_ERROR: QC Office hanya dapat ditempatkan di Office.');
    } else if (p.outlet) {
      kodeRow = findOutlet_(p.outlet);
      if (!kodeRow) throw new Error('VALIDATION_ERROR: Outlet "' + p.outlet + '" tidak terdaftar di Master Outlet. Area & Region tidak dapat diisi otomatis.');
      outlet = kodeRow.NamaOutlet;
    }
    const payload = {
      NAMA: nama, OUTLET: outlet, JABATAN: jab,
      AREA: kodeRow ? kodeRow.Area : sanitizeStr_(p.area), REGIO: kodeRow ? kodeRow.RM : sanitizeStr_(p.regio),
      DIVISI: sanitizeStr_(p.divisi || (isOffice ? 'QC OFFICE' : 'QC AREA'))
    };
    const res = withLock_(() => {
      const rows = readTable_('OP');
      const same = (r, n, o) => compact_(r['NAMA']) === compact_(n) && norm_(r['OUTLET']) === norm_(o);
      if (p.origNama) {
        const row = rows.find(r => same(r, p.origNama, p.origOutlet || ''));
        if (!row) throw new Error('NOT_FOUND: Data penugasan tidak ditemukan.');
        if (!same(row, nama, outlet) && rows.some(r => same(r, nama, outlet))) throw new Error('VALIDATION_ERROR: Penugasan tersebut sudah ada.');
        updateRow_('OP', row.__rowIndex, payload);
        return { created: false, before: row };
      }
      if (rows.some(r => same(r, nama, outlet))) throw new Error('VALIDATION_ERROR: Penugasan "' + nama + '" di "' + (outlet || '-') + '" sudah ada.');
      appendRow_('OP', payload);
      return { created: true, before: null };
    });
    _afterMasterChange_();
    auditLog_(u, res.created ? 'CREATE_OP' : 'UPDATE_OP', 'OP', nama + '|' + outlet, res.before, payload);
    return { saved: true, created: res.created };
  });
}

function apiDeleteOP(token, nama, outlet) {
  return run_(token, function (u) {
    requireAdmin_(u);
    required_(nama, 'Nama Personel');
    const row = withLock_(() => {
      const r = readTable_('OP').find(x => compact_(x['NAMA']) === compact_(nama) && norm_(x['OUTLET']) === norm_(outlet || ''));
      if (!r) throw new Error('NOT_FOUND: Data penugasan tidak ditemukan.');
      deleteRow_('OP', r.__rowIndex);
      return r;
    });
    _afterMasterChange_();
    auditLog_(u, 'DELETE_OP', 'OP', nama + '|' + (outlet || ''), row, null);
    return { deleted: true };
  });
}
