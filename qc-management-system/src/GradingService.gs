/**
 * GradingService.gs
 * Checklist Result & QC Area Grading.
 * @version 2.0.0
 *
 * Rumus (PRD §10.3):  Grading% = Σ Skor Aktual / Σ Skor Maksimum × 100
 *   - APP_CONFIG.grading_method = 'ratio'   (default, sesuai PRD) → agregasi Σ/Σ
 *   - APP_CONFIG.grading_method = 'average' → rata-rata persentase per checklist (perilaku v1)
 *   - Item N/A tidak dihitung ke skor maksimum.
 *   - Checklist berstatus Deleted tidak dihitung; bila pdf_required = true,
 *     hanya checklist dengan dokumen PDF yang masuk grading final.
 * Produktivitas kunjungan (Visit Achievement) ditampilkan TERPISAH dari kualitas (Grade).
 *
 * Perbaikan v2: round_ tidak terdefinisi (dashboard & grading error), temuan item
 * tidak difilter scope (kebocoran data), detail QC Area membaca kolom yang salah.
 */

function calculateGrade_(percentage) {
  const p = Number(percentage) || 0;
  if (p >= getConfigNum_('grade_A_min', DEFAULT_GRADE.A_MIN)) return 'A';
  if (p >= getConfigNum_('grade_B_min', DEFAULT_GRADE.B_MIN)) return 'B';
  if (p >= getConfigNum_('grade_C_min', DEFAULT_GRADE.C_MIN)) return 'C';
  if (p >= getConfigNum_('grade_D_min', DEFAULT_GRADE.D_MIN)) return 'D';
  return 'E';
}

/** Agregasi skor sesuai metode konfigurasi. rows: [{scoreAktual, scoreMax, gradePercent}] */
function aggregateScore_(rows) {
  if (!rows.length) return 0;
  if (getConfig_('grading_method', 'ratio') === 'average') {
    return round_(rows.reduce((s, r) => s + r.gradePercent, 0) / rows.length, 1);
  }
  const a = rows.reduce((s, r) => s + r.scoreAktual, 0), m = rows.reduce((s, r) => s + r.scoreMax, 0);
  return m > 0 ? round_(a / m * 100, 1) : 0;
}

/** Checklist header valid dalam scope + filter. */
function _gradingRows_(u, f) {
  f = f || {};
  const sm = scopeMap_(u);
  const from = f.from || '0000-00-00', to = f.to || '9999-99-99';
  const pdfRequired = getConfigBool_('pdf_required', false);
  return readTable_('CHECKLIST_HEADER').filter(h => norm_(h['Status']) !== 'deleted').map(h => {
    const o = outletInScope_(sm, h['KodeOutlet'], h['Outlet']);
    if (!o) return null;
    const tgl = fmtDate_(toDate_(h['Tanggal'])) || '';
    if (tgl < from || tgl > to) return null;
    if (f.area && norm_(o.Area) !== norm_(f.area)) return null;
    if (f.kelas && norm_(o.Class) !== norm_(f.kelas)) return null;
    if (f.region && norm_(o.RM) !== norm_(f.region)) return null;
    if (f.qcArea && compact_(h['QCArea']) !== compact_(f.qcArea)) return null;
    if (f.outlet && norm_(o.NamaOutlet) !== norm_(f.outlet) && norm_(o.KodeOutlet) !== norm_(f.outlet)) return null;
    const kats = String(h['Kategori'] || '').split(',').map(canonKategori_);
    if (f.kategori && kats.indexOf(canonKategori_(f.kategori)) < 0) return null;
    const docId = String(h['FileDocumentID'] || '');
    const statusDok = String(h['StatusDokumen'] || (docId ? 'Uploaded' : 'Pending'));
    if (pdfRequired && statusDok !== 'Uploaded') return null;
    const sa = Number(h['TotalScoreAktual'] || 0), smx = Number(h['TotalScoreMax'] || 0);
    const pct = smx > 0 ? sa / smx * 100 : Number(h['GradePercentage'] || 0);
    return {
      idChecklist: String(h['IDChecklist'] || ''), idVisit: String(h['IDVisit'] || ''), tanggal: tgl,
      qcArea: String(h['QCArea'] || ''), outlet: o.NamaOutlet, kodeOutlet: o.KodeOutlet, kelas: o.Class || '-',
      area: o.Area || '-', region: o.RM || '-', kategori: String(h['Kategori'] || ''),
      scoreAktual: sa, scoreMax: smx, gradePercent: round_(pct, 1), grade: calculateGrade_(pct),
      fileDocumentId: docId, statusDokumen: statusDok, pdfUrl: ''
    };
  }).filter(Boolean).sort((a, b) => (a.tanggal < b.tanggal ? 1 : -1));
}

function _groupScore_(rows, keyFn) {
  const g = {};
  rows.forEach(r => { const k = keyFn(r); (g[k] = g[k] || []).push(r); });
  return Object.keys(g).map(k => {
    const s = aggregateScore_(g[k]);
    return { nama: k, avgScore: s, visitCount: g[k].length, grade: calculateGrade_(s),
             totalAktual: g[k].reduce((x, r) => x + r.scoreAktual, 0), totalMax: g[k].reduce((x, r) => x + r.scoreMax, 0) };
  }).sort((a, b) => b.avgScore - a.avgScore);
}

/**
 * @param {Object} f {from, to, area, kelas, region, qcArea, outlet, kategori}
 */
function apiGrading(token, f) {
  return run_(token, function (u) {
    f = f || {};
    const rows = _gradingRows_(u, f);
    const avg = aggregateScore_(rows);
    const dist = { A: 0, B: 0, C: 0, D: 0, E: 0 };
    rows.forEach(r => { dist[r.grade] = (dist[r.grade] || 0) + 1; });

    const byOutlet = _groupScore_(rows, r => r.outlet);
    const byQCArea = _groupScore_(rows, r => r.qcArea || 'Tidak Diketahui');

    // Produktivitas kunjungan per QC Area (indikator terpisah)
    const fromYm = String(f.from || todayStr_()).slice(0, 7), toYm = String(f.to || todayStr_()).slice(0, 7);
    let cov = null;
    try { cov = computeVisitCoverage_(u, fromYm, toYm); } catch (e) { Logger.log('[apiGrading] coverage: ' + e.message); }
    const covMap = {};
    (cov ? cov.byQCArea : []).forEach(q => { covMap[compact_(q.nama)] = q; });
    byQCArea.forEach((q, i) => {
      q.rank = i + 1;
      const c = covMap[compact_(q.nama)];
      q.totalOutlet = c ? c.totalOutlet : 0;
      q.visitedOutlet = c ? c.visited : 0;
      q.visitAchievement = c ? c.coverage : 0;
    });

    // Tren bulanan (6 bulan terakhir data)
    const mg = {};
    rows.forEach(r => { const ym = r.tanggal.slice(0, 7); (mg[ym] = mg[ym] || []).push(r); });
    const monthlyTrend = Object.keys(mg).sort().slice(-6).map(ym => ({ bulan: ym, avgScore: aggregateScore_(mg[ym]), visitCount: mg[ym].length }));

    // Temuan: hanya item dari checklist yang lolos filter & scope
    const ids = {};
    rows.forEach(r => { ids[r.idChecklist] = true; });
    const itemScores = {};
    if (rows.length) {
      readColumns_('CHECKLIST_DETAIL', ['IDChecklist', 'Kategori', 'NamaItem', 'Score', 'ScoreMax', 'IsNA']).forEach(d => {
        if (!ids[String(d.IDChecklist)] || isTrue_(d.IsNA)) return;
        const sc = Number(d.Score), mx = Number(d.ScoreMax) || 5;
        if (!isFinite(sc) || d.Score === '') return;
        const key = String(d.NamaItem || '');
        if (!itemScores[key]) itemScores[key] = { namaItem: key, kategori: String(d.Kategori || ''), s: [], m: [] };
        itemScores[key].s.push(sc); itemScores[key].m.push(mx);
      });
    }
    const topFindings = Object.values(itemScores).map(it => {
      const total = it.s.reduce((a, b) => a + b, 0), max = it.m.reduce((a, b) => a + b, 0);
      return { namaItem: it.namaItem, kategori: it.kategori, avgScore: round_(total / it.s.length, 2),
               scoreMax: round_(max / it.m.length, 0), checkCount: it.s.length,
               failRate: round_(it.s.filter((s, i) => s / it.m[i] <= 0.4).length / it.s.length * 100, 1) };
    }).sort((a, b) => a.avgScore / (a.scoreMax || 5) - b.avgScore / (b.scoreMax || 5)).slice(0, 10);

    return {
      rows: rows, byOutlet: byOutlet, byQCArea: byQCArea,
      summary: { total: rows.length, avgScore: avg, overallGrade: rows.length ? calculateGrade_(avg) : '-',
                 gradeDistribution: dist, method: getConfig_('grading_method', 'ratio'),
                 pendingEvidence: rows.filter(r => r.statusDokumen !== 'Uploaded').length,
                 visitAchievement: cov ? cov.coveragePercent : 0 },
      monthlyTrend: monthlyTrend,
      lowestScoreOutlets: byOutlet.slice(-5).reverse(),
      topFindings: topFindings
    };
  });
}

/** Detail performa satu QC Area. */
function apiGradingDetail(token, namaQCArea, filters) {
  return run_(token, function (u) {
    required_(namaQCArea, 'Nama QC Area');
    const f = filters || {};
    const rows = _gradingRows_(u, Object.assign({}, f, { qcArea: namaQCArea }));
    const sm = scopeMap_(u);
    const person = getQcAreaRoster_()[compact_(namaQCArea)] || { nama: namaQCArea, outlets: [], jabatan: 'QC Area', area: '', regio: '' };
    const assigned = person.outlets.map(k => sm[norm_(k)]).filter(Boolean);
    const visits = _visitsInScope_(u).filter(v => compact_(v['NamaQCArea']) === compact_(namaQCArea) && norm_(v['Status']) !== 'cancelled');
    const done = visits.filter(v => norm_(v['Status']) === 'completed');
    const visited = {};
    done.forEach(v => { visited[v._kode] = v._realisasi || v._rencana; });
    const score = aggregateScore_(rows);
    const mg = {};
    rows.forEach(r => { const ym = r.tanggal.slice(0, 7); (mg[ym] = mg[ym] || []).push(r); });
    return {
      personel: { nama: person.nama, jabatan: person.jabatan || 'QC Area', area: person.area || '-', region: person.regio || '-',
                  totalOutlet: assigned.length },
      kpi: { totalVisit: visits.length, completedVisit: done.length,
             completionRate: visits.length ? round_(done.length / visits.length * 100, 1) : 0,
             visitAchievement: assigned.length ? round_(assigned.filter(o => visited[o.KodeOutlet]).length / assigned.length * 100, 1) : 0,
             checklistCount: rows.length, avgScore: score, grade: rows.length ? calculateGrade_(score) : '-' },
      monthlyTrend: Object.keys(mg).sort().slice(-6).map(ym => ({ bulan: ym, avgScore: aggregateScore_(mg[ym]), count: mg[ym].length })),
      outletDistribution: assigned.map(o => ({ nama: o.NamaOutlet, kode: o.KodeOutlet, kelas: o.Class || '-', area: o.Area || '-',
                                               isVisited: !!visited[o.KodeOutlet], terakhir: visited[o.KodeOutlet] || '' })),
      checklists: rows.map(r => ({ idChecklist: r.idChecklist, tanggal: r.tanggal, outlet: r.outlet, kategori: r.kategori,
                                   score: r.gradePercent, grade: r.grade }))
    };
  });
}
