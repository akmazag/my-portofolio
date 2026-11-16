/**
 * CINEMA HUB — Gateway.
 *
 * HANYA dua fungsi di file ini yang dapat dipanggil dari browser:
 *   doGet(e)          → menyajikan aplikasi
 *   apiCall(request)  → satu-satunya pintu masuk API
 * Semua fungsi lain berada di dalam modul (objek) atau berakhiran "_" sehingga
 * tidak terekspos ke google.script.run.
 */

function doGet(e) {
  return Gateway.render(e);
}

function apiCall(request) {
  return Gateway.handle(request);
}

const Gateway = (() => {
  const INCLUDE_RE = /<!--\s*@include\s+([A-Za-z0-9_\/\-]+)\s*-->/g;

  function assemble(name, depth) {
    if ((depth || 0) > 5) throw new Error('Include terlalu dalam: ' + name);
    const content = HtmlService.createHtmlOutputFromFile(name).getContent();
    return content.replace(INCLUDE_RE, (m, file) => assemble(file, (depth || 0) + 1));
  }

  function render() {
    Scope.reset();
    const html = assemble('client/Index', 0);
    return HtmlService.createHtmlOutput(html)
      .setTitle('CINEMA HUB')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
  }

  function jsonSafe(data) {
    return data === undefined ? null : JSON.parse(JSON.stringify(data));
  }

  function meta(reqId, t0) {
    return { reqId, serverTime: Utils.nowIso(), ms: Date.now() - t0 };
  }

  function handle(request) {
    const t0 = Date.now();
    Scope.reset();
    const req = request && typeof request === 'object' && !Array.isArray(request) ? request : {};
    const reqId = typeof req.reqId === 'string' ? req.reqId.slice(0, 40) : '';
    const action = typeof req.action === 'string' ? req.action.slice(0, 80) : '';
    const ctx = { reqId, action, user: null, session: null, permissions: [] };
    try {
      Routes.ensure();
      const route = Router.get(action);
      if (!route) throw Errors.create('NOT_FOUND', 'Aksi tidak dikenal.');

      if (!route.public) {
        if (!Config.isInstalled()) throw Errors.create('NOT_INSTALLED');
        const auth = Sessions.verify(req.token);
        ctx.user = auth.user;
        ctx.session = auth.session;
        ctx.permissions = Rbac.permissionsFor(auth.user.role_id);
        if (auth.user.must_change_password === true && !route.allowWhenMustChangePassword) {
          throw Errors.create('PASSWORD_CHANGE_REQUIRED');
        }
        if (route.permission) Rbac.assert(ctx, route.permission);
      }

      const payload = route.schema ? Validator.validate(req.payload, route.schema) : {};
      const data = route.handler(ctx, payload);
      return { ok: true, data: jsonSafe(data), meta: meta(reqId, t0) };
    } catch (err) {
      return errorResponse(err, ctx, reqId, t0);
    }
  }

  function errorResponse(err, ctx, reqId, t0) {
    if (Errors.is(err)) {
      const out = { code: err.code, message: err.message };
      if (err.details && err.details.fields) out.fields = err.details.fields;
      return { ok: false, error: out, meta: meta(reqId, t0) };
    }
    const errorId = Audit.error(ctx, err);
    return {
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: Errors.CATALOG.INTERNAL_ERROR, errorId },
      meta: meta(reqId, t0)
    };
  }

  return { render, handle, assemble };
})();
