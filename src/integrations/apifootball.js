const DEFAULT_BASE_URL = process.env.APIFOOTBALL_BASE_URL || 'https://v3.football.api-sports.io';

function ensureApiKey() {
  const key = process.env.APIFOOTBALL_API_KEY;
  if (!key) {
    throw new Error('APIFOOTBALL_API_KEY is not configured.');
  }
  return key;
}

async function requestApi(path, params = {}) {
  const key = ensureApiKey();
  const url = new URL(path, DEFAULT_BASE_URL);

  for (const [paramKey, paramValue] of Object.entries(params)) {
    if (paramValue == null || paramValue === '') {
      continue;
    }
    url.searchParams.set(paramKey, String(paramValue));
  }

  const response = await fetch(url, {
    headers: {
      'x-apisports-key': key,
    },
  });

  if (!response.ok) {
    throw new Error(`API-Football request failed with status ${response.status}`);
  }

  return response.json();
}

function toNumber(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapStatus(shortStatus) {
  const value = String(shortStatus || '').toUpperCase();
  const liveCodes = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INT']);
  const doneCodes = new Set(['FT', 'AET', 'PEN', 'CANC', 'ABD', 'AWD', 'WO']);

  if (liveCodes.has(value)) {
    return 'live';
  }

  if (doneCodes.has(value)) {
    return 'finished';
  }

  return 'scheduled';
}

function normalizeFixture(raw) {
  const fixture = raw?.fixture || {};
  const teams = raw?.teams || {};
  const goals = raw?.goals || {};
  const status = fixture?.status || {};

  const startTime = fixture?.date ? new Date(fixture.date) : null;
  if (!startTime || Number.isNaN(startTime.getTime())) {
    return null;
  }

  return {
    externalId: fixture.id,
    homeTeam: teams?.home?.name || null,
    awayTeam: teams?.away?.name || null,
    startTime,
    endTime: new Date(startTime.getTime() + 105 * 60 * 1000),
    homeScore: toNumber(goals.home) ?? 0,
    awayScore: toNumber(goals.away) ?? 0,
    elapsed: toNumber(status.elapsed) ?? 0,
    statusShort: status.short || null,
    statusLong: status.long || null,
    status: mapStatus(status.short),
    league: raw?.league?.name || null,
  };
}

function normalizeEvent(fixtureId, raw) {
  const elapsed = toNumber(raw?.time?.elapsed) ?? 0;
  const extra = toNumber(raw?.time?.extra);
  const type = raw?.type || 'event';
  const detail = raw?.detail || 'Update';
  const player = raw?.player?.name || null;
  const assist = raw?.assist?.name || null;
  const teamName = raw?.team?.name || null;

  const minuteText = extra != null ? `${elapsed}+${extra}` : `${elapsed}`;
  const actorText = player || 'Unknown player';
  const message = `${minuteText}' ${type}: ${detail}${player ? ` (${actorText})` : ''}`;
  const dedupeKey = `${fixtureId}|${minuteText}|${type}|${detail}|${teamName || ''}|${player || ''}|${assist || ''}`;

  return {
    fixtureId,
    minute: elapsed,
    eventType: String(type).toLowerCase().replace(/\s+/g, '_'),
    team: teamName,
    actor: player,
    message,
    metadata: {
      provider: 'api-football',
      fixtureId,
      detail,
      type,
      elapsed,
      extra,
      assist,
      dedupeKey,
    },
    tags: ['live', 'api-football'],
    dedupeKey,
  };
}

export function hasApiFootballKey() {
  return Boolean(process.env.APIFOOTBALL_API_KEY);
}

export async function fetchApiFootballLiveFixtures() {
  const payload = await requestApi('/fixtures', { live: 'all' });
  const fixtures = Array.isArray(payload?.response) ? payload.response : [];

  return fixtures
    .map(normalizeFixture)
    .filter((item) => item && item.homeTeam && item.awayTeam && Number.isInteger(item.externalId));
}

export async function fetchApiFootballFixtureEvents(fixtureId) {
  const payload = await requestApi('/fixtures/events', { fixture: fixtureId });
  const events = Array.isArray(payload?.response) ? payload.response : [];

  return events.map((item) => normalizeEvent(fixtureId, item));
}
