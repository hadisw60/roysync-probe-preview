// loadWholeVideo(video, url): fetch the whole clip in small range requests, then play it from memory.
// A <video> streaming a multi-megabyte clip in one long HTTPS transfer can hang for good where connections stall
// or get cut after about a megabyte (the black or frozen clips seen on 2026-10-12). Pieces of 512 KB, three at a
// time, each with a time limit and retried, always arrive. If the pieces cannot be had at all, the browser streams
// the file as before.
(function () {
  const CHUNK = 512 * 1024, TRIES = 8, WORKERS = 3, PIECE_MS = 20000;
  const wait = ms => new Promise(r => setTimeout(r, ms));

  async function part(url, from, to) {   // one range, retried; resolves to [blob, size of the whole file]
    for (let i = 1; ; i++) {
      const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), PIECE_MS);   // a stalled piece is retried
      try {
        const r = await fetch(url, { headers: { Range: `bytes=${from}-${to}` }, signal: ctl.signal });
        if (r.status !== 206) {           // no range support: retrying would download the whole file again
          ctl.abort();
          throw Object.assign(new Error('no ranges: HTTP ' + r.status), { fatal: true });
        }
        const total = +(r.headers.get('Content-Range') || '').split('/')[1];
        const blob = await r.blob();
        if (blob.size !== Math.min(to, total - 1) - from + 1) throw new Error('short piece');
        return [blob, total];
      } catch (e) {
        if (e.fatal || i >= TRIES) throw e;
        await wait(300 * i);
      } finally { clearTimeout(timer); }
    }
  }

  async function fetchWhole(url) {
    const [first, total] = await part(url, 0, CHUNK - 1);
    if (!(total > 0)) throw new Error('no size');
    const ranges = [];
    for (let at = first.size; at < total; at += CHUNK) ranges.push([at, Math.min(at + CHUNK, total) - 1]);
    const parts = new Array(ranges.length);
    let next = 0;
    const worker = async () => { while (next < ranges.length) { const k = next++; parts[k] = (await part(url, ...ranges[k]))[0]; } };
    await Promise.all(Array.from({ length: WORKERS }, worker));
    return new Blob([first, ...parts], { type: 'video/mp4' });
  }

  // never rejects, so a chain of loads keeps going. An autoplay clip is started here: the page's own play() ran
  // while it had no source yet, and setting one later does not restart it.
  window.loadWholeVideo = (v, url) => fetchWhole(url)
    .then(b => { v.src = URL.createObjectURL(b); })
    .catch(() => { v.preload = 'auto'; v.src = url; })
    .then(() => { if (v.autoplay) v.play().catch(() => {}); });
})();
