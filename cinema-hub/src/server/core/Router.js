/**
 * CINEMA HUB — Registry aksi API.
 *
 * Setiap aksi WAJIB mendeklarasikan salah satu:
 *   public: true          → tanpa login (hanya untuk login & status sistem)
 *   permission: 'x.y'     → login + permission tertentu (atau array: salah satu)
 *   authenticated: true   → login, tanpa permission khusus (mis. logout, notifikasi milik sendiri)
 * Registrasi tanpa salah satunya ditolak (fail-closed).
 */
const Router = (() => {
  const routes = {};

  function register(def) {
    if (!def || !def.action || typeof def.handler !== 'function') {
      throw new Error('Route tidak valid: action & handler wajib.');
    }
    const modes = [def.public === true, !!def.permission, def.authenticated === true].filter(Boolean).length;
    if (modes !== 1) {
      throw new Error('Route ' + def.action + ' harus mendeklarasikan tepat satu dari public/permission/authenticated.');
    }
    if (routes[def.action]) throw new Error('Route duplikat: ' + def.action);
    routes[def.action] = Object.freeze(Object.assign({ schema: null, allowWhenMustChangePassword: false }, def));
  }

  function get(action) {
    return Object.prototype.hasOwnProperty.call(routes, action) ? routes[action] : null;
  }

  function list() {
    return Object.keys(routes).sort().map((k) => routes[k]);
  }

  return { register, get, list };
})();
