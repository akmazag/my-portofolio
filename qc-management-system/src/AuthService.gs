/**
 * AuthService.gs
 * Login, logout, bootstrap aplikasi, ganti password, dan manajemen user.
 * @version 2.0.0
 */

// ─── API: Login ───────────────────────────────────────────────────────────────

/**
 * @param {string} username
 * @param {string} password
 * @returns {{ok, data:{token}}}
 */
function apiLogin(username, password) {
  return runPublic_(() => {
    const uname = String(username || '').trim();
    const pass  = String(password || '');
    if (!uname || !pass) throw new Error('VALIDATION_ERROR: Username dan password wajib diisi.');
    if (uname.length > 80 || pass.length > 200) throw new Error('VALIDATION_ERROR: Username atau password salah.');

    if (loginLocked_(uname)) {
      throw new Error('VALIDATION_ERROR: Terlalu banyak percobaan login gagal. Coba lagi dalam 15 menit.');
    }

    const generic = 'VALIDATION_ERROR: Username atau password salah.';
    const rows = readTable_('USERS');
    const row  = rows.find(r => norm_(r['Username']) === norm_(uname));
    if (!row) {
      registerLoginFail_(uname);
      auditAuth_('LOGIN_FAILED', uname, '', { reason: 'unknown user' });
      throw new Error(generic);
    }

    const check = verifyPassword_(_storedPassword_(row), pass);
    if (!check.valid) {
      const n = registerLoginFail_(uname);
      auditAuth_('LOGIN_FAILED', uname, row['Nama'] || '', { reason: 'wrong password', attempt: n });
      throw new Error(generic);
    }

    const status = norm_(row['Status']);
    if (status === 'inactive' || status === 'nonaktif') {
      throw new Error('VALIDATION_ERROR: Akun Anda tidak aktif. Hubungi administrator.');
    }
    const role = canonRole_(row['Role']);
    if (!role) {
      throw new Error('VALIDATION_ERROR: Role akun "' + (row['Role'] || '-') + '" tidak dikenali. Hubungi administrator.');
    }
    if (getConfigBool_('maintenance_mode', false) && role !== ROLES.QC) {
      throw new Error('MAINTENANCE');
    }

    // Migrasi otomatis password plaintext / hash lama → hash bersalt
    if (check.needsRehash) {
      try {
        withLock_(() => updateRow_('USERS', row.__rowIndex, { Password: hashPassword_(pass) }), 10000);
        bumpVersion_('users');
      } catch (e) {
        Logger.log('[apiLogin] Gagal migrasi hash password %s: %s', uname, e.message);
      }
    }
    clearLoginFail_(uname);

    const profile = getUserIndex_()[norm_(uname)] || {
      username: String(row['Username']).trim(), nama: String(row['Nama'] || row['Username']).trim(),
      rawRole: String(row['Role']), role: role, aksesData: String(row['AksesData'] || ''),
      kodeOutlet: String(row['KodeOutlet'] || ''), status: 'Active'
    };
    const token = createSession_(profile);
    auditAuth_('LOGIN', profile.username, profile.nama, { role: role });
    return ok_({ token: token });
  });
}

// ─── API: Logout ──────────────────────────────────────────────────────────────

function apiLogout(token) {
  return runPublic_(() => {
    if (token) {
      let s = null;
      try { s = getSession_(token); } catch (e) {}
      destroySession_(token);
      if (s) auditAuth_('LOGOUT', s.username, s.nama, null);
    }
    return ok_({ message: 'Berhasil keluar dari sistem.' });
  });
}

// ─── API: Bootstrap ───────────────────────────────────────────────────────────

/**
 * Data inisialisasi setelah login: profil, izin, outlet dalam scope, daftar filter.
 * Tahap 1 progressive rendering (ringan — tidak membaca sheet transaksi).
 */
function apiBootstrap(token) {
  return run_(token, (user) => {
    const scopeRows = getScope_(user);
    const outlets = scopeRows.map(r => ({
      kode:   r.KodeOutlet,
      nama:   r.NamaOutlet,
      kelas:  r.Class,
      area:   r.Area,
      region: r.RM,
      kota:   r.Kota,
      lob:    r.LOB,
      am:     r.AM,
      rm:     r.RM,
      kabag:  r.KabagQCArea,
      status: r.StatusOutlet || 'Active'
    })).sort((a, b) => String(a.nama).localeCompare(String(b.nama), 'id'));

    const uniq = (arr) => [...new Set(arr.map(v => String(v || '').trim()).filter(Boolean))].sort();
    const studios = uniq(getMasterCache_().interval.map(r => r.STUDIO));

    return {
      user: {
        username:   user.username,
        nama:       user.nama,
        role:       user.role,
        roleLabel:  user.rawRole || user.role,
        kodeOutlet: user.kodeOutlet
      },
      perms:      getPerms_(user.role),
      outlets:    outlets,
      areas:      uniq(scopeRows.map(r => r.Area)),
      kelasList:  uniq(scopeRows.map(r => r.Class)),
      regions:    uniq(scopeRows.map(r => r.RM)),
      studios:    studios.length ? studios : ['Studio 1', 'Studio 2', 'Studio 3', 'Studio 4', 'LOBY'],
      scopeEmpty: outlets.length === 0,
      appConfig:  getClientConfig_(),
      serverTime: fmtDateTime_(new Date()),
      sessionTtlSec: _sessionTtl_()
    };
  });
}

// ─── API: Validate Token (keep-alive) ─────────────────────────────────────────

function apiValidateToken(token) {
  return runPublic_(() => {
    const s = peekSession_(token);
    if (!s) return ok_({ valid: false });
    return ok_({ valid: true, role: s.role, nama: s.nama, expiresAt: s.expiresAt });
  });
}

// ─── API: Change Password ─────────────────────────────────────────────────────

function apiChangePassword(token, oldPassword, newPassword) {
  return run_(token, (user) => {
    required_(oldPassword, 'Password Lama');
    validPassword_(newPassword);
    if (String(oldPassword) === String(newPassword)) {
      throw new Error('VALIDATION_ERROR: Password baru harus berbeda dari password lama.');
    }
    withLock_(() => {
      const row = readTable_('USERS').find(r => norm_(r['Username']) === norm_(user.username));
      if (!row) throw new Error('NOT_FOUND: Data user tidak ditemukan.');
      if (!verifyPassword_(_storedPassword_(row), oldPassword).valid) {
        throw new Error('VALIDATION_ERROR: Password lama tidak sesuai.');
      }
      updateRow_('USERS', row.__rowIndex, {
        Password: hashPassword_(String(newPassword)), UpdatedAt: fmtDateTime_(new Date()), UpdatedBy: user.username
      });
    });
    bumpVersion_('users');
    auditLog_(user, 'CHANGE_PASSWORD', 'USERS', user.username, null, { changed: true });
    destroySession_(token);
    return { message: 'Password berhasil diubah. Silakan login kembali.' };
  });
}

// ─── API: User Management (Admin) ─────────────────────────────────────────────

function _countActiveAdmins_(rows) {
  return rows.filter(r => isAdminRole_(r['Role']) && norm_(r['Status'] || 'active') !== 'inactive').length;
}

/** Daftar user (tanpa password) + jumlah outlet dalam scope masing-masing. */
function apiGetUsers(token) {
  return run_(token, (user) => {
    requireAdmin_(user);
    const users = readTable_('USERS').map(r => {
      const prof = {
        username: String(r['Username'] || '').trim(), nama: String(r['Nama'] || '').trim(),
        role: canonRole_(r['Role']) || '', aksesData: String(r['AksesData'] || ''), kodeOutlet: String(r['KodeOutlet'] || '')
      };
      let scopeCount = 0;
      try { scopeCount = prof.role ? resolveScopeCodes_(prof).codes.length : 0; } catch (e) {}
      return {
        username:   prof.username,
        nama:       prof.nama,
        role:       String(r['Role'] || ''),
        roleCanon:  prof.role,
        aksesData:  prof.aksesData,
        kodeOutlet: prof.kodeOutlet,
        status:     norm_(r['Status']) === 'inactive' ? 'Inactive' : 'Active',
        passwordHashed: isHashedPassword_(_storedPassword_(r)),
        scopeCount: scopeCount,
        createdAt:  String(r['CreatedAt'] || ''),
        updatedAt:  String(r['UpdatedAt'] || '')
      };
    }).filter(u => u.username);
    return { users: users };
  });
}

/**
 * Tambah / perbarui user. Field yang tidak dikirim (undefined) dipertahankan.
 * @param {Object} d {username, nama, password?, role, status, kodeOutlet, aksesData}
 */
function apiSaveUser(token, d) {
  return run_(token, (user) => {
    requireAdmin_(user);
    d = d || {};
    required_(d.username, 'Username');
    required_(d.nama, 'Nama Lengkap');
    const uname = String(d.username).trim();

    const result = withLock_(() => {
      const rows = readTable_('USERS');
      const existing = rows.find(r => norm_(r['Username']) === norm_(uname));
      const now = fmtDateTime_(new Date());

      let role = existing ? (canonRole_(existing['Role']) || String(existing['Role'])) : '';
      if (d.role !== undefined && String(d.role).trim() !== '') {
        const c = canonRole_(d.role);
        if (!c) throw new Error('VALIDATION_ERROR: Role "' + d.role + '" tidak valid.');
        role = c;
      } else if (!existing) {
        throw new Error('VALIDATION_ERROR: Role wajib dipilih.');
      }

      let status = existing ? (norm_(existing['Status']) === 'inactive' ? 'Inactive' : 'Active') : 'Active';
      if (d.status !== undefined && String(d.status).trim() !== '') status = norm_(d.status) === 'inactive' ? 'Inactive' : 'Active';

      const kodeOutlet = d.kodeOutlet !== undefined ? sanitizeStr_(d.kodeOutlet) : (existing ? String(existing['KodeOutlet'] || '') : '');
      const aksesData  = d.aksesData  !== undefined ? sanitizeStr_(d.aksesData)  : (existing ? String(existing['AksesData'] || '') : '');

      if (role === ROLES.OUTLET) {
        if (!kodeOutlet && !parseAksesData_(aksesData).length) {
          throw new Error('VALIDATION_ERROR: Kode Outlet wajib diisi untuk role Outlet.');
        }
        if (kodeOutlet && !findOutlet_(kodeOutlet)) {
          throw new Error('VALIDATION_ERROR: Kode outlet "' + kodeOutlet + '" tidak ditemukan di master KODE.');
        }
      }
      // Validasi token AksesData agar tidak terjadi akses tanpa mapping
      const tokens = parseAksesData_(aksesData);
      if (tokens.length && role !== ROLES.QC) {
        const n = _outletsByTokens_(tokens, getMasterCache_().kode).length;
        if (!n) throw new Error('VALIDATION_ERROR: AksesData "' + aksesData + '" tidak cocok dengan outlet mana pun di master KODE.');
      }

      if (existing) {
        const isSelf = norm_(uname) === norm_(user.username);
        if (isSelf && (status === 'Inactive' || role !== ROLES.QC)) {
          throw new Error('VALIDATION_ERROR: Anda tidak dapat menonaktifkan atau menurunkan role akun Anda sendiri.');
        }
        const wasAdmin = isAdminRole_(existing['Role']) && norm_(existing['Status'] || 'active') !== 'inactive';
        const willAdmin = role === ROLES.QC && status !== 'Inactive';
        if (wasAdmin && !willAdmin && _countActiveAdmins_(rows) <= 1) {
          throw new Error('VALIDATION_ERROR: Tidak dapat menghapus hak admin aktif terakhir.');
        }
        const payload = {
          Nama: sanitizeStr_(d.nama), Role: role, AksesData: aksesData, KodeOutlet: kodeOutlet,
          Status: status, UpdatedAt: now, UpdatedBy: user.username
        };
        if (d.password && String(d.password).trim()) {
          validPassword_(d.password);
          payload.Password = hashPassword_(String(d.password));
        }
        updateRow_('USERS', existing.__rowIndex, payload);
        auditLog_(user, 'UPDATE_USER', 'USERS', uname,
          { nama: existing['Nama'], role: existing['Role'], status: existing['Status'], akses: existing['AksesData'] },
          { nama: payload.Nama, role: role, status: status, akses: aksesData, passwordChanged: !!payload.Password });
        return { success: true, username: uname, created: false };
      }

      validUsername_(uname);
      validPassword_(d.password);
      appendRow_('USERS', {
        Username: uname, Password: hashPassword_(String(d.password)), Nama: sanitizeStr_(d.nama), Role: role,
        AksesData: aksesData, KodeOutlet: kodeOutlet, Status: status,
        CreatedAt: now, CreatedBy: user.username, UpdatedAt: now, UpdatedBy: user.username
      });
      auditLog_(user, 'CREATE_USER', 'USERS', uname, null, { nama: d.nama, role: role, status: status, akses: aksesData });
      return { success: true, username: uname, created: true };
    });
    bumpVersion_('users');
    return result;
  });
}

function apiToggleUserStatus(token, targetUsername) {
  return run_(token, (user) => {
    requireAdmin_(user);
    const uname = norm_(targetUsername);
    if (uname === norm_(user.username)) throw new Error('VALIDATION_ERROR: Tidak dapat menonaktifkan akun sendiri.');
    const res = withLock_(() => {
      const rows = readTable_('USERS');
      const ex = rows.find(r => norm_(r['Username']) === uname);
      if (!ex) throw new Error('NOT_FOUND: User tidak ditemukan.');
      const active = norm_(ex['Status'] || 'active') !== 'inactive';
      if (active && isAdminRole_(ex['Role']) && _countActiveAdmins_(rows) <= 1) {
        throw new Error('VALIDATION_ERROR: Tidak dapat menonaktifkan admin aktif terakhir.');
      }
      const newStatus = active ? 'Inactive' : 'Active';
      updateRow_('USERS', ex.__rowIndex, { Status: newStatus, UpdatedAt: fmtDateTime_(new Date()), UpdatedBy: user.username });
      auditLog_(user, 'TOGGLE_USER_STATUS', 'USERS', uname, ex['Status'] || 'Active', newStatus);
      return { username: uname, status: newStatus };
    });
    bumpVersion_('users');   // sesi user nonaktif langsung dicabut
    return res;
  });
}

function apiDeleteUser(token, targetUsername) {
  return run_(token, (user) => {
    requireAdmin_(user);
    const uname = norm_(targetUsername);
    if (!uname) throw new Error('VALIDATION_ERROR: Username tidak valid.');
    if (uname === norm_(user.username)) throw new Error('VALIDATION_ERROR: Tidak dapat menghapus akun yang sedang Anda gunakan.');
    const snap = withLock_(() => {
      const rows = readTable_('USERS');
      const ex = rows.find(r => norm_(r['Username']) === uname);
      if (!ex) throw new Error('NOT_FOUND: User tidak ditemukan.');
      if (isAdminRole_(ex['Role']) && norm_(ex['Status'] || 'active') !== 'inactive' && _countActiveAdmins_(rows) <= 1) {
        throw new Error('VALIDATION_ERROR: Tidak dapat menghapus admin aktif terakhir.');
      }
      deleteRow_('USERS', ex.__rowIndex);
      return { nama: ex['Nama'], role: ex['Role'], status: ex['Status'], akses: ex['AksesData'] };
    });
    bumpVersion_('users');
    auditLog_(user, 'DELETE_USER', 'USERS', uname, snap, null);
    return { deleted: true, username: uname };
  });
}

/** Pratinjau scope dari kombinasi role + akses (dipakai form Master User). */
function apiPreviewScope(token, d) {
  return run_(token, (user) => {
    requireAdmin_(user);
    d = d || {};
    const prof = { username: String(d.username || ''), nama: String(d.nama || ''), role: canonRole_(d.role) || '',
                   aksesData: String(d.aksesData || ''), kodeOutlet: String(d.kodeOutlet || '') };
    if (!prof.role) return { count: 0, sample: [] };
    const codes = resolveScopeCodes_(prof).codes;
    return { count: codes.length, sample: codes.slice(0, 12).map(c => { const r = findOutlet_(c); return r ? r.NamaOutlet : c; }) };
  });
}
