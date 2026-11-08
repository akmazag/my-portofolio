/**
 * AccessControl.gs
 * Role-Based Access Control + Scope-Based Data Filtering (server-side).
 * @version 2.0.0
 *
 * ATURAN SCOPE (PRD §3.4) — semua dihitung di server, nilai dari browser tidak dipercaya:
 *
 *  1. Kolom Users.AksesData (opsional) bersifat EKSPLISIT dan MENGGANTIKAN aturan default role.
 *     Token dipisah koma / titik koma:
 *        ALL / *                 → seluruh outlet
 *        AREA:<nama area>        → KODE.Area
 *        RM:<nama> | REGION:<nama> → KODE.RM
 *        AM:<nama>               → KODE.AM
 *        KABAG:<nama> | QCAREA:<nama> → KODE.KabagQCArea
 *        OUTLET:<kode/nama>      → satu outlet
 *        <kode atau nama outlet> → satu outlet (format lama)
 *  2. Bila AksesData kosong → aturan default role:
 *        QC (Admin)  : seluruh outlet
 *        RM          : KODE.RM        = nama user
 *        AM          : KODE.AM        = nama user
 *        Outlet      : Users.KodeOutlet (atau Username bila berupa kode outlet)
 *        QC Area     : KODE.KabagQCArea = nama user  (+ penugasan sheet OP)
 *        Specialist  : KODE.KabagQCArea = nama user
 *  3. Mapping tidak ditemukan → scope KOSONG (akses ditolak), TIDAK PERNAH fallback ke seluruh data.
 *  4. Outlet berstatus Inactive tidak masuk scope (kecuali Admin).
 *  Nama orang dicocokkan secara toleran (spasi/huruf besar diabaikan): "budisantoso" = "Budi Santoso".
 */

// ─── Role helpers ─────────────────────────────────────────────────────────────

function isAdminRole_(role) { return canonRole_(role) === ROLES.QC; }

function requireAdmin_(user) {
  if (!user || !isAdminRole_(user.role)) {
    throw new Error('ACCESS_DENIED: Hanya Admin / QC Office yang dapat melakukan operasi ini.');
  }
}

function enforceRole_(user, allowedRoles) {
  if (!allowedRoles || !allowedRoles.length) return;
  const r = canonRole_(user.role);
  if (!allowedRoles.some(a => canonRole_(a) === r)) {
    throw new Error('ACCESS_DENIED: Role "' + user.role + '" tidak memiliki izin untuk operasi ini.');
  }
}

function requireQC_(user) { enforceRole_(user, [ROLES.QC]); }
function requireChecklistRole_(user) { enforceRole_(user, [ROLES.QC, ROLES.QC_AREA]); }

/** Apakah `name` adalah identitas user (nama atau username)? */
function isSelf_(user, name) {
  const c = compact_(name);
  return !!c && (c === compact_(user.nama) || c === compact_(user.username));
}

// ─── Permission Matrix (PRD §3.2) ─────────────────────────────────────────────

function getPerms_(role) {
  const r = canonRole_(role) || '';
  const isAdm = r === ROLES.QC;
  return {
    role:                 r,
    isAdmin:              isAdm,
    isOutlet:             r === ROLES.OUTLET,
    isQCArea:             r === ROLES.QC_AREA,
    canManageUsers:       isAdm,
    canManageOutlets:     isAdm,
    canManageMaster:      isAdm,
    canManageMasterCheck: isAdm,
    canManageConfig:      isAdm,
    canInputCleaning:     [ROLES.QC, ROLES.QC_AREA, ROLES.OUTLET].includes(r),
    canEditCleaning:      isAdm,                       // edit & hapus transaksi
    canPlanVisit:         [ROLES.QC, ROLES.QC_AREA].includes(r),
    canSubmitChecklist:   [ROLES.QC, ROLES.QC_AREA].includes(r),
    canViewChecklist:     true,
    canViewGrading:       r !== ROLES.OUTLET,
    canViewAuditTrail:    isAdm,
    canViewAllData:       isAdm
  };
}

// ─── Parsing AksesData ────────────────────────────────────────────────────────

/** @returns {Array<{type:string, value:string}>} */
function parseAksesData_(akses) {
  const s = String(akses || '').trim();
  if (!s) return [];
  return s.split(/[,;\n]+/).map(t => t.trim()).filter(Boolean).map(t => {
    if (t === '*' || norm_(t) === 'all') return { type: 'ALL', value: '*' };
    const m = t.match(/^([A-Za-z_ ]+)\s*:\s*(.+)$/);
    if (m) {
      const k = compact_(m[1]);
      const map = { area: 'AREA', rm: 'RM', region: 'RM', regional: 'RM', am: 'AM',
                    kabag: 'KABAG', qcarea: 'KABAG', kabagqcarea: 'KABAG', outlet: 'OUTLET', kode: 'OUTLET' };
      if (map[k]) return { type: map[k], value: m[2].trim() };
    }
    return { type: 'OUTLET', value: t };
  });
}

/** Ambil kode outlet dari daftar token. */
function _outletsByTokens_(tokens, allKode) {
  const set = {};
  const add = r => { if (r.KodeOutlet) set[r.KodeOutlet] = true; };
  tokens.forEach(tk => {
    const v = compact_(tk.value);
    if (tk.type === 'ALL') allKode.forEach(add);
    else if (tk.type === 'AREA') allKode.filter(r => compact_(r.Area) === v).forEach(add);
    else if (tk.type === 'RM') allKode.filter(r => compact_(r.RM) === v).forEach(add);
    else if (tk.type === 'AM') allKode.filter(r => compact_(r.AM) === v).forEach(add);
    else if (tk.type === 'KABAG') allKode.filter(r => compact_(r.KabagQCArea) === v).forEach(add);
    else if (tk.type === 'OUTLET') {
      const r = findOutlet_(tk.value);
      if (r) add(r);
    }
  });
  return Object.keys(set);
}

// ─── Scope Resolution ─────────────────────────────────────────────────────────

/**
 * Hitung daftar kode outlet dalam scope user (tanpa cache).
 * @returns {{codes: string[], source: string}}
 */
function resolveScopeCodes_(user) {
  const master = getMasterCache_();
  const allKode = master.kode;
  const role = canonRole_(user.role);
  const tokens = parseAksesData_(user.aksesData);
  const me = [compact_(user.nama), compact_(user.username)].filter(Boolean);
  const isMe = v => { const c = compact_(v); return !!c && me.indexOf(c) >= 0; };

  if (role === ROLES.QC) return { codes: allKode.map(r => r.KodeOutlet).filter(Boolean), source: 'ADMIN' };
  if (tokens.length) return { codes: _outletsByTokens_(tokens, allKode), source: 'AKSES_DATA' };

  let codes = [];
  if (role === ROLES.RM) codes = allKode.filter(r => isMe(r.RM)).map(r => r.KodeOutlet);
  else if (role === ROLES.AM) codes = allKode.filter(r => isMe(r.AM)).map(r => r.KodeOutlet);
  else if (role === ROLES.OUTLET) {
    const r = findOutlet_(user.kodeOutlet) || findOutlet_(user.username);
    codes = r ? [r.KodeOutlet] : [];
  } else if (role === ROLES.QC_AREA || role === ROLES.SPECIALIST) {
    codes = allKode.filter(r => isMe(r.KabagQCArea)).map(r => r.KodeOutlet);
    if (role === ROLES.QC_AREA) {
      master.op.filter(o => isMe(o.NAMA) && String(o.OUTLET || '').trim()).forEach(o => {
        const r = findOutlet_(o.OUTLET);
        if (r) codes.push(r.KodeOutlet);
      });
    }
  }
  const uniq = {};
  codes.filter(Boolean).forEach(c => { uniq[c] = true; });
  return { codes: Object.keys(uniq), source: 'ROLE_DEFAULT' };
}

/**
 * Baris KODE yang boleh diakses user (cache per user + versi master/users).
 * @returns {Array<Object>}
 */
function getScope_(user) {
  if (!user || !user.username) throw new Error('ACCESS_DENIED: User tidak valid.');
  _EXEC.scope = _EXEC.scope || {};
  const memo = norm_(user.username);
  if (_EXEC.scope[memo]) return _EXEC.scope[memo];

  const key = CACHE_KEY_SCOPE_PREFIX + compact_(user.username) + '_' + dataVersion_('master', 'users');
  const codes = cached_(key, CACHE_TTL_SCOPE, () => resolveScopeCodes_(user).codes);
  const idx = getOutletIndex_();
  const admin = isAdminRole_(user.role);
  const rows = codes.map(c => idx['k:' + norm_(c)]).filter(r => r && (admin || norm_(r.StatusOutlet) !== 'inactive'));
  _EXEC.scope[memo] = rows;
  return rows;
}

/** Peta norm(kode) & norm(nama) → row KODE dalam scope. */
function scopeMap_(arg) {
  const rows = Array.isArray(arg) ? arg : (arg && arg.username ? getScope_(arg) : []);
  const map = {};
  rows.forEach(row => {
    const kn = norm_(row.NamaOutlet), kk = norm_(row.KodeOutlet);
    if (kn && !map[kn]) map[kn] = row;
    if (kk) map[kk] = row;
  });
  return map;
}

/** Outlet dalam scope berdasarkan kode lalu nama (null bila di luar scope). */
function outletInScope_(sm, kode, nama) {
  return (kode && sm[norm_(kode)]) || (nama && sm[norm_(nama)]) || null;
}

/** Throw ACCESS_DENIED bila outlet di luar scope. @returns row KODE */
function enforceScope_(user, outletRef, outletName) {
  if (!outletRef && !outletName) throw new Error('ACCESS_DENIED: Outlet tidak ditentukan.');
  const row = outletInScope_(scopeMap_(user), outletRef, outletName);
  if (!row) throw new Error('ACCESS_DENIED: Anda tidak memiliki akses ke outlet "' + (outletName || outletRef) + '".');
  return row;
}

function hasScope_(user, outletRef) {
  try { enforceScope_(user, outletRef); return true; } catch (e) { return false; }
}
