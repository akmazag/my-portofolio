/**
 * CINEMA HUB — Autentikasi: login, logout, bootstrap sesi, ganti password.
 */
const AuthService = (() => {
  function users() { return Repo.table('USERS'); }

  function findUser(identifier) {
    const id = Utils.normalize(identifier);
    if (!id) return null;
    return users().findOne((u) => String(u.username).toLowerCase() === id || String(u.email).toLowerCase() === id);
  }

  function publicUser(u) {
    const role = Repo.table('ROLES').findById(u.role_id);
    return {
      user_id: u.user_id,
      username: u.username,
      email: u.email,
      full_name: u.full_name,
      initials: Utils.initials(u.full_name || u.username),
      role_id: u.role_id,
      role_name: role ? role.role_name : u.role_id,
      outlet_id: u.outlet_id,
      outlet_name: Lookups.outletName(u.outlet_id),
      area: u.area,
      employee_id: u.employee_id,
      must_change_password: u.must_change_password === true,
      last_login_at: u.last_login_at
    };
  }

  function unreadCount(userId) {
    try {
      return Repo.table('NOTIFICATIONS').all().filter((n) => n.user_id === userId && n.is_read !== true).length;
    } catch (e) {
      return 0;
    }
  }

  function bootstrapFor(user, session) {
    return {
      user: publicUser(user),
      permissions: Rbac.permissionsFor(user.role_id),
      config: Config.publicConfig(),
      session: { expiresAt: session.idle_expires_at, absoluteExpiresAt: session.absolute_expires_at, remember: session.remember === true },
      serverTime: Utils.nowIso(),
      today: Utils.today(),
      unreadNotifications: unreadCount(user.user_id)
    };
  }

  function failKey(identifier) {
    return 'login:fail:' + Utils.sha256Hex(Utils.normalize(identifier));
  }

  function login(ctx, p) {
    const maxAttempts = Config.get('LOGIN_MAX_ATTEMPTS', 5);
    const lockMinutes = Config.get('LOGIN_LOCK_MINUTES', 15);
    const lockedMessage = 'Terlalu banyak percobaan gagal. Coba lagi dalam ' + lockMinutes + ' menit.';
    const key = failKey(p.identifier);
    const fails = Number(Cache.get(key) || 0);
    const auditBase = { action: 'auth.login', module: 'auth', username: Utils.normalize(p.identifier).slice(0, 60) };

    if (fails >= maxAttempts) {
      Audit.log(ctx, Object.assign({}, auditBase, { result: 'DENIED', detail: { reason: 'THROTTLED' } }));
      throw Errors.create('RATE_LIMITED', lockedMessage);
    }

    const registerFail = (reason, user) => {
      Cache.put(key, String(fails + 1), lockMinutes * 60);
      Audit.log(ctx, Object.assign({}, auditBase, {
        result: 'FAILED', userId: user ? user.user_id : '', entityType: 'USER', entityId: user ? user.user_id : '',
        detail: { reason }
      }));
    };

    const user = findUser(p.identifier);
    if (!user) {
      Password.burn(p.password);
      registerFail('UNKNOWN_USER', null);
      throw Errors.create('INVALID_CREDENTIALS');
    }

    if (user.locked_until && Utils.toMs(user.locked_until) > Date.now()) {
      Audit.log(ctx, Object.assign({}, auditBase, { result: 'DENIED', userId: user.user_id, detail: { reason: 'ACCOUNT_LOCKED' } }));
      throw Errors.create('RATE_LIMITED', lockedMessage);
    }

    if (!Password.verify(p.password, user)) {
      const attempts = (Number(user.failed_attempts) || 0) + 1;
      const patch = { failed_attempts: attempts };
      const lockNow = attempts >= maxAttempts;
      if (lockNow) {
        patch.locked_until = Utils.isoFromMs(Date.now() + lockMinutes * 60000);
        patch.failed_attempts = 0;
      }
      users().update(user.user_id, patch, null);
      registerFail(lockNow ? 'WRONG_PASSWORD_LOCKED' : 'WRONG_PASSWORD', user);
      if (lockNow) throw Errors.create('RATE_LIMITED', lockedMessage);
      throw Errors.create('INVALID_CREDENTIALS');
    }

    if (user.status !== 'ACTIVE') {
      Audit.log(ctx, Object.assign({}, auditBase, { result: 'DENIED', userId: user.user_id, detail: { reason: 'INACTIVE' } }));
      throw Errors.create('ACCOUNT_INACTIVE');
    }

    const patch = { failed_attempts: 0, locked_until: '', last_login_at: Utils.nowIso() };
    if (Password.needsRehash(user)) Object.assign(patch, Password.hash(p.password));
    const updated = users().update(user.user_id, patch, null);
    Cache.remove(key);

    const s = Sessions.create(updated, { remember: p.remember === true, userAgent: p.userAgent });
    ctx.user = updated;
    ctx.session = s.session;
    Audit.log(ctx, { action: 'auth.login', module: 'auth', entityType: 'USER', entityId: user.user_id, detail: { remember: p.remember === true } });
    return Object.assign({ token: s.token }, bootstrapFor(updated, s.session));
  }

  function logout(ctx) {
    Sessions.revoke(ctx.session, 'LOGOUT');
    Audit.log(ctx, { action: 'auth.logout', entityType: 'USER', entityId: ctx.user.user_id });
    return { loggedOut: true };
  }

  function bootstrap(ctx) {
    return bootstrapFor(ctx.user, ctx.session);
  }

  function changePassword(ctx, p) {
    const user = users().findById(ctx.user.user_id);
    if (!Password.verify(p.currentPassword, user)) {
      Audit.log(ctx, { action: 'auth.changePassword', result: 'FAILED', entityType: 'USER', entityId: user.user_id, detail: { reason: 'WRONG_CURRENT' } });
      throw Errors.create('VALIDATION_ERROR', 'Password saat ini salah.', { fields: { currentPassword: 'Password saat ini salah.' } });
    }
    const policy = Password.policyError(p.newPassword, user.username);
    if (policy) throw Errors.create('VALIDATION_ERROR', policy, { fields: { newPassword: policy } });
    if (p.newPassword === p.currentPassword) {
      const msg = 'Password baru harus berbeda dari password saat ini.';
      throw Errors.create('VALIDATION_ERROR', msg, { fields: { newPassword: msg } });
    }
    const updated = users().update(user.user_id, Object.assign(Password.hash(p.newPassword), { must_change_password: false }), ctx);
    const revoked = Sessions.revokeAllForUser(user.user_id, 'PASSWORD_CHANGED', ctx.session.session_id);
    Audit.log(ctx, { action: 'auth.changePassword', entityType: 'USER', entityId: user.user_id, detail: { otherSessionsRevoked: revoked } });
    return bootstrapFor(updated, ctx.session);
  }

  function systemStatus() {
    const installed = Config.isInstalled();
    const cfg = installed ? Config.publicConfig() : {
      APP_NAME: 'CINEMA HUB', APP_TAGLINE: 'One Platform. One Knowledge. One Operation.', COMPANY_NAME: '', APP_VERSION: CH.APP_VERSION
    };
    return {
      installed,
      appName: cfg.APP_NAME,
      tagline: cfg.APP_TAGLINE,
      company: cfg.COMPANY_NAME,
      version: CH.APP_VERSION,
      rememberDays: cfg.SESSION_REMEMBER_DAYS || 7
    };
  }

  return { login, logout, bootstrap, changePassword, systemStatus, publicUser };
})();
