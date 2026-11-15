// Preload clock-alignment shim so Node's Date.now() matches Chert's server clock (prevents >250ms forward-skew call declines).
const OrigDate = globalThis.Date;
let offsetMs = 0;

try {
  const t0 = OrigDate.now();
  const res = await fetch('https://app.trychert.com/api/health', {
    method: 'HEAD',
    signal: AbortSignal.timeout(4000),
  });
  const t1 = OrigDate.now();
  const hdr = res.headers.get('date');
  if (hdr) {
    // HTTP Date header is truncated to whole seconds (~+500ms expected mean).
    const serverMs = OrigDate.parse(hdr) + 500;
    const localMid = (t0 + t1) / 2;
    const skew = localMid - serverMs;
    if (Math.abs(skew) > 200 && Math.abs(skew) < 60_000) {
      offsetMs = -Math.round(skew);
    }
  }
} catch {
  // Proceed with system clock if offline
}

if (offsetMs !== 0) {
  class SyncedDate extends OrigDate {
    constructor(...args) {
      if (args.length === 0) {
        super(OrigDate.now() + offsetMs);
      } else {
        super(...args);
      }
    }
    static now() {
      return OrigDate.now() + offsetMs;
    }
  }
  globalThis.Date = SyncedDate;
}
