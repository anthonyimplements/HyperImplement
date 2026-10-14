/**
 * scan-engine.mjs — shared, on-demand niche scan logic used by both the
 * CLI (niche-scraper.mjs) and the Command Center server (dashboard-server.mjs).
 *
 * YouTube: scrapes competitor channels' /videos AND /shorts tabs (public
 *   ytInitialData — no API key), scores each upload by outlier ratio
 *   (views vs that channel's own median), and returns long + short winners.
 * TikTok / Instagram: call Apify actors when an APIFY token is provided.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function loadChannels() {
  try { return JSON.parse(readFileSync(join(HERE, 'channels.json'), 'utf8')); }
  catch { return []; }
}

async function getPage(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'en-US,en' } });
  if (!r.ok) throw new Error(`${r.status} for ${url}`);
  return r.text();
}
function extractInitialData(html) {
  const m = html.match(/ytInitialData\s*=\s*(\{.+?\});<\/script>/s);
  if (!m) throw new Error('ytInitialData not found');
  return JSON.parse(m[1]);
}
function collect(node, key, out = []) {
  if (Array.isArray(node)) { for (const n of node) collect(n, key, out); return out; }
  if (node && typeof node === 'object') {
    if (key in node) out.push(node[key]);
    for (const v of Object.values(node)) collect(v, key, out);
  }
  return out;
}
function parseViews(text) {
  if (!text) return null;
  const m = String(text).replace(/,/g, '').match(/([\d.]+)\s*(thousand|million|billion|K|M|B)?/i);
  if (!m) return null;
  const mult = { thousand:1e3, million:1e6, billion:1e9, k:1e3, m:1e6, b:1e9 }[(m[2] || '').toLowerCase()] || 1;
  return Math.round(parseFloat(m[1]) * mult);
}
function parseAge(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  let m = t.match(/(\d+)\s*(second|minute|hour|day|week|month|year)/);        // "2 weeks ago"
  if (!m) m = t.match(/(\d+)\s*(mo|s|min|h|d|w|y)\b/);                          // "9h ago" / "1mo ago"
  if (!m) return null;
  const key = { second:'second', minute:'minute', hour:'hour', day:'day', week:'week', month:'month', year:'year',
                s:'second', min:'minute', h:'hour', d:'day', w:'week', mo:'month', y:'year' }[m[2]];
  const per = { second: 1/86400, minute: 1/1440, hour: 1/24, day: 1, week: 7, month: 30.4, year: 365 };
  return Math.round(Number(m[1]) * per[key]);
}
/** A metadata row is a view count if it has a digit, isn't an age, and isn't a duration. */
function pickViews(rows) {
  const explicit = rows.find(s => /views?$/i.test(s));
  if (explicit) return parseViews(explicit);
  const n = rows.find(s => /\d/.test(s) && !/ago$/i.test(s) && !/^\d{1,2}(:\d\d)+$/.test(s.trim()));
  return parseViews(n);
}
function parseDuration(text) {
  if (!text) return null;
  const p = String(text).trim().split(':').map(Number);
  if (p.some(isNaN)) return null;
  return p.reduce((a, n) => a * 60 + n, 0);
}
const median = a => { const s = [...a].sort((x, y) => x - y); const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };

async function scrapeVideos(handle) {
  const html = await getPage(`https://www.youtube.com/@${handle}/videos`);
  const data = extractInitialData(html);
  const subsLabel = (html.match(/"([\d.]+[KMB]? ?subscribers)"/) || [])[1];
  const subs = parseViews(subsLabel);
  const videos = [];
  for (const l of collect(data, 'lockupViewModel')) {
    const id = l?.contentId;
    if (!id || id.length !== 11) continue;
    const title = l?.metadata?.lockupMetadataViewModel?.title?.content;
    const rows = collect(l?.metadata, 'text').map(t => t?.content || t).filter(s => typeof s === 'string');
    const ageTxt = rows.find(s => /ago$/i.test(s));
    const durTxt = collect(l?.contentImage, 'text').map(t => t?.content || t)
      .find(s => typeof s === 'string' && /^\d+(:\d\d)+$/.test(s.trim()));
    if (!title) continue;
    videos.push({ id, title, views: pickViews(rows), ageDays: parseAge(ageTxt), durationSec: parseDuration(durTxt) });
  }
  for (const v of collect(data, 'richItemRenderer').map(r => r?.content?.videoRenderer).filter(Boolean)) {
    const id = v?.videoId;
    if (!id || videos.some(x => x.id === id)) continue;
    videos.push({
      id, title: v?.title?.runs?.[0]?.text || v?.title?.simpleText,
      views: parseViews(v?.viewCountText?.simpleText),
      ageDays: parseAge(v?.publishedTimeText?.simpleText),
      durationSec: parseDuration(v?.lengthText?.simpleText),
    });
  }
  return { subs, videos: videos.filter(v => v.title && v.views != null) };
}

async function scrapeShorts(handle) {
  // Shorts tab — items are reelItemRenderer / shortsLockupViewModel
  let data;
  try { data = extractInitialData(await getPage(`https://www.youtube.com/@${handle}/shorts`)); }
  catch { return []; }
  const out = [];
  for (const l of collect(data, 'shortsLockupViewModel')) {
    const id = l?.onTap?.innertubeCommand?.reelWatchEndpoint?.videoId
      || l?.entityId?.replace(/^shorts-shelf-item-/, '');
    const a = l?.accessibilityText || '';                      // "Title, 4 thousand views - play Short"
    const mv = a.match(/,\s*([\d.,]+\s*(?:thousand|million|billion|k|m|b)?)\s*views/i);
    const views = mv ? parseViews(mv[1]) : parseViews(l?.overlayMetadata?.secondaryText?.content);
    let title = l?.overlayMetadata?.primaryText?.content;
    if (!title && a) title = a.replace(/,\s*[\d.,]+\s*(?:thousand|million|billion|k|m|b)?\s*views.*/i, '').trim();
    if (!id || id.length !== 11 || !title) continue;
    if (out.some(x => x.id === id)) continue;
    out.push({ id, title, views, ageDays: null, durationSec: 30 });
  }
  return out;
}

/** Scan all competitor channels; return scored long + short winners. */
export async function scanNiche({ days = 120, top = 40, polite = 900 } = {}) {
  const channels = loadChannels();
  const perChannel = [];
  for (const handle of channels) {
    try {
      const { subs, videos } = await scrapeVideos(handle);
      const shorts = await scrapeShorts(handle).catch(() => []);
      // merge shorts not already captured
      for (const s of shorts) if (!videos.some(v => v.id === s.id)) videos.push(s);
      perChannel.push({ handle, subs, videos });
    } catch (e) {
      perChannel.push({ handle, error: e.message, videos: [] });
    }
    if (polite) await new Promise(r => setTimeout(r, polite));
  }

  const all = [];
  const isShort = v => v.durationSec != null && v.durationSec <= 60;
  for (const c of perChannel) {
    const longs  = c.videos.filter(v => v.views != null && !isShort(v));
    const shorts = c.videos.filter(v => v.views != null &&  isShort(v));
    const longMed  = median(longs.map(v => v.views))  || 1;
    const shortMed = median(shorts.map(v => v.views)) || 1;
    const push = (v, fmt, med) => {
      if (v.views == null) return;
      if (v.ageDays != null && v.ageDays > days) return;   // recency filter (only when age is known)
      all.push({
        ...v, channel: c.handle, subs: c.subs, channelMedian: med,
        outlier: +(v.views / med).toFixed(2),
        vsSubs: c.subs ? +(v.views / c.subs).toFixed(2) : null,
        format: fmt,
        url: fmt === 'short' ? `https://www.youtube.com/shorts/${v.id}` : `https://www.youtube.com/watch?v=${v.id}`,
        thumbnail: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
      });
    };
    longs.forEach(v => push(v, 'long', longMed));
    shorts.forEach(v => push(v, 'short', shortMed));
  }
  const long = all.filter(v => v.format === 'long').sort((a, b) => b.outlier - a.outlier).slice(0, top);
  const short = all.filter(v => v.format === 'short').sort((a, b) => b.outlier - a.outlier).slice(0, top);
  return {
    scrapedAt: new Date().toISOString(), windowDays: days, source: 'youtube',
    channels: perChannel.map(c => ({ handle: c.handle, subs: c.subs, videoCount: c.videos.length, error: c.error })),
    totalVideos: all.length, long, short,
  };
}

/** Run an Apify actor synchronously and return its dataset items. */
async function runApifyActor(actor, input, token) {
  const r = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  if (!r.ok) throw new Error(`Apify ${actor} → ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

export async function scanTikTok(query, token, limit = 30) {
  if (!token) return { needsApify: true, source: 'tiktok' };
  const items = await runApifyActor('clockworks~tiktok-scraper', {
    searchQueries: [query], resultsPerPage: limit, shouldDownloadVideos: false, shouldDownloadCovers: false,
  }, token);
  const vids = (items || []).map(v => ({
    id: v.id, title: v.text || '', views: v.playCount || 0, likes: v.diggCount || 0,
    comments: v.commentCount || 0, shares: v.shareCount || 0,
    author: v.authorMeta?.name || v['authorMeta.name'] || '',
    url: v.webVideoUrl, thumbnail: v.videoMeta?.coverUrl || v.covers?.default || '',
    createTime: v.createTimeISO || null, format: 'short', platform: 'tiktok',
  })).sort((a, b) => b.views - a.views);
  return { scrapedAt: new Date().toISOString(), source: 'tiktok', query, videos: vids };
}

export async function scanInstagram(query, token, limit = 30) {
  if (!token) return { needsApify: true, source: 'instagram' };
  const items = await runApifyActor('apify~instagram-scraper', {
    search: query, searchType: 'hashtag', resultsType: 'posts', resultsLimit: limit,
  }, token);
  const vids = (items || []).filter(p => p.type === 'Video' || p.videoUrl).map(p => ({
    id: p.id || p.shortCode, title: p.caption || '', views: p.videoViewCount || p.videoPlayCount || 0,
    likes: p.likesCount || 0, comments: p.commentsCount || 0, author: p.ownerUsername || '',
    url: p.url, thumbnail: p.displayUrl || '', createTime: p.timestamp || null,
    format: 'short', platform: 'instagram',
  })).sort((a, b) => b.views - a.views);
  return { scrapedAt: new Date().toISOString(), source: 'instagram', query, videos: vids };
}
