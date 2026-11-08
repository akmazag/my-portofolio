/**
 * DriveService.gs
 * Penyimpanan PDF bukti kunjungan di Google Drive + metadata FILE_DOCUMENT.
 * @version 2.0.0
 *
 * KEAMANAN (PRD §13.1 #6):
 *  - File TIDAK dibagikan publik ("Anyone with link" dihapus pada v2).
 *  - File hanya dapat dibuka melalui apiGetDocumentFile() yang memeriksa sesi
 *    dan scope outlet terlebih dahulu. Web App dijalankan sebagai pemilik script,
 *    sehingga pengguna tidak memerlukan akses Drive langsung.
 */

/** Folder Drive penyimpanan PDF (dibuat sekali, ID disimpan di Script Properties). */
function getPdfFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('PDF_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) {
      Logger.log('[getPdfFolder_] Folder lama tidak ditemukan: %s', e.message);
    }
  }
  const it = DriveApp.getFoldersByName(PDF_FOLDER_NAME);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(PDF_FOLDER_NAME);
  props.setProperty('PDF_FOLDER_ID', folder.getId());
  return folder;
}

/** Menu admin: siapkan folder PDF. */
function setupPdfFolder() {
  const f = getPdfFolder_();
  try { SpreadsheetApp.getUi().alert('📁 Folder PDF siap: ' + f.getName()); } catch (e) {}
  return f.getId();
}

/**
 * Validasi & simpan PDF.
 * @param {Object} user
 * @param {string} base64
 * @param {string} filename
 * @param {string} referenceId   IDChecklist / IDVisit
 * @param {string} referenceType 'CHECKLIST' | 'VISIT'
 */
function uploadPDF_(user, base64, filename, referenceId, referenceType) {
  if (!base64) throw new Error('VALIDATION_ERROR: Konten berkas PDF kosong.');
  const safeName = String(filename || ('Dokumen_' + (referenceId || 'QC') + '.pdf')).replace(/[^\w.\- ()]/g, '_').slice(0, 120);
  if (!/\.pdf$/i.test(safeName)) throw new Error('VALIDATION_ERROR: Berkas harus berformat PDF (.pdf).');

  let bytes;
  try { bytes = Utilities.base64Decode(String(base64).replace(/^data:[^,]+,/, '')); } catch (e) {
    throw new Error('VALIDATION_ERROR: Data berkas tidak valid.');
  }
  const maxBytes = getConfigNum_('max_pdf_mb', 10) * 1024 * 1024;
  if (bytes.length > maxBytes) {
    throw new Error('VALIDATION_ERROR: Ukuran berkas melebihi batas ' + getConfigNum_('max_pdf_mb', 10) + ' MB.');
  }
  // Magic number PDF: "%PDF"
  if (bytes.length < 5 || bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46) {
    throw new Error('VALIDATION_ERROR: Isi berkas bukan PDF yang valid.');
  }

  const prefixedName = (referenceId ? String(referenceId).slice(0, 8) + '_' : '') + safeName;
  const file = getPdfFolder_().createFile(Utilities.newBlob(bytes, 'application/pdf', prefixedName));
  const idDocument = uuid_();
  appendRow_('FILE_DOCUMENT', {
    IDDocument:    idDocument,
    IDReferensi:   referenceId || '',
    TipeReferensi: referenceType || 'CHECKLIST',
    NamaFile:      prefixedName,
    DriveFileID:   file.getId(),
    DriveURL:      file.getUrl(),
    TipeFile:      'PDF',
    UkuranBytes:   bytes.length,
    UploadedAt:    fmtDateTime_(new Date()),
    UploadedBy:    user ? user.username : 'SYSTEM'
  });
  return { idDocument: idDocument, documentId: idDocument, driveFileId: file.getId(), filename: prefixedName, size: bytes.length };
}

function getDocument_(idDocument) {
  if (!idDocument) return null;
  return readTable_('FILE_DOCUMENT').find(d => String(d['IDDocument']) === String(idDocument)) || null;
}

/** Pastikan user berhak atas dokumen (melalui outlet checklist / visit). */
function _enforceDocumentScope_(user, doc) {
  const refId = String(doc['IDReferensi'] || '');
  const type  = norm_(doc['TipeReferensi']);
  let kode = '', nama = '';
  if (type === 'visit') {
    const v = readTable_('LOG_VISIT').find(r => String(r['IDVisit']) === refId);
    if (v) { kode = v['KodeOutlet']; nama = v['NamaOutlet']; }
  } else {
    const h = readTable_('CHECKLIST_HEADER').find(r => String(r['IDChecklist']) === refId);
    if (h) { kode = h['KodeOutlet']; nama = h['Outlet']; }
  }
  if (!kode && !nama) throw new Error('ACCESS_DENIED: Referensi dokumen tidak ditemukan.');
  enforceScope_(user, kode, nama);
}

/** Metadata dokumen (tanpa URL Drive). */
function apiGetDocument(token, idDocument) {
  return run_(token, function (u) {
    required_(idDocument, 'ID Dokumen');
    const doc = getDocument_(idDocument);
    if (!doc) throw new Error('NOT_FOUND: Dokumen tidak ditemukan.');
    _enforceDocumentScope_(u, doc);
    return { idDocument: doc['IDDocument'], namaFile: doc['NamaFile'], ukuran: Number(doc['UkuranBytes'] || 0),
             uploadedAt: doc['UploadedAt'], uploadedBy: doc['UploadedBy'] };
  });
}

/** Isi file PDF (base64) setelah validasi scope. */
function apiGetDocumentFile(token, idDocument) {
  return run_(token, function (u) {
    required_(idDocument, 'ID Dokumen');
    const doc = getDocument_(idDocument);
    if (!doc) throw new Error('NOT_FOUND: Dokumen tidak ditemukan.');
    _enforceDocumentScope_(u, doc);
    let blob;
    try { blob = DriveApp.getFileById(String(doc['DriveFileID'])).getBlob(); } catch (e) {
      throw new Error('NOT_FOUND: Berkas di Google Drive tidak ditemukan atau telah dihapus.');
    }
    auditLog_(u, 'VIEW_DOCUMENT', 'FILE_DOCUMENT', doc['IDDocument'], null, null);
    return { name: String(doc['NamaFile'] || 'dokumen.pdf'), mimeType: 'application/pdf',
             base64: Utilities.base64Encode(blob.getBytes()) };
  });
}
