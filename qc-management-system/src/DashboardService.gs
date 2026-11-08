/**
 * DashboardService.gs
 * Executive Dashboard — agregasi KPI sesuai scope pengguna.
 * @version 2.0.0
 *
 * Cache key: dash_<username>_<versi master.cleaning.visit.checklist.config.users>
 *  → otomatis segar setelah data apa pun berubah (bukan hanya cache milik pelaku).
 * Seluruh kalkulasi memakai engine yang sama dengan modul (Cleaning, Visit, Grading),
 * sehingga angka dashboard = angka modul.
 */

function apiDashboard(token) {
  return run_(token, function (u) {
    const key = CACHE_KEY_DASH_PREFIX + compact_(u.username) + '_' +
      dataVersion_('master', 'cleaning', 'visit', 'checklist', 'config', 'users');
    const data = cached_(key, CACHE_TTL_DASHBOARD, () => _buildDashboard_(u));
    data.recentActivity = recentActivity_(u, 10);   // tidak di-cache (selalu terbaru)
    return data;
  });
}

function _buildDashboard_(u) {
  const scope = getScope_(u);
  const ym = todayStr_().slice(0, 7);
  const today = todayStr_();

  // ── Workforce
  const roster = Object.values(getQcAreaRoster_());
  const scopeCodes = {};
  scope.forEach(r => { scopeCodes[r.KodeOutlet] = true; });
  const qcInScope = roster.filter(p => p.outlets.some(k => scopeCodes[k]));

  // ── Visit bulan berjalan + achievement periode
  const periode = getConfigNum_('visit_period_months', 3);
  const covMonth = computeVisitCoverage_(u, ym, ym);
  const covPeriod = computeVisitCoverage_(u, ym, addYm_(ym, periode - 1));
  const vInMonth = _visitsInScope_(u).filter(v => (v._rencana.indexOf(ym) === 0 || v._realisasi.indexOf(ym) === 0) && norm_(v['Status']) !== 'cancelled');
  const realisasi = vInMonth.filter(v => norm_(v['Status']) === 'completed').length;
  const outstanding = vInMonth.filter(v => ['planned', 'in progress', 'rescheduled'].includes(norm_(v['Status']))).length;
  const vp = covMonth.summary;
  const allOverdue = _visitsInScope_(u).filter(v => effectiveVisitStatus_(v, today) === 'Overdue').length;

  // ── Checklist / grading (bulan berjalan & keseluruhan)
  const gRows = _gradingRows_(u, {});
  const gMonth = gRows.filter(r => r.tanggal.indexOf(ym) === 0);
  const avgAll = aggregateScore_(gRows);
  const byQC = _groupScore_(gRows, r => r.qcArea || 'Tidak Diketahui').slice(0, 3);

  // ── Cleaning
  const cl = cleaningSummary_(u);

  return {
    totalOutlet:        scope.length,
    totalQCArea:        qcInScope.length,
    totalVisitBulanIni: vInMonth.length,
    realisasiVisit:     realisasi,
    outstandingVisit:   outstanding,
    visitAchievementBulanIni: covMonth.coveragePercent,
    visitAchievementPeriode:  covPeriod.coveragePercent,
    periodeBulan:       periode,
    outletBelumDikunjungi: covPeriod.outletBelum,
    checklistCompleted: gRows.length,
    checklistBulanIni:  gMonth.length,
    avgChecklistScore:  avgAll,
    avgChecklistBulanIni: aggregateScore_(gMonth),
    overallGrade:       gRows.length ? calculateGrade_(avgAll) : '-',
    pendingEvidence:    gRows.filter(r => r.statusDokumen !== 'Uploaded').length,
    cleaningStatus: {
      ok: cl.statusOK, warning: cl.statusWarning, overdue: cl.statusOverdue,
      noHistory: cl.noHistory, noInterval: cl.noInterval,
      complianceKursi: cl.complianceKursi, complianceKarpet: cl.complianceKarpet,
      outletTanpaInterval: cl.outletTanpaInterval
    },
    visitProgress: {
      planned: vp.planned + vp.upcoming, upcoming: vp.upcoming, inProgress: vp.inProgress,
      completed: vp.completed, overdue: allOverdue, rescheduled: vp.rescheduled, cancelled: vp.cancelled
    },
    topQCArea: byQC.map(q => ({ nama: q.nama, avgScore: q.avgScore, visitCount: q.visitCount, grade: q.grade })),
    generatedAt: fmtDateTime_(new Date()),
    scopeEmpty: scope.length === 0
  };
}
