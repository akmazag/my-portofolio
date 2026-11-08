/**
 * ConfigService.gs
 * Pembacaan / penulisan APP_CONFIG dengan cache (satu kali baca untuk seluruh key).
 * @version 2.0.0
 */

/** Seluruh APP_CONFIG sebagai map key → value (string). */
function getConfigMap_() {
  if (_EXEC.config) return _EXEC.config;
  const key = 'app_config_' + dataVersion_('config');
  _EXEC.config = cached_(key, CACHE_TTL_CONFIG, function () {
    const map = {};
    DEFAULT_CONFIG.forEach(c => { map[c[0]] = c[1]; });
    try {
      readColumns_('APP_CONFIG', ['ConfigKey', 'ConfigValue']).forEach(r => {
        const k = String(r.ConfigKey || '').trim();
        if (k) map[k] = String(r.ConfigValue === undefined ? '' : r.ConfigValue).trim();
      });
    } catch (e) {
      Logger.log('[getConfigMap_] APP_CONFIG tidak terbaca: %s', e.message);
    }
    return map;
  });
  return _EXEC.config;
}

/** Nilai konfigurasi (string) atau default. */
function getConfig_(key, defaultVal) {
  const map = getConfigMap_();
  const v = map[key];
  return (v === undefined || v === null || v === '') ? defaultVal : v;
}

/** Alias kompatibilitas v1. */
function getAppConfig_(key, defaultVal) { return getConfig_(key, defaultVal); }

function getConfigNum_(key, defaultVal) {
  const n = Number(getConfig_(key, defaultVal));
  return isFinite(n) ? n : defaultVal;
}

function getConfigBool_(key, defaultVal) {
  const v = getConfig_(key, defaultVal ? 'true' : 'false');
  return isTrue_(v);
}

/** Konfigurasi yang boleh dikirim ke browser. */
function getClientConfig_() {
  return {
    warningThresholdDays: getConfigNum_('warning_threshold_days', 30),
    gradeAMin:            getConfigNum_('grade_A_min', DEFAULT_GRADE.A_MIN),
    gradeBMin:            getConfigNum_('grade_B_min', DEFAULT_GRADE.B_MIN),
    gradeCMin:            getConfigNum_('grade_C_min', DEFAULT_GRADE.C_MIN),
    gradeDMin:            getConfigNum_('grade_D_min', DEFAULT_GRADE.D_MIN),
    maxPdfMb:             getConfigNum_('max_pdf_mb', 10),
    naItemPolicy:         getConfig_('na_item_policy', 'exclude'),
    gradingMethod:        getConfig_('grading_method', 'ratio'),
    pdfRequired:          getConfigBool_('pdf_required', false),
    visitPeriodMonths:    getConfigNum_('visit_period_months', 3),
    sessionTtlHours:      Math.min(getConfigNum_('session_ttl_hours', 6), 6),
    appVersion:           APP_VERSION
  };
}

/** Validasi nilai konfigurasi yang dikenal. */
function _validateConfigValue_(key, value) {
  const v = String(value).trim();
  const numKeys = ['warning_threshold_days', 'grade_A_min', 'grade_B_min', 'grade_C_min', 'grade_D_min',
                   'max_pdf_mb', 'session_ttl_hours', 'visit_period_months', 'upcoming_visit_days'];
  if (numKeys.includes(key)) {
    const n = Number(v);
    if (!isFinite(n) || n < 0) throw new Error('VALIDATION_ERROR: Nilai "' + key + '" harus berupa angka ≥ 0.');
    if (/^grade_/.test(key) && n > 100) throw new Error('VALIDATION_ERROR: Batas grade maksimum 100.');
    if (key === 'max_pdf_mb' && (n < 1 || n > 25)) throw new Error('VALIDATION_ERROR: max_pdf_mb harus 1–25.');
    if (key === 'session_ttl_hours' && (n < 1 || n > 6)) throw new Error('VALIDATION_ERROR: session_ttl_hours harus 1–6.');
    if (key === 'visit_period_months' && (n < 1 || n > 12)) throw new Error('VALIDATION_ERROR: visit_period_months harus 1–12.');
  }
  if (key === 'grading_method' && !['ratio', 'average'].includes(v)) {
    throw new Error('VALIDATION_ERROR: grading_method hanya "ratio" atau "average".');
  }
  if (key === 'na_item_policy' && !['exclude'].includes(v)) {
    throw new Error('VALIDATION_ERROR: na_item_policy saat ini hanya mendukung "exclude".');
  }
  if (['pdf_required', 'maintenance_mode'].includes(key) && !['true', 'false'].includes(v.toLowerCase())) {
    throw new Error('VALIDATION_ERROR: Nilai "' + key + '" harus true atau false.');
  }
  if (key === 'app_version') throw new Error('VALIDATION_ERROR: app_version dikelola sistem.');
  return v;
}

/** Simpan konfigurasi (upsert). */
function setAppConfig_(key, value, deskripsi, user) {
  const rows = readTable_('APP_CONFIG');
  const row  = rows.find(r => String(r['ConfigKey'] || '').trim() === key);
  const now  = fmtDateTime_(new Date());
  if (row) {
    updateRow_('APP_CONFIG', row.__rowIndex, {
      ConfigValue: value, Deskripsi: deskripsi || row['Deskripsi'],
      UpdatedAt: now, UpdatedBy: user ? user.username : 'SYSTEM'
    });
  } else {
    appendRow_('APP_CONFIG', {
      ConfigKey: key, ConfigValue: value, Deskripsi: deskripsi || '',
      UpdatedAt: now, UpdatedBy: user ? user.username : 'SYSTEM'
    });
  }
  bumpVersion_('config');
  _EXEC.config = null;
}
