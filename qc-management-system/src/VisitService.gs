/**
 * VisitService.gs
 * QC Area Visit Management: jadwal, timeline, status, coverage / achievement.
 * @version 2.0.0
 *
 * Status tersimpan (LOG_VISIT.Status): Planned | In Progress | Completed | Rescheduled | Cancelled
 * Status efektif (dihitung, tidak ditulis): Overdue bila Planned/Rescheduled melewati tanggal
 * rencana; Upcoming bila jatuh dalam N hari ke depan (APP_CONFIG.upcoming_visit_days).
 *
 * Visit Achievement (PRD §8.6) = outlet UNIK yang dikunjungi (Completed) dalam periode
 *                                 ÷ total outlet wajib dikunjungi × 100%.
 */

const VALID_VISIT_STATUS = ['Planned', 'In Progress', 'Completed', 'Rescheduled', 'Cancelled', 'Overdue'];

/** Seluruh visit ternormalisasi (memo per eksekusi). */
function getVisits_() {
  if (_EXEC.visits) return _EXEC.visits;
  _EXEC.visits = readTable_('LOG_VISIT').map(r => {
    const o = findOutlet_(r['KodeOutlet'], r['NamaOutlet']);
    return Object.assign({}, r, {
      _kode: o ? o.KodeOutlet : String(r['KodeOutlet'] || ''),
      _nama: o ? o.NamaOutlet : String(r['NamaOutlet'] || ''),
      _rencana: fmtDate_(toDate_(r['TanggalRencana'])) || '',
      _realisasi: fmtDate_(toDate_(r['TanggalRealisasi'])) || ''
    });
  });
  return _EXEC.visits;
}

/** Status efektif berbasis tanggal. */
function effectiveVisitStatus_(r, today) {
  const st = String(r['Status'] || 'Planned');
  const s = norm_(st);
  today = today || todayStr_();
  if ((s === 'planned' || s === 'rescheduled' || s === 'overdue') && r._rencana) {
    if (r._rencana < today) return 'Overdue';
    const d = dayDiff_(today, r._rencana);
    if (d !== null && d <= getConfigNum_('upcoming_visit_days', 7)) return 'Upcoming';
  }
  return st;
}

function _visitsInScope_(u) {
  const sm = scopeMap_(u);
  return getVisits_().filter(r => outletInScope_(sm, r._kode, r._nama));
}

function _mapVisitRow(r) {
  return {
    idVisit:          String(r['IDVisit'] || ''),
    tanggalRencana:   r._rencana,
    namaQCArea:       String(r['NamaQCArea'] || ''),
    kodeOutlet:       r._kode,
    namaOutlet:       r._nama,
    area:             String(r['Area'] || ''),
    region:           String(r['Region'] || ''),
    status:           String(r['Status'] || 'Planned'),
    statusEfektif:    effectiveVisitStatus_(r),
    tanggalRealisasi: r._realisasi,
    checklistID:      String(r['ChecklistID'] || ''),
    keterangan:       String(r['Keterangan'] || ''),
    createdAt:        String(r['CreatedAt'] || ''),
    createdBy:        String(r['CreatedBy'] || ''),
    updatedAt:        String(r['UpdatedAt'] || '')
  };
}

function _appendVisitHistory(idVisit, statusLama, statusBaru, keterangan, changedBy) {
  appendRow_('VISIT_HISTORY', {
    IDHistory: uuid_(), IDVisit: idVisit, StatusLama: statusLama, StatusBaru: statusBaru,
    Keterangan: sanitizeStr_(keterangan || ''), Timestamp: fmtDateTime_(new Date()), ChangedBy: changedBy
  });
}
function _appendVisitHistory_(a, b, c, d, e) { _appendVisitHistory(a, b, c, d, e); }

// ─── API: Daftar Visit ────────────────────────────────────────────────────────

/** @param {Object} f {bulan:'yyyy-MM', status, qcArea, outletFilter} */
function apiGetVisits(token, filters) {
  return run_(token, function (u) {
    const f = filters || {};
    let rows = _visitsInScope_(u);
    if (f.bulan) {
      const ym = String(f.bulan).slice(0, 7);
      rows = rows.filter(r => r._rencana.indexOf(ym) === 0 || r._realisasi.indexOf(ym) === 0);
    }
    if (f.status) {
      const s = norm_(f.status);
      rows = rows.filter(r => norm_(r['Status']) === s || norm_(effectiveVisitStatus_(r)) === s);
    }
    if (f.qcArea) rows = rows.filter(r => compact_(r['NamaQCArea']) === compact_(f.qcArea));
    if (f.outletFilter) rows = rows.filter(r => norm_(r._nama) === norm_(f.outletFilter) || norm_(r._kode) === norm_(f.outletFilter));
    rows.sort((a, b) => b._rencana.localeCompare(a._rencana));
    return { total: rows.length, data: rows.map(_mapVisitRow) };
  });
}

// ─── API: Opsi form jadwal ────────────────────────────────────────────────────

/** Daftar QC Area + outlet tanggung jawabnya (dalam scope pengguna). */
function apiVisitFormOptions(token) {
  return run_(token, function (u) {
    const scope = getScope_(u);
    const scopeCodes = {};
    scope.forEach(r => { scopeCodes[r.KodeOutlet] = r; });
    const roster = getQcAreaRoster_();
    let list = Object.values(roster).map(p => ({
      nama: p.nama,
      outlets: p.outlets.filter(k => scopeCodes[k])
    }));
    const role = canonRole_(u.role);
    if (role === ROLES.QC_AREA) {
      list = list.filter(p => isSelf_(u, p.nama));
      if (!list.length) list = [{ nama: u.nama, outlets: scope.map(r => r.KodeOutlet) }];
    } else if (role !== ROLES.QC) {
      list = list.filter(p => p.outlets.length);
    }
    list.sort((a, b) => b.outlets.length - a.outlets.length || a.nama.localeCompare(b.nama, 'id'));
    return {
      qcAreas: list,
      outlets: scope.map(r => ({ kode: r.KodeOutlet, nama: r.NamaOutlet, area: r.Area, kabag: r.KabagQCArea }))
        .sort((a, b) => a.nama.localeCompare(b.nama, 'id')),
      canChooseQC: role === ROLES.QC
    };
  });
}

// ─── API: Buat Visit ──────────────────────────────────────────────────────────

/** @param {Object} p {tanggalRencana, namaQCArea, kodeOutlet, namaOutlet, keterangan} */
function apiCreateVisit(token, p) {
  return run_(token, function (u) {
    if (!getPerms_(u.role).canPlanVisit) {
      throw new Error('ACCESS_DENIED: Hanya QC Office atau QC Area yang dapat membuat rencana kunjungan.');
    }
    p = p || {};
    required_(p.tanggalRencana, 'Tanggal Rencana');
    required_(p.kodeOutlet || p.namaOutlet, 'Outlet');
    const tgl = toDate_(p.tanggalRencana);
    if (!tgl) throw new Error('VALIDATION_ERROR: Format tanggal rencana tidak valid.');
    const tanggal = fmtDate_(tgl);
    if (tanggal < todayStr_()) throw new Error('VALIDATION_ERROR: Tanggal rencana tidak boleh kurang dari hari ini.');
    if (dayDiff_(todayStr_(), tanggal) > 366) throw new Error('VALIDATION_ERROR: Tanggal rencana maksimal 1 tahun ke depan.');

    const outlet = outletInScope_(scopeMap_(u), p.kodeOutlet, p.namaOutlet);
    if (!outlet) throw new Error('ACCESS_DENIED: Outlet di luar cakupan akses Anda.');

    // QC Area hanya boleh menjadwalkan untuk dirinya sendiri
    let qcName = sanitizeStr_(p.namaQCArea || '');
    if (canonRole_(u.role) === ROLES.QC_AREA) {
      if (qcName && !isSelf_(u, qcName)) throw new Error('ACCESS_DENIED: QC Area hanya dapat menjadwalkan kunjungan untuk dirinya sendiri.');
      qcName = qcName || u.nama;
    }
    required_(qcName, 'Nama QC Area');

    const id = uuid_();
    let warning = '';
    withLock_(() => {
      _EXEC.visits = null; _execInvalidate_('LOG_VISIT');
      const open = getVisits_().filter(v => norm_(v._kode) === norm_(outlet.KodeOutlet) &&
        ['planned', 'in progress', 'rescheduled'].includes(norm_(v['Status'])));
      if (open.some(v => v._rencana === tanggal)) {
        throw new Error('VALIDATION_ERROR: Outlet ini sudah memiliki jadwal kunjungan pada tanggal ' + tanggal + '.');
      }
      if (open.length) warning = 'Perhatian: outlet ini masih memiliki ' + open.length + ' jadwal kunjungan yang belum selesai.';
      const now = fmtDateTime_(new Date());
      appendRow_('LOG_VISIT', {
        IDVisit: id, TanggalRencana: tanggal, NamaQCArea: qcName,
        KodeOutlet: outlet.KodeOutlet, NamaOutlet: outlet.NamaOutlet, Area: outlet.Area, Region: outlet.RM,
        Status: 'Planned', TanggalRealisasi: '', ChecklistID: '',
        Keterangan: sanitizeStr_(p.keterangan), CreatedAt: now, CreatedBy: u.username, UpdatedAt: now, UpdatedBy: u.username
      });
      _appendVisitHistory(id, '', 'Planned', 'Dibuat', u.username);
    });
    bumpVersion_('visit');
    auditLog_(u, 'CREATE_VISIT', 'LOG_VISIT', id, null, { kode: outlet.KodeOutlet, tanggal: tanggal, qc: qcName });
    return { idVisit: id, pesan: 'Rencana kunjungan berhasil dibuat.', warning: warning };
  });
}

// ─── API: Ubah Status ─────────────────────────────────────────────────────────

function _validateStatusTransition(u, oldStatus, newStatus, row) {
  const role = canonRole_(u.role);
  const old = norm_(oldStatus), nw = norm_(newStatus);
  if (old === 'completed' && nw !== 'completed') {
    throw new Error('VALIDATION_ERROR: Kunjungan yang sudah Completed tidak dapat diubah (hasil inspeksi terkunci).');
  }
  if (old === 'cancelled') throw new Error('VALIDATION_ERROR: Kunjungan yang dibatalkan tidak dapat diubah.');
  if (nw === 'completed' && !String(row['ChecklistID'] || '').trim()) {
    throw new Error('VALIDATION_ERROR: Kunjungan hanya dapat diselesaikan melalui submit checklist.');
  }
  if (nw === 'overdue') throw new Error('VALIDATION_ERROR: Status Overdue dihitung otomatis oleh sistem.');
  if (role === ROLES.QC) return;
  if (role === ROLES.QC_AREA) {
    if (!isSelf_(u, row['NamaQCArea'])) throw new Error('ACCESS_DENIED: Anda hanya dapat mengubah kunjungan milik Anda sendiri.');
    if (nw === 'cancelled') throw new Error('ACCESS_DENIED: Hanya QC Office yang dapat membatalkan kunjungan.');
    const okMoves = { planned: ['in progress', 'rescheduled'], rescheduled: ['in progress', 'rescheduled'], overdue: ['in progress', 'rescheduled'],
                      'in progress': ['rescheduled'] };
    if ((okMoves[old] || []).indexOf(nw) >= 0) return;
    throw new Error('ACCESS_DENIED: Transisi status dari "' + oldStatus + '" ke "' + newStatus + '" tidak diizinkan.');
  }
  throw new Error('ACCESS_DENIED: Role Anda tidak dapat mengubah status kunjungan.');
}

/**
 * @param {string} id IDVisit
 * @param {string} newStatus
 * @param {string} [keterangan]
 * @param {string} [newDate] yyyy-MM-dd (wajib untuk Rescheduled)
 */
function apiUpdateVisitStatus(token, id, newStatus, keterangan, newDate) {
  return run_(token, function (u) {
    required_(id, 'ID Visit');
    required_(newStatus, 'Status baru');
    if (VALID_VISIT_STATUS.indexOf(newStatus) < 0) {
      throw new Error('VALIDATION_ERROR: Status tidak valid. Pilihan: ' + VALID_VISIT_STATUS.join(', '));
    }
    const res = withLock_(() => {
      const row = getVisits_().find(r => String(r['IDVisit']) === String(id));
      if (!row) throw new Error('NOT_FOUND: Data kunjungan tidak ditemukan.');
      enforceScope_(u, row._kode, row._nama);
      const oldStatus = String(row['Status'] || 'Planned');
      _validateStatusTransition(u, oldStatus, newStatus, row);
      const upd = { Status: newStatus, UpdatedAt: fmtDateTime_(new Date()), UpdatedBy: u.username };
      if (newStatus === 'Rescheduled') {
        const nd = toDate_(newDate);
        if (!nd) throw new Error('VALIDATION_ERROR: Tanggal jadwal ulang wajib diisi.');
        if (fmtDate_(nd) < todayStr_()) throw new Error('VALIDATION_ERROR: Tanggal jadwal ulang tidak boleh kurang dari hari ini.');
        upd.TanggalRencana = fmtDate_(nd);
      }
      updateRow_('LOG_VISIT', row.__rowIndex, upd);
      _appendVisitHistory(id, oldStatus, newStatus, keterangan || '', u.username);
      return { oldStatus: oldStatus };
    });
    bumpVersion_('visit');
    auditLog_(u, 'UPDATE_VISIT_STATUS', 'LOG_VISIT', id, res.oldStatus, { status: newStatus, tanggal: newDate || '' });
    return { updated: true, idVisit: id, statusLama: res.oldStatus, statusBaru: newStatus };
  });
}

/** Batalkan kunjungan (soft delete). Hanya QC Office. */
function apiDeleteVisit(token, id) {
  return run_(token, function (u) {
    requireAdmin_(u);
    required_(id, 'ID Visit');
    const old = withLock_(() => {
      const row = getVisits_().find(r => String(r['IDVisit']) === String(id));
      if (!row) throw new Error('NOT_FOUND: Data kunjungan tidak ditemukan.');
      const st = norm_(row['Status']);
      if (st === 'cancelled') throw new Error('VALIDATION_ERROR: Kunjungan ini sudah dibatalkan.');
      if (st === 'completed') throw new Error('VALIDATION_ERROR: Kunjungan Completed tidak dapat dibatalkan karena sudah memiliki hasil inspeksi.');
      updateRow_('LOG_VISIT', row.__rowIndex, { Status: 'Cancelled', UpdatedAt: fmtDateTime_(new Date()), UpdatedBy: u.username });
      _appendVisitHistory(id, String(row['Status']), 'Cancelled', 'Dibatalkan oleh QC Office', u.username);
      return String(row['Status']);
    });
    bumpVersion_('visit');
    auditLog_(u, 'CANCEL_VISIT', 'LOG_VISIT', id, old, 'Cancelled');
    return { deleted: true, idVisit: id };
  });
}

// ─── Coverage / Achievement ───────────────────────────────────────────────────

/**
 * Hitung achievement kunjungan untuk rentang [fromYm .. toYm].
 * @returns {Object}
 */
function computeVisitCoverage_(u, fromYm, toYm, qcFilter) {
  const scopeRows = getScope_(u);
  const roster = getQcAreaRoster_();
  const responsible = {};   // kode → nama QC Area
  Object.values(roster).forEach(p => p.outlets.forEach(k => { if (!responsible[k]) responsible[k] = p.nama; }));

  const inRange = d => d && d.slice(0, 7) >= fromYm && d.slice(0, 7) <= toYm;
  const visits = _visitsInScope_(u).filter(v => inRange(v._rencana) || inRange(v._realisasi));
  const filtered = qcFilter ? visits.filter(v => compact_(v['NamaQCArea']) === compact_(qcFilter)) : visits;

  const visited = {};
  filtered.forEach(v => {
    if (norm_(v['Status']) === 'completed' && inRange(v._realisasi || v._rencana)) visited[v._kode] = true;
  });

  let targetRows = scopeRows.filter(k => norm_(k.StatusOutlet) !== 'inactive');
  if (qcFilter) targetRows = targetRows.filter(k => compact_(responsible[k.KodeOutlet]) === compact_(qcFilter));

  const byQC = {};
  targetRows.forEach(k => {
    const qc = responsible[k.KodeOutlet] || 'Belum Ditugaskan';
    if (!byQC[qc]) byQC[qc] = { nama: qc, totalOutlet: 0, visited: 0, jadwal: 0 };
    byQC[qc].totalOutlet++;
    if (visited[k.KodeOutlet]) byQC[qc].visited++;
  });
  filtered.forEach(v => {
    const qc = String(v['NamaQCArea'] || '').trim();
    const key = Object.keys(byQC).find(n => compact_(n) === compact_(qc));
    if (key && norm_(v['Status']) !== 'cancelled') byQC[key].jadwal++;
  });

  const summary = { planned: 0, upcoming: 0, completed: 0, inProgress: 0, overdue: 0, rescheduled: 0, cancelled: 0 };
  filtered.forEach(v => {
    const s = norm_(effectiveVisitStatus_(v));
    if (s === 'planned') summary.planned++;
    else if (s === 'upcoming') summary.upcoming++;
    else if (s === 'completed') summary.completed++;
    else if (s === 'in progress') summary.inProgress++;
    else if (s === 'overdue') summary.overdue++;
    else if (s === 'rescheduled') summary.rescheduled++;
    else if (s === 'cancelled') summary.cancelled++;
  });

  const nVisited = targetRows.filter(k => visited[k.KodeOutlet]).length;
  return {
    periode: { dari: fromYm, sampai: toYm },
    totalOutletScope: targetRows.length,
    outletVisited: nVisited,
    outletBelum: targetRows.length - nVisited,
    coveragePercent: targetRows.length ? round_(nVisited / targetRows.length * 100, 1) : 0,
    totalJadwal: filtered.filter(v => norm_(v['Status']) !== 'cancelled').length,
    kunjunganBerulang: filtered.filter(v => norm_(v['Status']) === 'completed').length - nVisited,
    outletNotVisited: targetRows.filter(k => !visited[k.KodeOutlet]).map(k => ({
      outlet: k.NamaOutlet, kodeOutlet: k.KodeOutlet, kelas: k.Class, area: k.Area,
      qcArea: responsible[k.KodeOutlet] || '-',
      jadwal: (visits.find(v => v._kode === k.KodeOutlet && ['planned', 'rescheduled', 'in progress'].includes(norm_(v['Status']))) || {})._rencana || ''
    })),
    byQCArea: Object.values(byQC).map(q => Object.assign(q, { coverage: q.totalOutlet ? round_(q.visited / q.totalOutlet * 100, 1) : 0 }))
      .sort((a, b) => b.coverage - a.coverage),
    summary: summary
  };
}

/**
 * @param {Object} f {bulan (1-12), tahun, qcArea, periode (jumlah bulan, default 1)}
 * Periode dimulai dari bulan terpilih ke depan, mis. Nov 2026 + 3 bulan = Nov–Jan.
 */
function apiVisitCoverage(token, filters) {
  return run_(token, function (u) {
    const f = filters || {};
    const now = new Date();
    const bln = Number(f.bulan || (now.getMonth() + 1));
    const thn = Number(f.tahun || now.getFullYear());
    const periode = Math.min(Math.max(Number(f.periode || 1), 1), 12);
    const fromYm = thn + '-' + String(bln).padStart(2, '0');
    const res = computeVisitCoverage_(u, fromYm, addYm_(fromYm, periode - 1), f.qcArea);
    res.bulan = bln; res.tahun = thn; res.periodeBulan = periode;
    return res;
  });
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

/** Timeline per hari untuk bulan 'yyyy-MM'. Semua outlet dalam scope ditampilkan. */
function apiVisitTimeline(token, ym) {
  return run_(token, function (u) {
    if (!ym || !/^\d{4}-\d{2}$/.test(String(ym))) throw new Error('VALIDATION_ERROR: Format bulan harus yyyy-MM.');
    const days = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
    const visits = _visitsInScope_(u).filter(r => r._rencana.indexOf(ym) === 0).map(r => ({
      idVisit: String(r['IDVisit']), outlet: r._nama, kodeOutlet: r._kode,
      day: Number(r._rencana.slice(8, 10)) || 0, namaQC: String(r['NamaQCArea'] || ''),
      status: String(r['Status'] || ''), statusEfektif: effectiveVisitStatus_(r), keterangan: String(r['Keterangan'] || '')
    }));
    return {
      ym: ym, days: days,
      outlets: getScope_(u).map(k => ({ nama: k.NamaOutlet, kode: k.KodeOutlet, kelas: k.Class, area: k.Area, qcArea: k.KabagQCArea })),
      visits: visits
    };
  });
}

// ─── Detail ───────────────────────────────────────────────────────────────────

function apiGetVisitDetail(token, id) {
  return run_(token, function (u) {
    required_(id, 'ID Visit');
    const row = getVisits_().find(r => String(r['IDVisit']) === String(id));
    if (!row) throw new Error('NOT_FOUND: Data kunjungan tidak ditemukan.');
    enforceScope_(u, row._kode, row._nama);

    const history = readColumns_('VISIT_HISTORY', ['IDVisit', 'StatusLama', 'StatusBaru', 'Keterangan', 'Timestamp', 'ChangedBy'])
      .filter(h => String(h.IDVisit) === String(id))
      .sort((a, b) => String(a.Timestamp).localeCompare(String(b.Timestamp)))
      .map(h => ({ statusLama: h.StatusLama, statusBaru: h.StatusBaru, keterangan: h.Keterangan, timestamp: String(h.Timestamp), changedBy: h.ChangedBy }));

    let checklist = null;
    const cid = String(row['ChecklistID'] || '').trim();
    if (cid) {
      const h = readTable_('CHECKLIST_HEADER').find(c => String(c['IDChecklist']) === cid);
      if (h) checklist = {
        idChecklist: cid, grade: String(h['Grade'] || ''), gradePercentage: Number(h['GradePercentage'] || 0),
        totalScoreAktual: Number(h['TotalScoreAktual'] || 0), totalScoreMax: Number(h['TotalScoreMax'] || 0),
        submittedAt: String(h['SubmittedAt'] || ''), status: String(h['Status'] || ''),
        statusDokumen: String(h['StatusDokumen'] || (h['FileDocumentID'] ? 'Uploaded' : 'Pending')),
        fileDocumentId: String(h['FileDocumentID'] || '')
      };
    }
    const visit = _mapVisitRow(row);
    const perms = getPerms_(u.role);
    visit.canManage = perms.isAdmin || (perms.isQCArea && isSelf_(u, row['NamaQCArea']));
    return { visit: visit, history: history, checklist: checklist };
  });
}
