function toNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function inferCricketRuns(entry) {
  const metadataRuns = toNumber(entry?.metadata?.runs);
  if (metadataRuns != null) {
    return metadataRuns;
  }

  const type = String(entry?.eventType || '').toLowerCase();
  const message = String(entry?.message || '').toLowerCase();

  if (type === 'boundary' || type === 'four' || message.includes('for four')) {
    return 4;
  }

  if (type === 'six' || message.includes('for six')) {
    return 6;
  }

  if (type === 'run' || message.includes('single')) {
    return 1;
  }

  return null;
}

function inferBasketballPoints(entry) {
  const metadataPoints = toNumber(entry?.metadata?.points);
  if (metadataPoints != null) {
    return metadataPoints;
  }

  const type = String(entry?.eventType || '').toLowerCase();
  const message = String(entry?.message || '').toLowerCase();

  if (type.includes('three') || message.includes('three')) {
    return 3;
  }

  if (type === 'free_throw' || message.includes('free throw')) {
    return 1;
  }

  if (
    type === 'jumper' ||
    type === 'two_pointer' ||
    type === 'layup' ||
    type === 'dunk' ||
    message.includes('jumper') ||
    message.includes('layup') ||
    message.includes('dunk')
  ) {
    return 2;
  }

  return null;
}

export function deriveScoreDelta(match, entry) {
  const team = entry?.team;
  if (!team || (team !== match.homeTeam && team !== match.awayTeam)) {
    return null;
  }

  const sport = String(match?.sport || '').toLowerCase();
  const type = String(entry?.eventType || '').toLowerCase();
  let points = null;

  if (sport === 'football' && type === 'goal') {
    points = 1;
  }

  if (sport === 'cricket') {
    points = inferCricketRuns(entry);
  }

  if (sport === 'basketball') {
    points = inferBasketballPoints(entry);
  }

  if (!Number.isInteger(points) || points <= 0) {
    return null;
  }

  return team === match.homeTeam
    ? { home: points, away: 0 }
    : { home: 0, away: points };
}