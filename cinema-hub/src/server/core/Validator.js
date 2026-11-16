/**
 * CINEMA HUB — Validasi payload berbasis deskriptor.
 *
 * Contoh skema:
 *   { q: { type: 'string', max: 80 }, page: { type: 'int', min: 1, max: 1000, default: 1 },
 *     state: { type: 'enum', values: ['ACTIVE', 'ALL'], default: 'ACTIVE' } }
 *
 * - Field yang tidak dideklarasikan dibuang (whitelist).
 * - Melempar VALIDATION_ERROR dengan details.fields = { field: pesan }.
 */
const Validator = (() => {
  const ID_RE = /^[A-Za-z0-9_.+\-]{1,64}$/;

  function isEmpty(v) {
    return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  }

  function coerce(v, rule) {
    switch (rule.type) {
      case 'string':
      case 'text': {
        if (typeof v !== 'string' && typeof v !== 'number') return { error: 'harus berupa teks.' };
        const s = rule.type === 'string' ? Sanitize.line(v) : Sanitize.text(v);
        const max = rule.max || (rule.type === 'string' ? 200 : 5000);
        if (s.length > max) return { error: 'maksimal ' + max + ' karakter.' };
        if (rule.min && s.length < rule.min) return { error: 'minimal ' + rule.min + ' karakter.' };
        if (rule.pattern && !rule.pattern.test(s)) return { error: rule.patternMessage || 'formatnya tidak valid.' };
        return { value: s };
      }
      case 'password': {
        if (typeof v !== 'string') return { error: 'harus berupa teks.' };
        if (v.length > 128) return { error: 'maksimal 128 karakter.' };
        return { value: v };
      }
      case 'int': {
        const n = typeof v === 'number' ? v : Number(String(v).trim());
        if (!Number.isInteger(n)) return { error: 'harus berupa bilangan bulat.' };
        if (rule.min !== undefined && n < rule.min) return { error: 'minimal ' + rule.min + '.' };
        if (rule.max !== undefined && n > rule.max) return { error: 'maksimal ' + rule.max + '.' };
        return { value: n };
      }
      case 'bool': {
        if (typeof v === 'boolean') return { value: v };
        if (v === 'true' || v === 'TRUE' || v === 1) return { value: true };
        if (v === 'false' || v === 'FALSE' || v === 0) return { value: false };
        return { error: 'harus bernilai ya/tidak.' };
      }
      case 'enum': {
        const s = String(v).trim();
        if (rule.values.indexOf(s) < 0) return { error: 'tidak valid.' };
        return { value: s };
      }
      case 'date': {
        const s = String(v).trim();
        if (!Utils.isDateStr(s)) return { error: 'harus berformat tanggal yyyy-MM-dd.' };
        return { value: s };
      }
      case 'time': {
        const s = String(v).trim();
        if (Utils.timeToMin(s) === null) return { error: 'harus berformat jam JJ:MM.' };
        return { value: s.length === 4 ? '0' + s : s };
      }
      case 'email': {
        const s = String(v).trim().toLowerCase();
        if (!Sanitize.isEmail(s)) return { error: 'bukan alamat email yang valid.' };
        return { value: s };
      }
      case 'url': {
        const s = String(v).trim();
        if (!Sanitize.isHttpsUrl(s)) return { error: 'harus berupa tautan https:// yang valid.' };
        return { value: s };
      }
      case 'id': {
        const s = String(v).trim();
        if (!ID_RE.test(s)) return { error: 'tidak valid.' };
        return { value: s };
      }
      case 'array': {
        if (!Array.isArray(v)) return { error: 'harus berupa daftar.' };
        if (rule.maxItems && v.length > rule.maxItems) return { error: 'maksimal ' + rule.maxItems + ' item.' };
        const out = [];
        for (let i = 0; i < v.length; i++) {
          const r = coerce(v[i], rule.items || { type: 'string' });
          if (r.error) return { error: 'item ke-' + (i + 1) + ' ' + r.error };
          out.push(r.value);
        }
        return { value: out };
      }
      default:
        return { error: 'tipe validasi tidak dikenal.' };
    }
  }

  function validate(input, schema) {
    const src = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
    const out = {};
    const errors = {};
    Object.keys(schema || {}).forEach((key) => {
      const rule = schema[key];
      const label = rule.label || key;
      const v = src[key];
      if (isEmpty(v)) {
        if (rule.required) errors[key] = label + ' wajib diisi.';
        else if (Object.prototype.hasOwnProperty.call(rule, 'default')) out[key] = rule.default;
        return;
      }
      const r = coerce(v, rule);
      if (r.error) errors[key] = label + ' ' + r.error;
      else out[key] = r.value;
    });
    const keys = Object.keys(errors);
    if (keys.length) {
      throw Errors.create('VALIDATION_ERROR', errors[keys[0]], { fields: errors });
    }
    return out;
  }

  return { validate, coerce };
})();
