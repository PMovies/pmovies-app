#!/usr/bin/env node
/**
 * PMovies Weekly — Newsletter Generator
 * ─────────────────────────────────────
 * Runs Thursday night. Builds the newsletter for the week
 * (Saturday → Friday) and saves a Top 100 snapshot for movers tracking.
 *
 * Usage:
 *   node newsletter-generator.js
 *
 * Requirements:
 *   Node 18+ (built-in fetch). No npm install needed.
 */

'use strict';

/* ─────────────── CONFIG ─────────────── */

const RTDB       = 'https://pmovies-f0ddc-default-rtdb.europe-west1.firebasedatabase.app';
const TMDB_KEY   = 'd04038fc4e0708bd069b323b220d5dc0';
const TMDB_BASE  = 'https://api.themoviedb.org/3';
const YT_KEY     = 'AIzaSyDubh6LcvxTzsP52MW8-zg_I3kq-TT60CE';
const YT_BASE    = 'https://www.googleapis.com/youtube/v3';
const YT_HANDLE  = 'PMovies155';
const SITE_URL   = 'https://p-movies.com';

// ── Force a specific issue number for the first real run.
// Set to null after Issue #1 is published — auto-increments from then on.
const FORCE_ISSUE_NUMBER = 1; // Reset — Thursday publishes real Issue #1. Set back to null after Friday.

// How many risers/fallers to include
const MOVERS_COUNT = 3;

// How many now-playing films to include
const CINEMA_COUNT = 3;

// Minimum votes a film needs to appear in movers
const MIN_VOTES = 3;

/* ── Backed Creators (keep in sync with index.html BACKED_CYCLES) ── */

const BACKED_BASE_MS = new Date('2026-05-04T00:00:00Z').getTime();
const MS_PER_WEEK    = 7 * 24 * 60 * 60 * 1000;

const BACKED_CYCLES = [
  {
    startDate: '2026-05-04',
    creators: [
      {
        name: 'Doaa Salah — دعاء صلاح',
        initials: 'DS',
        platform: 'youtube',
        bio: 'أركيد — محتوى فيديو جيمز ممتع وخفيف، اعتبرها زي قعدة مع صاحبك بيشرحلك.',
        url: 'https://www.youtube.com/@Arcade-Dou',
        handle: '@Arcade-Dou',
      },
      {
        name: 'Mahmoud Waleed — محمود وليد',
        initials: 'MW',
        platform: 'youtube',
        bio: 'دايماً عنده منظور مختلف لأي حاجة بيتفرج عليها — سماع كلامه عن الأفلام ممتع جداً.',
        url: 'https://www.youtube.com/@mahmoudreviews',
        handle: '@mahmoudreviews',
      },
      {
        name: 'Fouad — فؤاد',
        initials: 'FO',
        platform: 'youtube',
        bio: 'فؤاد عنده كتير قوي لسة — عنده أكتر من ما هو نفسه متخيل حتى.',
        url: 'https://www.youtube.com/@Cinemastationn',
        handle: '@Cinemastationn',
      },
    ],
  },
  {
    startDate: '2026-05-11',
    creators: [
      {
        name: 'Ahmed Bassiouny — أحمد بسيوني',
        initials: 'AB',
        platform: 'youtube',
        bio: 'أحمد بيقدم محتوى سينمائي وموسيقي مميز، وعنده إستمرارية مش هتلاقيها عند حد.',
        url: 'https://www.youtube.com/@felcinema1997',
        handle: '@felcinema1997 | في السينما',
      },
      {
        name: 'Ahmed Shousha — أحمد شوشة',
        initials: 'AS',
        platform: 'tiktok',
        bio: 'ملك موسم الجوايز والمهرجانات — بتغطياته وتوقعاته.',
        url: 'https://www.tiktok.com/@ahmedshoushareviews',
        handle: '@ahmedshoushareviews',
      },
      {
        name: 'Michael Mansour',
        initials: 'MM',
        platform: 'blog',
        bio: 'For Those Who Feel Changed When The Credits Roll — memory, meaning, and the art that changes us.',
        url: 'https://miconfilm.com/',
        handle: '@MicOnFilm',
      },
    ],
  },
  // ── Add new weeks below — copy the block above ──
];

/* ─────────────── HELPERS ─────────────── */

// PMovies week = Saturday → Friday.
// The week key is the ISO date of the Saturday that starts the week (e.g. "2026-05-09").

function saturdayOfWeek(date = new Date()) {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  // getUTCDay(): 0=Sun 1=Mon 2=Tue 3=Wed 4=Thu 5=Fri 6=Sat
  // Days to subtract to reach the most recent Saturday:
  const offset = d.getUTCDay() === 6 ? 0 : d.getUTCDay() + 1;
  d.setUTCDate(d.getUTCDate() - offset);
  return d;
}

function weekKey(date = new Date()) {
  return saturdayOfWeek(date).toISOString().slice(0, 10); // "2026-05-09"
}

function prevWeekKey(key) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

function fridayOfWeek(saturdayDate) {
  const d = new Date(saturdayDate);
  d.setUTCDate(d.getUTCDate() + 6); // Sat + 6 = Fri
  return d;
}

function formatDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function formatShortDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

async function fbGet(path) {
  const res = await fetch(`${RTDB}/${path}.json`);
  if (!res.ok) throw new Error(`Firebase GET ${path} failed: ${res.status}`);
  return res.json();
}

async function fbPut(path, data) {
  const res = await fetch(`${RTDB}/${path}.json`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase PUT ${path} failed: ${res.status}`);
  return res.json();
}

async function fbPatch(path, data) {
  const res = await fetch(`${RTDB}/${path}.json`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Firebase PATCH ${path} failed: ${res.status}`);
  return res.json();
}

function pick(arr, n = 1) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return n === 1 ? shuffled[0] : shuffled.slice(0, n);
}

/* ─────────────── STEP 1: Get current Top 100 ─────────────── */

async function fetchTop100() {
  console.log('📊 Fetching Top 100 vote data…');
  const data = await fbGet('communityVotes');
  if (!data) return [];
  return Object.entries(data)
    .map(([id, m]) => ({ id, ...m }))
    .filter(m => (m.votes || 0) >= MIN_VOTES)
    .sort((a, b) => (b.votes || 0) - (a.votes || 0) || (a.firstVoted || 0) - (b.firstVoted || 0))
    .slice(0, 100)
    .map((m, i) => ({ id: m.id, rank: i + 1, title: m.title || '', year: m.year || '', votes: m.votes || 0 }));
}

/* ─────────────── STEP 2: Save snapshot ─────────────── */

async function saveSnapshot(weekKey, films) {
  console.log(`💾 Saving snapshot for ${weekKey}…`);
  const snapshot = {
    weekKey,
    timestamp: Date.now(),
    films: Object.fromEntries(films.map(f => [f.id, { rank: f.rank, title: f.title, year: f.year, votes: f.votes }])),
  };
  await fbPut(`snapshots/${weekKey}`, snapshot);
  return snapshot;
}

/* ─────────────── STEP 3: Calculate movers ─────────────── */

async function calculateMovers(currentFilms, prevWeekKey) {
  console.log(`📈 Comparing to snapshot ${prevWeekKey}…`);
  let prevSnapshot = null;
  try {
    prevSnapshot = await fbGet(`snapshots/${prevWeekKey}`);
  } catch (e) {
    console.log('  ⚠️  No previous snapshot found — skipping movers.');
    return { risers: [], fallers: [] };
  }

  if (!prevSnapshot || !prevSnapshot.films) {
    console.log('  ⚠️  Previous snapshot empty — skipping movers.');
    return { risers: [], fallers: [] };
  }

  const prev = prevSnapshot.films;
  const changes = currentFilms
    .filter(f => prev[f.id])
    .map(f => ({ ...f, change: (prev[f.id].rank || 101) - f.rank }))
    .filter(f => f.change !== 0);

  const risers = changes
    .filter(f => f.change > 0)
    .sort((a, b) => b.change - a.change)
    .slice(0, MOVERS_COUNT);

  const fallers = changes
    .filter(f => f.change < 0)
    .sort((a, b) => a.change - b.change)
    .slice(0, MOVERS_COUNT)
    .map(f => ({ ...f, change: Math.abs(f.change) }));

  console.log(`  ↑ ${risers.length} risers, ↓ ${fallers.length} fallers found.`);
  return { risers, fallers };
}

/* ─────────────── STEP 4: Count new reviews + pick quotes ─────────────── */

async function fetchReviewData(sinceTimestamp) {
  console.log('💬 Fetching fan reviews…');
  const [movieReviews, seriesReviews] = await Promise.all([
    fbGet('fanReviews').catch(() => null),
    fbGet('seriesFanReviews').catch(() => null),
  ]);

  const allReviews = [
    ...Object.values(movieReviews  || {}).filter(Boolean),
    ...Object.values(seriesReviews || {}).filter(Boolean),
  ];

  const newReviews = allReviews.filter(r => (r.timestamp || 0) >= sinceTimestamp);
  console.log(`  Found ${newReviews.length} new reviews this week.`);

  // Pick 2 random quotes from different authors
  const quotable = newReviews.filter(r => r.text && r.text.trim().length > 20 && r.name);
  const shuffled = [...quotable].sort(() => Math.random() - 0.5);
  const quotes   = [];
  const usedAuthors = new Set();
  for (const r of shuffled) {
    const author = (r.name || '').toLowerCase().trim();
    if (author && !usedAuthors.has(author)) {
      usedAuthors.add(author);
      quotes.push({
        text:   r.text.slice(0, 200).trim(),
        author: r.name.replace(/^@/, ''),
        film:   r.movie || r.series || 'Unknown film',
      });
      if (quotes.length >= 2) break;
    }
  }

  return { count: newReviews.length, quotes };
}

/* ─────────────── STEP 5: Count new fan art + pick featured ─────────────── */

async function fetchFanArtData(sinceTimestamp) {
  console.log('🎨 Fetching fan art…');
  const data = await fbGet('posterUploads/approved').catch(() => null);
  if (!data) return { count: 0, fanArt: null };

  const entries = Object.entries(data)
    .map(([key, p]) => ({ _key: key, ...p }))
    .filter(Boolean);

  // Debug: log field names from first entry so we can see what Firebase stores
  if (entries.length > 0) {
    console.log('  Fan art fields available:', Object.keys(entries[0]).join(', '));
  }

  // Fan art uses: approvedDate (when admin approved) or uploadDate (when submitted)
  const newArt = entries.filter(p => (p.approvedDate || p.uploadDate || 0) >= sinceTimestamp);
  console.log(`  Found ${newArt.length} new fan art pieces this week.`);

  // Featured: pick from this week's submissions, or most recent overall
  const pool = newArt.length > 0 ? newArt : entries.sort((a, b) => (b.approvedDate || b.uploadDate || 0) - (a.approvedDate || a.uploadDate || 0)).slice(0, 5);
  const featured = pick(pool);

  if (featured) {
    console.log('  Featured fan art entry keys:', Object.keys(featured).join(', '));
  }

  const fanArt = featured ? {
    key:       featured._key,
    film:      featured.movie  || featured.film  || featured.title || '',
    year:      featured.year   || '',
    director:  featured.director || '',
    // Firebase posterUploads fields confirmed from live data
    submitter: (featured.artistName || featured.name || featured.userName ||
                featured.displayName || featured.submitter || featured.uploadedBy || 'anonymous').replace(/^@/, ''),
    imageUrl:  featured.cloudinaryUrl || featured.imageUrl || featured.imageURL ||
               featured.url || featured.posterUrl || featured.photoURL || '',
    description: featured.description || featured.caption || '',
  } : null;

  return { count: newArt.length, fanArt };
}

/* ─────────────── STEP 6: Fetch now-playing from TMDB ─────────────── */

async function fetchCinemas(now = new Date()) {
  console.log('🎬 Fetching now-playing from TMDB (region=AE)…');
  try {
    // Same query as the working Discover tab in index.html:
    // now_playing + region=AE (Middle East) + sorted by release_date desc → correct local releases
    const url = `${TMDB_BASE}/movie/now_playing?api_key=${TMDB_KEY}&language=en-US&region=AE&page=1`;
    const res  = await fetch(url);
    const data = await res.json();

    const films = (data.results || [])
      .sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''))
      .slice(0, CINEMA_COUNT)
      .map(f => ({
        tmdbId: f.id,
        title:  f.title,
        year:   f.release_date ? f.release_date.slice(0, 4) : '',
        genre:  '',
        poster: f.poster_path || '',
      }));

    console.log(`  Found ${films.length} now-playing films.`);
    films.forEach(f => console.log(`    • ${f.title} (${f.year})`));
    return films;
  } catch (e) {
    console.warn('  ⚠️  TMDB fetch failed:', e.message);
    return [];
  }
}

/* ─────────────── STEP 7: Fetch this week's YouTube videos ─────────────── */

async function fetchYouTubeVideos(sinceTimestamp) {
  console.log('📺 Fetching YouTube videos…');
  try {
    // API key is restricted to p-movies.com — send Referer header to satisfy the restriction
    const ytHeaders = { 'Referer': 'https://p-movies.com' };

    // Step 1: Get uploads playlist ID from channel handle
    const chRes  = await fetch(`${YT_BASE}/channels?part=contentDetails&forHandle=${YT_HANDLE}&key=${YT_KEY}`, { headers: ytHeaders });
    const chData = await chRes.json();
    if (!chRes.ok || !chData.items?.length) throw new Error(chData.error?.message || 'Channel not found');
    const uploadsId = chData.items[0].contentDetails.relatedPlaylists.uploads;

    // Step 2: Fetch recent uploads (most recent first)
    const plRes  = await fetch(`${YT_BASE}/playlistItems?part=snippet&playlistId=${uploadsId}&maxResults=10&key=${YT_KEY}`, { headers: ytHeaders });
    const plData = await plRes.json();
    if (!plRes.ok) throw new Error(plData.error?.message || 'Could not fetch videos');

    // Filter to this week only (Saturday → Thursday)
    const videos = (plData.items || [])
      .map(item => ({
        videoId:     item.snippet.resourceId.videoId,
        title:       item.snippet.title,
        thumbnail:   item.snippet.thumbnails?.medium?.url ||
                     item.snippet.thumbnails?.default?.url ||
                     `https://img.youtube.com/vi/${item.snippet.resourceId.videoId}/mqdefault.jpg`,
        publishedAt: item.snippet.publishedAt,
        publishedTs: new Date(item.snippet.publishedAt).getTime(),
        url:         `https://www.youtube.com/watch?v=${item.snippet.resourceId.videoId}`,
      }))
      .filter(v => v.publishedTs >= sinceTimestamp)
      .slice(0, 3); // max 3 per issue

    console.log(`  Found ${videos.length} new YouTube videos this week.`);
    videos.forEach(v => console.log(`    • ${v.title}`));
    return videos;
  } catch (e) {
    console.warn('  ⚠️  YouTube fetch failed:', e.message);
    return [];
  }
}

/* ─────────────── STEP 8: Get backed creators for this week ─────────────── */

function getCreatorsForDate(date = new Date()) {
  const weekIndex = Math.max(0, Math.floor((date.getTime() - BACKED_BASE_MS) / MS_PER_WEEK));
  for (let i = weekIndex; i >= 0; i--) {
    const target = new Date(BACKED_BASE_MS + i * MS_PER_WEEK).toISOString().slice(0, 10);
    const cycle  = BACKED_CYCLES.find(c => c.startDate === target);
    if (cycle) return cycle.creators;
  }
  return BACKED_CYCLES[0].creators;
}

/* ─────────────── STEP 8: Archive previous issue ─────────────── */

async function archivePreviousIssue(prevKey) {
  console.log('📁 Archiving previous issue…');
  try {
    const current = await fbGet('newsletter/current');
    if (current && current.issue) {
      // Save to archive with the week key as the archive key
      await fbPatch('newsletter/archive', {
        [prevKey]: {
          issue:       current.issue,
          weekOf:      current.weekOf,
          publishDate: current.publishDate,
          teaser:      current.teaser || '',
        },
      });
      console.log(`  Archived issue #${current.issue} as ${prevKey}.`);
    }
  } catch (e) {
    console.warn('  ⚠️  Could not archive previous issue:', e.message);
  }
}

/* ─────────────── STEP 9: Get next issue number ─────────────── */

async function getNextIssueNumber() {
  if (FORCE_ISSUE_NUMBER !== null) {
    console.log(`🔢 Issue number forced to #${FORCE_ISSUE_NUMBER} (set FORCE_ISSUE_NUMBER = null after this run).`);
    return FORCE_ISSUE_NUMBER;
  }
  try {
    const current = await fbGet('newsletter/current');
    return current && current.issue ? current.issue + 1 : 1;
  } catch {
    return 1;
  }
}

/* ─────────────── MAIN ─────────────── */

async function run() {
  const now      = new Date();
  const wKey     = weekKey(now);
  const prevKey  = prevWeekKey(wKey);
  const saturday = saturdayOfWeek(now);
  const friday   = fridayOfWeek(saturday);

  // "Since" timestamp = Saturday 00:00 UTC — start of this week
  const sinceTimestamp = saturday.getTime();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🎬  PMovies Weekly — Newsletter Generator');
  console.log(`📅  Week: ${wKey}  (Sat ${formatShortDate(saturday)} – Fri ${formatShortDate(friday)})`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Archive old issue first
  await archivePreviousIssue(prevKey);

  // Fetch all data in parallel
  const [top100, reviewData, fanArtData, cinemas, youtubeVideos] = await Promise.all([
    fetchTop100(),
    fetchReviewData(sinceTimestamp),
    fetchFanArtData(sinceTimestamp),
    fetchCinemas(now),
    fetchYouTubeVideos(sinceTimestamp),
  ]);

  // Save this week's snapshot
  await saveSnapshot(wKey, top100);

  // Calculate movers vs last week
  const movers = await calculateMovers(top100, prevKey);

  // Creators
  const creators = getCreatorsForDate(now);
  console.log(`👥 Loaded ${creators.length} backed creators for this week.`);

  // Issue number
  const issueNumber = await getNextIssueNumber();

  // Build teaser line for og:description and archive preview
  const riserTitle  = movers.risers[0]  ? `${movers.risers[0].title} climbs ${movers.risers[0].change}` : null;
  const reviewCount = reviewData.count;
  const artCount    = fanArtData.count;  // new submissions this week only
  const teaserParts = [riserTitle, reviewCount ? `${reviewCount} new reviews` : null, artCount ? `${artCount} fan art pieces` : null].filter(Boolean);
  const teaser      = teaserParts.join(' · ') || 'Your weekly film digest';

  // Assemble the newsletter document
  const newsletter = {
    issue:       issueNumber,
    weekKey:     wKey,
    weekOf:      saturday.toISOString().slice(0, 10),  // Saturday start
    publishDate: friday.toISOString().slice(0, 10),    // Friday publish
    generatedAt: now.toISOString(),
    teaser,
    ogDesc:      `${teaser} — from the PMovies community.`,
    movers,
    stats: {
      newReviews: reviewData.count,
      newFanArt:  fanArtData.count,
    },
    quotes:   reviewData.quotes,
    cinemas,
    fanArt:   fanArtData.fanArt,
    youtube:  youtubeVideos,
    creators,
  };

  // Write to Firebase
  console.log('\n✍️  Writing newsletter to Firebase…');
  await fbPut('newsletter/current', newsletter);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅  Issue #${issueNumber} published successfully.`);
  console.log(`🔗  Live at: ${SITE_URL}/weekly`);
  console.log(`📅  Week: Sat ${formatShortDate(saturday)} – Fri ${formatShortDate(friday)}`);
  console.log(`📝  Teaser: "${teaser}"`);
  console.log(`📊  ${top100.length} films in Top 100`);
  console.log(`↑↓  ${movers.risers.length} risers · ${movers.fallers.length} fallers`);
  console.log(`💬  ${reviewData.count} new reviews · ${reviewData.quotes.length} quotes picked`);
  console.log(`🎨  ${fanArtData.count} new fan art · fan art of week: ${fanArtData.fanArt?.film || 'none'}`);
  console.log(`🎬  ${cinemas.length} films now in cinemas`);
  console.log(`📺  ${youtubeVideos.length} YouTube videos this week`);
  console.log(`👥  ${creators.length} backed creators`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  console.log('🎨  Next step: export this week\'s Canva cover as weekly-cover.jpg');
  console.log('    and upload it alongside weekly.html on the server.\n');
}

run().catch(err => {
  console.error('\n❌  Generator failed:', err.message);
  process.exit(1);
});
