/**
 * CINEMA HUB — Dashboard: seluruh widget dalam SATU round-trip.
 * Setiap seksi hanya diisi bila pengguna memiliki permission modulnya (dicek di server).
 */
const DashboardService = (() => {
  function movieCard(movie) {
    return {
      movie_id: movie.movie_id,
      title: movie.title,
      genres: Lookups.labels('GENRE', movie.genre),
      duration_min: movie.duration_min,
      age_rating: movie.age_rating,
      synopsis: String(movie.synopsis || '').slice(0, 220),
      poster_url: movie.poster_url || '',
      poster_file_id: movie.poster_file_id || ''
    };
  }

  /** Ringkasan jadwal hari ini, dikelompokkan per film. Scope ke outlet user bila tersedia. */
  function moviesToday(user, today, nowMin) {
    const movies = Repo.table('MOVIES');
    const all = Repo.table('MOVIE_TODAY').all().filter((s) => s.show_date === today && s.status !== 'ARCHIVED');
    let scoped = all;
    let scopeOutlet = '';
    if (user.outlet_id && all.some((s) => s.outlet_id === user.outlet_id)) {
      scoped = all.filter((s) => s.outlet_id === user.outlet_id || !s.outlet_id);
      scopeOutlet = user.outlet_id;
    }
    const byMovie = {};
    scoped.forEach((s) => {
      const movie = movies.findById(s.movie_id);
      if (!movie || movie.status !== 'ACTIVE') return;
      const state = Rules.showState(s, movie.duration_min, today, nowMin);
      const g = byMovie[s.movie_id] || (byMovie[s.movie_id] = { movie, shows: [] });
      g.shows.push({ time: s.show_time, studio: s.studio, outlet_id: s.outlet_id, state });
    });
    const items = Object.keys(byMovie).map((id) => {
      const g = byMovie[id];
      g.shows.sort((a, b) => a.time.localeCompare(b.time));
      const nowShowing = g.shows.some((x) => x.state === 'NOW_SHOWING');
      const next = g.shows.find((x) => x.state === 'SCHEDULED');
      const remaining = g.shows.filter((x) => x.state === 'SCHEDULED').length;
      return Object.assign(movieCard(g.movie), {
        state: nowShowing ? 'NOW_SHOWING' : (next ? 'SCHEDULED' : (g.shows.every((x) => x.state === 'CANCELLED') ? 'CANCELLED' : 'FINISHED')),
        next_show: next ? next.time : '',
        show_count: g.shows.filter((x) => x.state !== 'CANCELLED').length,
        remaining_count: remaining,
        times: g.shows.filter((x) => x.state !== 'CANCELLED').map((x) => x.time).filter((t, i, arr) => arr.indexOf(t) === i)
      });
    });
    const order = { NOW_SHOWING: 0, SCHEDULED: 1, FINISHED: 2, CANCELLED: 3 };
    items.sort((a, b) => (order[a.state] - order[b.state]) || String(a.next_show || '99').localeCompare(String(b.next_show || '99')) || a.title.localeCompare(b.title));
    return {
      items,
      movieCount: items.length,
      showCount: scoped.filter((s) => s.status === 'ACTIVE').length,
      scheduledMovieIds: all.filter((s) => s.status === 'ACTIVE').map((s) => s.movie_id),
      outlet: scopeOutlet ? { id: scopeOutlet, name: Lookups.outletName(scopeOutlet) } : null
    };
  }

  function upcoming(today, scheduledIds, limit) {
    const scheduled = {};
    scheduledIds.forEach((id) => { scheduled[id] = true; });
    const movies = Repo.table('MOVIES');
    const rows = Repo.table('UPCOMING_MOVIES').all()
      .map((u) => ({ u, movie: movies.findById(u.movie_id), state: Rules.upcomingState(u, !!scheduled[u.movie_id], today) }))
      .filter((x) => x.movie && x.movie.status === 'ACTIVE' && x.state !== 'INACTIVE' && x.state !== 'NOW_SHOWING')
      .sort((a, b) => String(a.u.release_date).localeCompare(String(b.u.release_date)));
    return {
      total: rows.length,
      items: rows.slice(0, limit).map((x) => Object.assign(movieCard(x.movie), {
        release_date: x.u.release_date,
        days_left: Utils.daysBetween(today, x.u.release_date),
        state: x.state
      }))
    };
  }

  function promos(user, today, limit) {
    const active = Repo.table('PROMOS').all()
      .filter((p) => Rules.promoState(p, today) === 'ACTIVE' && Rules.promoAppliesToOutlet(p, user.outlet_id))
      .sort((a, b) => String(a.end_date).localeCompare(String(b.end_date)));
    return {
      total: active.length,
      items: active.slice(0, limit).map((p) => ({
        promo_id: p.promo_id,
        promo_name: p.promo_name,
        description: String(p.description || '').slice(0, 160),
        category: Lookups.label('PROMO_CATEGORY', p.category),
        start_date: p.start_date,
        end_date: p.end_date,
        days_left: Utils.daysBetween(today, p.end_date),
        image_url: p.image_url || ''
      }))
    };
  }

  function announcements(user, limit) {
    const nowMs = Date.now();
    const visible = Repo.table('ANNOUNCEMENTS').all()
      .filter((a) => Rules.announcementVisible(a, user, nowMs))
      .sort(Rules.announcementSort);
    const map = (a) => ({
      announcement_id: a.announcement_id,
      title: a.title,
      excerpt: String(a.body_md || '').replace(/[#*_>`\[\]]/g, '').slice(0, 180),
      category: Lookups.label('ANNOUNCEMENT_CATEGORY', a.category),
      priority: a.priority || 'NORMAL',
      is_pinned: a.is_pinned === true,
      publish_at: a.publish_at || a.created_at,
      author_name: a.author_name
    });
    return {
      total: visible.length,
      critical: visible.filter((a) => a.priority === 'CRITICAL').slice(0, 3).map(map),
      items: visible.slice(0, limit).map(map)
    };
  }

  function education(today, limit) {
    const since = Utils.addDays(today, -30);
    const published = Repo.table('EDUCATION').all()
      .filter((e) => e.status === 'PUBLISHED')
      .sort((a, b) => Utils.toMs(b.published_at || b.created_at) - Utils.toMs(a.published_at || a.created_at));
    return {
      total: published.length,
      newCount: published.filter((e) => String(e.published_at || e.created_at).slice(0, 10) >= since).length,
      items: published.slice(0, limit).map((e) => ({
        education_id: e.education_id,
        title: e.title,
        category: Lookups.label('EDUCATION_CATEGORY', e.category),
        format: e.format,
        format_label: Lookups.label('EDUCATION_FORMAT', e.format),
        estimated_minutes: e.estimated_minutes,
        is_featured: e.is_featured === true,
        published_at: e.published_at || e.created_at
      }))
    };
  }

  function problems(limit) {
    const solutions = Repo.table('SOLUTIONS').all();
    const published = Repo.table('PROBLEMS').all()
      .filter((p) => p.status === 'PUBLISHED')
      .sort((a, b) => Utils.toMs(b.updated_at) - Utils.toMs(a.updated_at));
    return {
      total: published.length,
      items: published.slice(0, limit).map((p) => ({
        problem_id: p.problem_id,
        title: p.title,
        category: Lookups.label('PROBLEM_CATEGORY', p.category),
        outlet_name: Lookups.outletName(p.outlet_id),
        verified: solutions.some((s) => s.problem_id === p.problem_id && s.status === 'APPROVED' && s.is_verified === true),
        helpful_count: p.helpful_count || 0,
        updated_at: p.updated_at
      }))
    };
  }

  function summary(ctx) {
    const today = Utils.today();
    const nowMin = Utils.timeToMin(Utils.nowTime());
    const user = ctx.user;
    const out = { today, serverTime: Utils.nowIso(), stats: {}, sections: {} };

    if (Rbac.can(ctx, 'movie.view')) {
      const mt = moviesToday(user, today, nowMin);
      const up = upcoming(today, mt.scheduledMovieIds, 8);
      out.sections.moviesToday = { items: mt.items.slice(0, 12), outlet: mt.outlet, total: mt.movieCount };
      out.sections.upcoming = up;
      out.stats.moviesToday = mt.movieCount;
      out.stats.showsToday = mt.showCount;
      out.stats.upcoming = up.total;
    }
    if (Rbac.can(ctx, 'promo.view')) {
      const pr = promos(user, today, 6);
      out.sections.promos = pr;
      out.stats.activePromos = pr.total;
    }
    if (Rbac.can(ctx, 'announcement.view')) {
      out.sections.announcements = announcements(user, 5);
    }
    if (Rbac.can(ctx, 'education.view')) {
      const ed = education(today, 4);
      out.sections.education = ed;
      out.stats.newEducation = ed.newCount;
    }
    if (Rbac.can(ctx, 'problem.view')) {
      out.sections.problems = problems(4);
    }
    return out;
  }

  return { summary, moviesToday, upcoming };
})();
