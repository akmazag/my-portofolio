/**
 * CINEMA HUB — Akses data referensi (lookup & outlet).
 */
const Lookups = (() => {
  function grouped() {
    return Scope.get('lookups:grouped', () => {
      const out = {};
      Repo.table('LOOKUPS').all()
        .filter((l) => l.status === 'ACTIVE')
        .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
        .forEach((l) => {
          (out[l.type] = out[l.type] || []).push({ code: l.code, label: l.label });
        });
      return out;
    });
  }

  function label(type, code) {
    if (!code) return '';
    const list = grouped()[type] || [];
    const found = list.find((l) => l.code === code);
    return found ? found.label : code;
  }

  function labels(type, csvCodes) {
    return Utils.csv(csvCodes).map((c) => label(type, c));
  }

  function outlets() {
    return Scope.get('lookups:outlets', () => Repo.table('OUTLETS').all()
      .filter((o) => o.status === 'ACTIVE')
      .map((o) => ({ code: o.outlet_id, label: o.outlet_name, mall: o.mall_name, city: o.city, area: o.area }))
      .sort((a, b) => a.label.localeCompare(b.label)));
  }

  function outletName(id) {
    if (!id) return '';
    const o = Repo.table('OUTLETS').findById(id);
    return o ? o.outlet_name : id;
  }

  function list() {
    const out = Object.assign({}, grouped());
    out.OUTLET = outlets();
    return out;
  }

  return { grouped, label, labels, outlets, outletName, list };
})();
