/**
 * CINEMA HUB — Role-Based Access Control.
 * Matriks dibaca dari ROLE_PERMISSIONS (data, bukan kode) dan dicek di SETIAP request.
 */
const Rbac = (() => {
  function activePermissionKeys() {
    return Scope.get('rbac:perms', () => {
      const m = {};
      Repo.table('PERMISSIONS').all().forEach((p) => { if (p.status === 'ACTIVE') m[p.permission_key] = true; });
      return m;
    });
  }

  function matrix() {
    return Scope.get('rbac:matrix', () => {
      const active = activePermissionKeys();
      const m = {};
      Repo.table('ROLE_PERMISSIONS').all().forEach((g) => {
        if (g.status !== 'ACTIVE' || !active[g.permission_key]) return;
        (m[g.role_id] = m[g.role_id] || {})[g.permission_key] = true;
      });
      return m;
    });
  }

  function permissionsFor(roleId) {
    const role = Repo.table('ROLES').findById(roleId);
    if (!role || role.status !== 'ACTIVE') return [];
    return Object.keys(matrix()[roleId] || {}).sort();
  }

  function can(ctx, permission) {
    if (!ctx || !Array.isArray(ctx.permissions)) return false;
    const list = Array.isArray(permission) ? permission : [permission];
    return list.some((p) => ctx.permissions.indexOf(p) >= 0);
  }

  function assert(ctx, permission) {
    if (can(ctx, permission)) return;
    Audit.log(ctx, { result: 'DENIED', detail: { permission } });
    throw Errors.create('FORBIDDEN');
  }

  return { permissionsFor, can, assert };
})();
