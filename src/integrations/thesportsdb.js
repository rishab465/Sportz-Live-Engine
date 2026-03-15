const DEFAULT_API_KEY = process.env.THESPORTSDB_API_KEY || '3';
const DEFAULT_BASE_URL = process.env.THESPORTSDB_BASE_URL || 'https://www.thesportsdb.com/api/v1/json';
const DEFAULT_LEAGUE_ID = process.env.THESPORTSDB_LEAGUE_ID || '4328';

function safeParseDate(value) {
  if (!value) {
    return null;
  }

  // TheSportsDB timestamp may not include timezone, so default to UTC.
  const withZone = /Z$|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value}Z`;
  const date = new Date(withZone);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapStatus(status) {
  const value = String(status || '').toLowerCase();

  if (
    value.includes('in progress')
    || value.includes('live')
    || value.includes('half time')
    || value === 'ht'
    || value === '1h'
    || value === '2h'
  ) {
    return 'live';
  }

  if (value.includes('finished') || value === 'ft' || value.includes('full time')) {
    return 'finished';
  }

  return 'scheduled';
}

function normalizeEvent(event) {
  const startTime = safeParseDate(event.strTimestamp)
    || safeParseDate(`${event.dateEvent || ''}T${event.strTime || '00:00:00'}`);

  if (!startTime) {
    return null;
  }

  const endTime = new Date(startTime.getTime() + 105 * 60 * 1000);
  const homeScore = toInt(event.intHomeScore);
  const awayScore = toInt(event.intAwayScore);

  return {
    externalId: event.idEvent,
    sport: 'football',
    league: event.strLeague || null,
    homeTeam: event.strHomeTeam,
    awayTeam: event.strAwayTeam,
    startTime,
    endTime,
    homeScore: homeScore ?? 0,
    awayScore: awayScore ?? 0,
    status: mapStatus(event.strStatus),
    rawStatus: event.strStatus || null,
  };
}

export async function fetchUpcomingLeagueEvents(options = {}) {
  const apiKey = options.apiKey || DEFAULT_API_KEY;
  const baseUrl = options.baseUrl || DEFAULT_BASE_URL;
  const leagueId = options.leagueId || DEFAULT_LEAGUE_ID;
  const url = `${baseUrl}/${apiKey}/eventsnextleague.php?id=${leagueId}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`TheSportsDB request failed with status ${response.status}`);
  }

  const payload = await response.json();
  const events = Array.isArray(payload.events) ? payload.events : [];

  return events
    .map(normalizeEvent)
    .filter(Boolean)
    .filter((event) => event.homeTeam && event.awayTeam);
}

export function getDefaultLeagueId() {
  return DEFAULT_LEAGUE_ID;
}