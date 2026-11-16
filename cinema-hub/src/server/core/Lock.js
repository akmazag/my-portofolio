/**
 * CINEMA HUB — Pembungkus LockService untuk operasi tulis.
 * Reentrant dalam satu eksekusi (pemanggilan bersarang tidak meminta lock dua kali).
 */
const Lock = (() => {
  let depth = 0;

  function run(fn, timeoutMs) {
    if (depth > 0) return fn();
    const lock = LockService.getScriptLock();
    try {
      lock.waitLock(timeoutMs || CH.LOCK_TIMEOUT_MS);
    } catch (e) {
      throw Errors.create('LOCK_TIMEOUT');
    }
    depth++;
    try {
      return fn();
    } finally {
      depth--;
      try { SpreadsheetApp.flush(); } catch (e) { /* non-fatal */ }
      lock.releaseLock();
    }
  }

  return { run };
})();
