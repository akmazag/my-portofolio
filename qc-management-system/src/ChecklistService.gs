/**
 * ChecklistService.gs
 * Digital QC Checklist (MASTER_CHECK → CHECKLIST_HEADER + CHECKLIST_DETAIL + FILE_DOCUMENT).
 * @version 2.0.0
 *
 * Alur (PRD §9.3): Visit "In Progress" → pilih kategori → skor 1..ScoreMax / N/A → submit
 *   → Visit "Completed" → PDF bukti (boleh diunggah saat submit atau menyusul).
 * Skor: Grade% = Σ skor aktual / Σ skor maksimum (item N/A dikecualikan dari keduanya).
 *
 * Perbaikan v2:
 *   - MASTER_CHECK kosong → otomatis memakai sheet lama "MASTER CHECK" (KATEGORI, Item Pengecekan, role)
 *     dengan ID deterministik; menu "Migrasi Master Checklist" menyalinnya secara permanen.
 *   - Kategori dinormalisasi: "F&B" = "FnB" = "FB"; Cinema; Premiere.
 *   - Bug v1: ID dokumen PDF tidak tersimpan (docResult.documentId undefined) → diperbaiki.
 *   - Kegagalan upload PDF tidak lagi membatalkan checklist (status dokumen terpisah).
 *   - QC Area hanya dapat mengisi checklist untuk kunjungan miliknya.
 */

/** Kategori kanonik: Cinema | F&B | Premiere | (teks asli). */
function canonKategori_(k) {
  const c = compact_(k);
  if (!c) return '';
  if (c === 'fb' || c === 'fnb' || c.indexOf('food') >= 0 || c === 'cafe' || c === 'fandb') return 'F&B';
  if (c.indexOf('cinema') >= 0 || c === 'bioskop' || c === 'theatre') return 'Cinema';
  if (c.indexOf('premier') >= 0) return 'Premiere';
  return String(k).trim();
}

/** ID deterministik untuk item legacy (stabil terhadap urutan baris). */
function _legacyCheckId_(kategori, aspek, item) {
  return 'MC-' + sha256_(canonKategori_(kategori) + '|' + norm_(aspek) + '|' + norm_(item)).slice(0, 10).toUpperCase();
}

/** Baca sheet legacy "MASTER CHECK" (format lama). */
function _readLegacyMasterCheck_() {
  const sh = getSheetExact_('MASTER CHECK');
  if (!sh || sh.getLastRow() < 2) return [];
  const vals = sh.getRange(1, 1, sh.getLastRow(), Math.max(3, sh.getLastColumn())).getValues();
  const h = vals[0].map(x => compact_(x));
  const iAspek = h.findIndex(x => x === 'kategori' || x === 'aspek');
  const iItem  = h.findIndex(x => x.indexOf('item') >= 0 || x === 'namachecklist');
  const iRole  = h.findIndex(x => x === 'role' || x === 'tipe');
  if (iItem < 0) return [];
  const out = [];
  for (let r = 1; r < vals.length; r++) {
    const item = String(vals[r][iItem] || '').trim();
    if (!item) continue;
    const aspek = iAspek >= 0 ? String(vals[r][iAspek] || '').trim() : '';
    const kat = canonKategori_(iRole >= 0 ? vals[r][iRole] : 'Cinema') || 'Cinema';
    out.push({ idCheck: _legacyCheckId_(kat, aspek, item), kategori: kat, aspek: aspek, namaChecklist: item,
               deskripsi: '', bobot: 1, scoreMax: 5, statusAktif: true, urutanTampilan: r, legacy: true });
  }
  return out;
}

function _mapMasterItem_(r) {
  const max = Number(r['ScoreMax']);
  return {
    idCheck:        String(r['IDCheck'] || ''),
    kategori:       canonKategori_(r['Kategori']),
    aspek:          String(r['Aspek'] || '').trim(),
    namaChecklist:  String(r['NamaChecklist'] || ''),
    deskripsi:      String(r['Deskripsi'] || ''),
    bobot:          Number(r['Bobot'] || 1) || 1,
    scoreMax:       (isFinite(max) && max >= 1 && max <= 10) ? max : 5,
    statusAktif:    isTrue_(r['StatusAktif']),
    urutanTampilan: Number(r['UrutanTampilan'] || 0) || 0
  };
}

/** Seluruh item master checklist (cache per versi). */
function getMasterCheckItems_() {
  if (_EXEC.masterCheck) return _EXEC.masterCheck;
  const key = 'mastercheck_' + dataVersion_('mastercheck');
  _EXEC.masterCheck = cached_(key, CACHE_TTL_MASTER, function () {
    let items = [];
    try { items = readTable_('MASTER_CHECK').map(_mapMasterItem_).filter(i => i.idCheck && i.namaChecklist); } catch (e) {}
    if (!items.length) items = _readLegacyMasterCheck_();
    return items.sort((a, b) => (a.urutanTampilan || 999) - (b.urutanTampilan || 999));
  });
  return _EXEC.masterCheck;
}

// ─── API: Item Checklist ──────────────────────────────────────────────────────

/** @param {string[]} kategori mis. ['Cinema','F&B'] — gabungan tanpa duplikasi. */
function apiChecklistItems(token, outlet, kategori) {
  return run_(token, function (u) {
    required_(outlet, 'Outlet');
    enforceScope_(u, String(outlet).trim(), String(outlet).trim());
    const kats = (Array.isArray(kategori) ? kategori : (kategori ? [kategori] : [])).map(canonKategori_);
    const seen = {};
    const items = getMasterCheckItems_().filter(i => {
      if (!i.statusAktif || seen[i.idCheck]) return false;
      if (kats.length && kats.indexOf(i.kategori) < 0) return false;
      seen[i.idCheck] = true;
      return true;
    });
    return { total: items.length, items: items, kategoriTersedia: [...new Set(getMasterCheckItems_().filter(i => i.statusAktif).map(i => i.kategori))] };
  });
}

// ─── Draft ────────────────────────────────────────────────────────────────────

function apiSaveDraft(token, p) {
  return run_(token, function (u) {
    p = p || {};
    required_(p.idVisit, 'ID Visit');
    required_(p.outlet, 'Outlet');
    enforceScope_(u, String(p.outlet).trim(), String(p.outlet).trim());
    const data = {
      idVisit: String(p.idVisit), outlet: String(p.outlet), tanggal: p.tanggal || todayStr_(),
      kategori: Array.isArray(p.kategori) ? p.kategori : [], items: Array.isArray(p.items) ? p.items.slice(0, 500) : [],
      savedAt: fmtDateTime_(new Date()), savedBy: u.username
    };
    const s = JSON.stringify(data);
    if (s.length > 95000) throw new Error('VALIDATION_ERROR: Data draft terlalu besar.');
    CacheService.getScriptCache().put('DRAFT_' + compact_(u.username), s, 21600);
    return { savedAt: data.savedAt };
  });
}

function apiGetDraft(token) {
  return run_(token, function (u) {
    const raw = CacheService.getScriptCache().get('DRAFT_' + compact_(u.username));
    if (!raw) return { draft: null };
    try { return { draft: JSON.parse(raw) }; } catch (e) { return { draft: null }; }
  });
}

// ─── Submit ───────────────────────────────────────────────────────────────────

/**
 * @param {Object} p {idVisit, outlet, tanggal, kategori[], items:[{idItem, score, isNA, catatanTemuan}], pdf:{name, base64}}
 */
function apiSubmitChecklist(token, p) {
  return run_(token, function (u) {
    if (!getPerms_(u.role).canSubmitChecklist) {
      throw new Error('ACCESS_DENIED: Hanya QC Area atau QC Office yang dapat mengirim checklist.');
    }
    p = p || {};
    required_(p.idVisit, 'ID Visit');
    required_(p.tanggal, 'Tanggal');
    if (!Array.isArray(p.items) || !p.items.length) throw new Error('VALIDATION_ERROR: Daftar item checklist tidak boleh kosong.');
    if (p.items.length > 500) throw new Error('VALIDATION_ERROR: Jumlah item terlalu banyak.');
    const tgl = toDate_(p.tanggal);
    if (!tgl) throw new Error('VALIDATION_ERROR: Tanggal pemeriksaan tidak valid.');
    const tanggal = fmtDate_(tgl);
    if (tanggal > todayStr_()) throw new Error('VALIDATION_ERROR: Tanggal pemeriksaan tidak boleh melebihi hari ini.');

    // Validasi item terhadap master (ID, skor 1..ScoreMax, N/A)
    const master = {};
    getMasterCheckItems_().forEach(m => { master[m.idCheck] = m; });
    const seen = {};
    const clean = p.items.map((it, i) => {
      const m = master[String(it.idItem || '')];
      if (!m) throw new Error('VALIDATION_ERROR: Item ke-' + (i + 1) + ' tidak terdaftar di Master Checklist. Muat ulang form.');
      if (seen[m.idCheck]) throw new Error('VALIDATION_ERROR: Item "' + m.namaChecklist + '" terkirim lebih dari sekali.');
      seen[m.idCheck] = true;
      const isNA = it.isNA === true || norm_(it.isNA) === 'true';
      let score = null;
      if (!isNA) {
        score = Number(it.score);
        if (it.score === null || it.score === '' || !Number.isInteger(score) || score < 1 || score > m.scoreMax) {
          throw new Error('VALIDATION_ERROR: Item "' + m.namaChecklist + '" wajib bernilai 1–' + m.scoreMax + ' atau N/A.');
        }
      }
      return { m: m, isNA: isNA, score: score, catatan: sanitizeStr_(it.catatanTemuan || it.catatan || ''), ket: sanitizeStr_(it.keterangan || '') };
    });

    let aktual = 0, maks = 0;
    clean.forEach(c => { if (!c.isNA) { aktual += c.score; maks += c.m.scoreMax; } });
    if (maks <= 0) throw new Error('VALIDATION_ERROR: Minimal satu item harus dinilai (tidak seluruhnya N/A).');
    const pct = round_(aktual / maks * 100, 2);
    const grade = calculateGrade_(pct);
    const kategoriText = [...new Set(clean.map(c => c.m.kategori))].join(', ');
    const idChecklist = uuid_();
    const now = fmtDateTime_(new Date());
    let visitRow;

    withLock_(() => {
      _EXEC.visits = null; _execInvalidate_('LOG_VISIT');
      visitRow = getVisits_().find(r => String(r['IDVisit']) === String(p.idVisit));
      if (!visitRow) throw new Error('NOT_FOUND: Data kunjungan tidak ditemukan.');
      enforceScope_(u, visitRow._kode, visitRow._nama);
      if (p.outlet && norm_(p.outlet) !== norm_(visitRow._nama) && norm_(p.outlet) !== norm_(visitRow._kode)) {
        throw new Error('VALIDATION_ERROR: Outlet tidak sesuai dengan data kunjungan.');
      }
      if (canonRole_(u.role) === ROLES.QC_AREA && !isSelf_(u, visitRow['NamaQCArea'])) {
        throw new Error('ACCESS_DENIED: Checklist hanya dapat diisi oleh QC Area yang ditugaskan pada kunjungan ini.');
      }
      const st = norm_(visitRow['Status']);
      if (st === 'completed' || String(visitRow['ChecklistID'] || '').trim()) {
        throw new Error('VALIDATION_ERROR: Kunjungan ini sudah selesai dan checklist-nya sudah terkirim.');
      }
      if (st !== 'in progress') {
        throw new Error('VALIDATION_ERROR: Checklist hanya dapat diisi untuk kunjungan berstatus "In Progress". Mulai kunjungan di menu Visit.');
      }
      const dup = readColumns_('CHECKLIST_HEADER', ['IDChecklist', 'IDVisit', 'Status'])
        .find(h => String(h.IDVisit) === String(p.idVisit) && norm_(h.Status) !== 'deleted');
      if (dup) throw new Error('VALIDATION_ERROR: Checklist untuk kunjungan ini sudah pernah dikirim.');

      appendRow_('CHECKLIST_HEADER', {
        IDChecklist: idChecklist, IDVisit: String(p.idVisit), QCArea: String(visitRow['NamaQCArea'] || u.nama),
        Outlet: visitRow._nama, KodeOutlet: visitRow._kode, Tanggal: tanggal,
        Region: String(visitRow['Region'] || ''), Area: String(visitRow['Area'] || ''),
        TipeOutlet: (findOutlet_(visitRow._kode) || {}).Class || '', Kategori: kategoriText,
        TotalScoreAktual: aktual, TotalScoreMax: maks, GradePercentage: pct, Grade: grade,
        FileDocumentID: '', Status: 'Submitted', StatusDokumen: 'Pending',
        CreatedAt: now, CreatedBy: u.username, SubmittedAt: now
      });
      appendRows_('CHECKLIST_DETAIL', clean.map(c => ({
        IDDetail: uuid_(), IDChecklist: idChecklist, IDItem: c.m.idCheck, Kategori: c.m.kategori,
        NamaItem: c.m.aspek ? (c.m.aspek + ' — ' + c.m.namaChecklist) : c.m.namaChecklist,
        Score: c.isNA ? '' : c.score, ScoreMax: c.isNA ? '' : c.m.scoreMax, IsNA: c.isNA ? 'TRUE' : 'FALSE',
        Keterangan: c.ket, CatatanTemuan: c.catatan, CreatedAt: now
      })));
      updateRow_('LOG_VISIT', visitRow.__rowIndex, {
        ChecklistID: idChecklist, Status: 'Completed', TanggalRealisasi: tanggal, UpdatedAt: now, UpdatedBy: u.username
      });
      _appendVisitHistory(String(p.idVisit), String(visitRow['Status'] || ''), 'Completed', 'Checklist dikirim', u.username);
    });
    bumpVersion_('checklist', 'visit');
    CacheService.getScriptCache().remove('DRAFT_' + compact_(u.username));
    auditLog_(u, 'SUBMIT_CHECKLIST', 'CHECKLIST_HEADER', idChecklist, null,
      { idVisit: p.idVisit, outlet: visitRow._kode, grade: grade, pct: pct, items: clean.length });

    // Upload PDF DI LUAR lock — kegagalan tidak membatalkan checklist
    let docInfo = null, docWarning = '';
    if (p.pdf && p.pdf.base64) {
      try { docInfo = _attachChecklistPdf_(u, idChecklist, p.pdf); } catch (e) {
        docWarning = 'Checklist tersimpan, tetapi upload PDF gagal: ' + String(e.message).replace(/^[A-Z_]+:\s*/, '') +
                     '. Unggah ulang melalui menu Riwayat → Rincian.';
        try { _setChecklistDocStatus_(idChecklist, 'Failed', ''); } catch (e2) {}
      }
    }
    return { idChecklist: idChecklist, grade: grade, gradePercentage: pct, totalScoreAktual: aktual, totalScoreMax: maks,
             statusDokumen: docInfo ? 'Uploaded' : (docWarning ? 'Failed' : 'Pending'), warning: docWarning,
             pesan: 'Checklist berhasil dikirim.' };
  });
}

function _setChecklistDocStatus_(idChecklist, status, docId) {
  const h = readColumns_('CHECKLIST_HEADER', ['IDChecklist']).find(r => String(r.IDChecklist) === String(idChecklist));
  if (!h) throw new Error('NOT_FOUND: Checklist tidak ditemukan.');
  const upd = { StatusDokumen: status };
  if (docId) upd.FileDocumentID = docId;
  updateRow_('CHECKLIST_HEADER', h.__rowIndex, upd);
  bumpVersion_('checklist');
}

function _attachChecklistPdf_(u, idChecklist, pdf) {
  const doc = uploadPDF_(u, pdf.base64, pdf.name, idChecklist, 'CHECKLIST');
  _setChecklistDocStatus_(idChecklist, 'Uploaded', doc.idDocument);
  auditLog_(u, 'UPLOAD_PDF', 'FILE_DOCUMENT', doc.idDocument, null, { idChecklist: idChecklist, size: doc.size });
  return doc;
}

/** Unggah / ganti PDF untuk checklist yang sudah dikirim (status Pending/Failed). */
function apiUploadChecklistPDF(token, idChecklist, pdf) {
  return run_(token, function (u) {
    if (!getPerms_(u.role).canSubmitChecklist) throw new Error('ACCESS_DENIED: Role Anda tidak dapat mengunggah dokumen.');
    required_(idChecklist, 'ID Checklist');
    if (!pdf || !pdf.base64) throw new Error('VALIDATION_ERROR: Pilih berkas PDF terlebih dahulu.');
    const h = readTable_('CHECKLIST_HEADER').find(r => String(r['IDChecklist']) === String(idChecklist));
    if (!h) throw new Error('NOT_FOUND: Checklist tidak ditemukan.');
    enforceScope_(u, h['KodeOutlet'], h['Outlet']);
    if (canonRole_(u.role) === ROLES.QC_AREA && !isSelf_(u, h['QCArea'])) {
      throw new Error('ACCESS_DENIED: Hanya QC Area pemeriksa yang dapat mengunggah dokumen ini.');
    }
    const doc = _attachChecklistPdf_(u, idChecklist, pdf);
    return { idDocument: doc.idDocument, statusDokumen: 'Uploaded' };
  });
}

// ─── Detail ───────────────────────────────────────────────────────────────────

function _mapHeader_(h) {
  const docId = String(h['FileDocumentID'] || '');
  return {
    idChecklist: String(h['IDChecklist'] || ''), idVisit: String(h['IDVisit'] || ''), qcArea: String(h['QCArea'] || ''),
    outlet: String(h['Outlet'] || ''), kodeOutlet: String(h['KodeOutlet'] || ''), tanggal: String(h['Tanggal'] || ''),
    region: String(h['Region'] || ''), area: String(h['Area'] || ''), tipeOutlet: String(h['TipeOutlet'] || ''),
    kategori: String(h['Kategori'] || ''), totalScoreAktual: Number(h['TotalScoreAktual'] || 0),
    totalScoreMax: Number(h['TotalScoreMax'] || 0), gradePercentage: Number(h['GradePercentage'] || 0),
    grade: String(h['Grade'] || ''), status: String(h['Status'] || ''), submittedAt: String(h['SubmittedAt'] || ''),
    createdBy: String(h['CreatedBy'] || ''), fileDocumentId: docId,
    statusDokumen: String(h['StatusDokumen'] || (docId ? 'Uploaded' : 'Pending'))
  };
}

function apiGetChecklistDetail(token, idChecklist) {
  return run_(token, function (u) {
    required_(idChecklist, 'ID Checklist');
    const hdr = readTable_('CHECKLIST_HEADER').find(h => String(h['IDChecklist']) === String(idChecklist));
    if (!hdr) throw new Error('NOT_FOUND: Checklist tidak ditemukan.');
    enforceScope_(u, hdr['KodeOutlet'], hdr['Outlet']);
    const details = readTable_('CHECKLIST_DETAIL').filter(d => String(d['IDChecklist']) === String(idChecklist)).map(d => {
      const na = isTrue_(d['IsNA']);
      return { idDetail: String(d['IDDetail'] || ''), idItem: String(d['IDItem'] || ''), kategori: String(d['Kategori'] || ''),
               namaItem: String(d['NamaItem'] || ''), score: na ? null : Number(d['Score'] || 0),
               scoreMax: na ? null : Number(d['ScoreMax'] || 5), isNA: na,
               keterangan: String(d['Keterangan'] || ''), catatanTemuan: String(d['CatatanTemuan'] || '') };
    });
    const header = _mapHeader_(hdr);
    let dokumen = null;
    if (header.fileDocumentId) {
      const doc = getDocument_(header.fileDocumentId);
      if (doc) dokumen = { idDocument: String(doc['IDDocument']), namaFile: String(doc['NamaFile'] || ''), tipeFile: 'PDF',
                           uploadedAt: String(doc['UploadedAt'] || '') };
    }
    const perms = getPerms_(u.role);
    return { header: header, details: details, dokumen: dokumen,
             canUpload: perms.isAdmin || (perms.isQCArea && isSelf_(u, header.qcArea)) };
  });
}

function apiGetChecklistByVisit(token, idVisit) {
  return run_(token, function (u) {
    required_(idVisit, 'ID Visit');
    const hdr = readTable_('CHECKLIST_HEADER').find(h => String(h['IDVisit']) === String(idVisit) && norm_(h['Status']) !== 'deleted');
    if (!hdr) return { checklist: null };
    enforceScope_(u, hdr['KodeOutlet'], hdr['Outlet']);
    return { checklist: _mapHeader_(hdr) };
  });
}

// ─── Master Check (Admin) ─────────────────────────────────────────────────────

function apiGetMasterCheck(token) {
  return run_(token, function (u) {
    const items = getMasterCheckItems_();
    return { total: items.length, items: items, sumberLegacy: items.length > 0 && !!items[0].legacy };
  });
}

function apiSaveMasterCheck(token, item) {
  return run_(token, function (u) {
    requireAdmin_(u);
    item = item || {};
    required_(item.namaChecklist, 'Nama checklist');
    required_(item.kategori, 'Kategori');
    const kategori = canonKategori_(item.kategori);
    if (ENUM.KATEGORI_CHECK.indexOf(kategori) < 0) {
      throw new Error('VALIDATION_ERROR: Kategori harus salah satu dari: ' + ENUM.KATEGORI_CHECK.join(', ') + '.');
    }
    const scoreMax = Number(item.scoreMax || 5);
    if (!Number.isInteger(scoreMax) || scoreMax < 1 || scoreMax > 10) throw new Error('VALIDATION_ERROR: Skor maksimum harus 1–10.');
    if (getMasterCheckItems_().length && getMasterCheckItems_()[0].legacy) {
      migrateMasterCheckLegacy_(u);   // pastikan data lama tersalin dulu agar ID tidak hilang
    }
    const res = withLock_(() => {
      const rows = readTable_('MASTER_CHECK');
      const ex = item.idCheck ? rows.find(r => String(r['IDCheck']) === String(item.idCheck)) : null;
      const payload = {
        IDCheck: ex ? String(ex['IDCheck']) : 'MC-' + uuid_().replace(/-/g, '').slice(0, 10).toUpperCase(),
        Kategori: kategori, Aspek: sanitizeStr_(item.aspek || ''), NamaChecklist: sanitizeStr_(item.namaChecklist),
        Deskripsi: sanitizeStr_(item.deskripsi || ''), Bobot: Number(item.bobot || 1) || 1, ScoreMax: scoreMax,
        StatusAktif: item.statusAktif === false || norm_(item.statusAktif) === 'false' ? 'FALSE' : 'TRUE',
        UrutanTampilan: Number(item.urutanTampilan || rows.length + 1)
      };
      if (ex) updateRow_('MASTER_CHECK', ex.__rowIndex, payload); else appendRow_('MASTER_CHECK', payload);
      return { ex: ex, payload: payload };
    });
    bumpVersion_('mastercheck');
    auditLog_(u, res.ex ? 'UPDATE_MASTER_CHECK' : 'CREATE_MASTER_CHECK', 'MASTER_CHECK', res.payload.IDCheck,
      res.ex ? { nama: res.ex['NamaChecklist'], aktif: res.ex['StatusAktif'] } : null, res.payload);
    return { saved: true, idCheck: res.payload.IDCheck };
  });
}

/**
 * Salin item dari sheet legacy "MASTER CHECK" ke MASTER_CHECK (sekali, tidak menghapus data lama).
 * @returns {number} jumlah item yang disalin
 */
function migrateMasterCheckLegacy_(user) {
  const legacy = _readLegacyMasterCheck_();
  if (!legacy.length) return 0;
  return withLock_(() => {
    const existing = {};
    readTable_('MASTER_CHECK').forEach(r => { existing[String(r['IDCheck'])] = true; });
    const toAdd = legacy.filter(i => !existing[i.idCheck]).map(i => ({
      IDCheck: i.idCheck, Kategori: i.kategori, Aspek: i.aspek, NamaChecklist: i.namaChecklist, Deskripsi: '',
      Bobot: 1, ScoreMax: 5, StatusAktif: 'TRUE', UrutanTampilan: i.urutanTampilan
    }));
    if (toAdd.length) appendRows_('MASTER_CHECK', toAdd);
    bumpVersion_('mastercheck');
    if (toAdd.length) auditLog_(user || null, 'MIGRATE_MASTER_CHECK', 'MASTER_CHECK', '', null, { jumlah: toAdd.length });
    return toAdd.length;
  });
}

/** Menu admin. */
function migrateMasterCheckLegacy() {
  const n = migrateMasterCheckLegacy_(null);
  try { SpreadsheetApp.getUi().alert('✅ ' + n + ' item master checklist disalin dari sheet "MASTER CHECK".'); } catch (e) {}
  return n;
}
