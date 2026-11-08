/**
 * AuditLogService.gs
 * Audit trail ke sheet AUDIT_LOG.
 * Kegagalan audit TIDAK boleh menggagalkan operasi utama.
 * @version 2.0.0
 *
 * Catatan v2: tidak lagi memakai ScriptLock (v1 memakai lock yang sama dengan
 * operasi utama sehingga audit sering terlewat). Penulisan memakai appendRow
 * yang atomik di sisi Google Sheets.
 */

const _AUDIT_MAX_DATA_LEN = 1500;

function _auditSerialize_(d) {
  if (d === undefined || d === null || d === '') return '';
  let str;
  try { str = typeof d === 'string' ? d : JSON.stringify(d); } catch (e) { str = String(d); }
  return str.length > _AUDIT_MAX_DATA_LEN ? str.substring(0, _AUDIT_MAX_DATA_LEN) + '…[truncated]' : str;
}

/**
 * @param {Object} user       {username, nama, role}
 * @param {string} aksi       mis. CREATE_CLEANING
 * @param {string} entityType nama sheet / modul
 * @param {string} entityId
 * @param {*} dataBefore
 * @param {*} dataAfter
 */
function auditLog_(user, aksi, entityType, entityId, dataBefore, dataAfter) {
  try {
    appendRow_('AUDIT_LOG', {
      IDLog:       uuid_(),
      Timestamp:   fmtDateTime_(new Date()),
      UserID:      user ? String(user.username || user.Username || '') : 'SYSTEM',
      NamaUser:    user ? String(user.nama || user.Nama || '') : 'SYSTEM',
      Aksi:        String(aksi || '').toUpperCase(),
      EntityType:  String(entityType || ''),
      EntityID:    String(entityId || ''),
      DataSebelum: _auditSerialize_(dataBefore),
      DataSesudah: _auditSerialize_(dataAfter),
      Role:        user ? String(user.role || '') : ''
    });
  } catch (e) {
    Logger.log('[auditLog_] GAGAL: %s %s %s | %s', aksi, entityType, entityId, e.message);
  }
}

function auditCreate_(user, entityType, entityId, newData) { auditLog_(user, 'CREATE', entityType, entityId, null, newData); }
function auditUpdate_(user, entityType, entityId, oldData, newData) { auditLog_(user, 'UPDATE', entityType, entityId, oldData, newData); }
function auditDelete_(user, entityType, entityId, deletedData) { auditLog_(user, 'DELETE', entityType, entityId, deletedData, null); }

function auditAuth_(aksi, username, nama, info) {
  auditLog_({ username: username, nama: nama, role: info && info.role ? info.role : '' }, aksi, 'AUTH', username, null, info || null);
}

/**
 * Aktivitas terbaru. Admin: semua; selain admin: hanya aktivitas miliknya.
 * Selective fetch: hanya membaca 400 baris terakhir.
 */
function recentActivity_(user, limit) {
  limit = limit || 10;
  let rows = [];
  try {
    rows = readColumns_('AUDIT_LOG', ['IDLog', 'Timestamp', 'UserID', 'NamaUser', 'Aksi', 'EntityType', 'EntityID'], { lastN: 400 });
  } catch (e) { return []; }
  if (!isAdminRole_(user.role)) rows = rows.filter(r => norm_(r.UserID) === norm_(user.username));
  return rows.slice(-limit).reverse().map(l => ({
    idLog: l.IDLog, timestamp: String(l.Timestamp || ''), user: l.NamaUser || l.UserID || 'System',
    aksi: l.Aksi, entity: l.EntityType, entityId: isAdminRole_(user.role) ? l.EntityID : ''
  }));
}

/** API: audit trail (Admin) dengan filter sederhana. */
function apiGetAuditLog(token, f) {
  return run_(token, (u) => {
    requireAdmin_(u);
    f = f || {};
    let rows = readColumns_('AUDIT_LOG', ['Timestamp', 'UserID', 'NamaUser', 'Aksi', 'EntityType', 'EntityID', 'DataSebelum', 'DataSesudah'], { lastN: 2000 });
    if (f.aksi) rows = rows.filter(r => norm_(r.Aksi).indexOf(norm_(f.aksi)) >= 0);
    if (f.user) rows = rows.filter(r => norm_(r.UserID).indexOf(norm_(f.user)) >= 0 || norm_(r.NamaUser).indexOf(norm_(f.user)) >= 0);
    return { rows: rows.slice(-300).reverse() };
  });
}
