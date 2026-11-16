/**
 * CINEMA HUB — Aturan bisnis murni (tanpa I/O) sehingga mudah diuji.
 * Tanggal berformat yyyy-MM-dd dan jam HH:mm dibandingkan sebagai string/menit
 * pada zona waktu aplikasi.
 */
const Rules = (() => {
  const PRIORITY_WEIGHT = { CRITICAL: 4, HIGH: 3, NORMAL: 2, LOW: 1 };

  /** INACTIVE | UPCOMING | ACTIVE | EXPIRED */
  function promoState(p, today) {
    if (!p || p.status !== 'ACTIVE') return 'INACTIVE';
    if (!p.start_date || !p.end_date) return 'INACTIVE';
    if (today < p.start_date) return 'UPCOMING';
    if (today > p.end_date) return 'EXPIRED';
    return 'ACTIVE';
  }

  function promoAppliesToOutlet(p, outletId) {
    if (!outletId) return true;
    const list = Utils.csv(p.outlets);
    return !list.length || list.indexOf('ALL') >= 0 || list.indexOf(outletId) >= 0;
  }

  /** CANCELLED | SCHEDULED | NOW_SHOWING | FINISHED */
  function showState(schedule, durationMin, today, nowMin) {
    if (schedule.status === 'CANCELLED') return 'CANCELLED';
    if (schedule.show_date < today) return 'FINISHED';
    if (schedule.show_date > today) return 'SCHEDULED';
    const start = Utils.timeToMin(schedule.show_time);
    if (start === null) return 'SCHEDULED';
    if (nowMin < start) return 'SCHEDULED';
    if (nowMin < start + (Number(durationMin) || 120)) return 'NOW_SHOWING';
    return 'FINISHED';
  }

  /**
   * Status upcoming berdasarkan DATA OPERASIONAL:
   *   NOW_SHOWING        → tanggal rilis tercapai DAN ada jadwal aktif hari ini (pindah ke Movie Today)
   *   AWAITING_SCHEDULE  → tanggal rilis tercapai tetapi belum ada jadwal (tetap di Upcoming)
   *   POSTPONED / PRESALE / COMING_SOON → dari data upcoming
   */
  function upcomingState(u, hasScheduleToday, today) {
    if (!u || u.status !== 'ACTIVE') return 'INACTIVE';
    if (u.upcoming_status === 'POSTPONED') return 'POSTPONED';
    if (u.release_date && u.release_date <= today) {
      return hasScheduleToday ? 'NOW_SHOWING' : 'AWAITING_SCHEDULE';
    }
    return u.upcoming_status === 'PRESALE' ? 'PRESALE' : 'COMING_SOON';
  }

  function listMatches(csvValue, value) {
    const list = Utils.csv(csvValue);
    if (!list.length || list.indexOf('ALL') >= 0) return true;
    return !!value && list.indexOf(value) >= 0;
  }

  /** Pengumuman terlihat bila terbit, belum kedaluwarsa, dan audiens cocok. */
  function announcementVisible(a, user, nowMs) {
    if (!a || a.status !== 'PUBLISHED') return false;
    if (a.publish_at && Utils.toMs(a.publish_at) > nowMs) return false;
    if (a.expire_at && Utils.toMs(a.expire_at) <= nowMs) return false;
    return listMatches(a.target_roles, user.role_id) &&
      listMatches(a.target_areas, user.area) &&
      listMatches(a.target_outlets, user.outlet_id);
  }

  function announcementSort(a, b) {
    if (!!b.is_pinned !== !!a.is_pinned) return b.is_pinned ? 1 : -1;
    const w = (PRIORITY_WEIGHT[b.priority] || 0) - (PRIORITY_WEIGHT[a.priority] || 0);
    if (w) return w;
    return Utils.toMs(b.publish_at || b.created_at) - Utils.toMs(a.publish_at || a.created_at);
  }

  return { promoState, promoAppliesToOutlet, showState, upcomingState, announcementVisible, announcementSort, listMatches };
})();
