const state = {
  matches: [],
  selectedMatchId: null,
  subscribedMatchId: null,
  socket: null,
};

const elements = {
  httpStatus: document.querySelector('#http-status'),
  wsStatus: document.querySelector('#ws-status'),
  wsDot: document.querySelector('#ws-dot'),
  matchCount: document.querySelector('#match-count'),
  liveCount: document.querySelector('#live-count'),
  selectedLabel: document.querySelector('#selected-label'),
  matchList: document.querySelector('#match-list'),
  feedTitle: document.querySelector('#feed-title'),
  matchSummary: document.querySelector('#match-summary'),
  commentaryList: document.querySelector('#commentary-list'),
  refreshButton: document.querySelector('#refresh-button'),
  matchCardTemplate: document.querySelector('#match-card-template'),
  commentaryTemplate: document.querySelector('#commentary-item-template'),
};

function formatStatus(status) {
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
}

function formatSport(sport) {
  return sport ? sport.charAt(0).toUpperCase() + sport.slice(1) : 'Sport';
}

function formatDate(value) {
  if (!value) {
    return 'No schedule';
  }

  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

function scoreLabel(match) {
  const status = String(match?.status || '').toLowerCase();
  const home = match?.homeScore ?? 0;
  const away = match?.awayScore ?? 0;

  // Pre-match fixtures should read like fixtures, not fake live scores.
  if (status === 'scheduled' && home === 0 && away === 0) {
    return 'vs';
  }

  return `${home} : ${away}`;
}

function renderSummary(match) {
  if (!match) {
    elements.matchSummary.className = 'match-summary empty-state';
    elements.matchSummary.textContent = 'Choose a match on the left to load commentary.';
    return;
  }

  elements.matchSummary.className = 'match-summary';
  elements.matchSummary.innerHTML = `
    <div class="summary-grid">
      <div>
        <span>Fixture</span>
        <strong>${match.homeTeam} vs ${match.awayTeam}</strong>
      </div>
      <div>
        <span>Status</span>
        <strong>${formatStatus(match.status)}</strong>
      </div>
      <div>
        <span>Score</span>
        <strong>${scoreLabel(match)}</strong>
      </div>
      <div>
        <span>Window</span>
        <strong>${formatDate(match.startTime)} to ${formatDate(match.endTime)}</strong>
      </div>
    </div>
  `;
}

function renderCommentaryItem(entry, options = {}) {
  const fragment = elements.commentaryTemplate.content.cloneNode(true);
  const item = fragment.querySelector('.commentary-item');
  const minute = fragment.querySelector('.commentary-minute');
  const type = fragment.querySelector('.commentary-type');
  const message = fragment.querySelector('.commentary-message');
  const footer = fragment.querySelector('.commentary-footer');

  if (options.live) {
    item.classList.add('live-incoming');
  }

  minute.textContent = entry.minute != null ? `${entry.minute}'` : 'Live';
  type.textContent = entry.eventType || entry.period || 'Commentary';
  message.textContent = entry.message || 'No message';
  footer.textContent = [entry.team, entry.actor].filter(Boolean).join(' • ') || 'Feed update';

  return item;
}

function renderCommentaryList(entries) {
  elements.commentaryList.innerHTML = '';

  if (!entries.length) {
    elements.commentaryList.innerHTML = '<div class="empty-state">No commentary available for this match yet.</div>';
    return;
  }

  const list = document.createDocumentFragment();
  entries.forEach((entry) => {
    list.appendChild(renderCommentaryItem(entry));
  });
  elements.commentaryList.appendChild(list);
}

function renderMatches() {
  elements.matchList.innerHTML = '';

  if (!state.matches.length) {
    elements.matchList.innerHTML = '<div class="empty-state">No matches returned from the API.</div>';
    return;
  }

  const fragment = document.createDocumentFragment();

  state.matches.forEach((match, index) => {
    const node = elements.matchCardTemplate.content.cloneNode(true);
    const card = node.querySelector('.match-card');

    if (match.id === state.selectedMatchId) {
      card.classList.add('active');
    }

    card.style.animationDelay = `${index * 45}ms`;
    card.querySelector('.match-sport').textContent = formatSport(match.sport);
    const status = card.querySelector('.match-status');
    status.textContent = formatStatus(match.status);
    status.classList.add(String(match.status || '').toLowerCase());
    card.querySelector('.teams').textContent = `${match.homeTeam} vs ${match.awayTeam}`;
    card.querySelector('.scoreline').textContent = scoreLabel(match);
    card.querySelector('.timing').textContent = `${formatDate(match.startTime)} • ${formatDate(match.endTime)}`;
    card.addEventListener('click', () => selectMatch(match.id));

    fragment.appendChild(node);
  });

  elements.matchList.appendChild(fragment);
  elements.matchCount.textContent = String(state.matches.length);
  elements.liveCount.textContent = String(state.matches.filter((match) => match.status === 'live').length);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response.json();
}

function upsertMatch(match) {
  const nextMatches = [...state.matches];
  const index = nextMatches.findIndex((entry) => entry.id === match.id);

  if (index === -1) {
    nextMatches.unshift(match);
  } else {
    nextMatches[index] = match;
  }

  state.matches = nextMatches;
  renderMatches();
}

function applyScoreUpdate(score) {
  state.matches = state.matches.map((match) => {
    if (match.id !== score.matchId) {
      return match;
    }

    return {
      ...match,
      homeScore: score.homeScore,
      awayScore: score.awayScore,
    };
  });

  renderMatches();

  if (state.selectedMatchId === score.matchId) {
    const selected = state.matches.find((match) => match.id === score.matchId);
    elements.selectedLabel.textContent = selected
      ? `${selected.homeTeam} ${selected.homeScore} : ${selected.awayScore} ${selected.awayTeam}`
      : elements.selectedLabel.textContent;
    renderSummary(selected);
  }
}

function syncSubscription(matchId) {
  if (state.socket?.readyState !== WebSocket.OPEN) {
    return;
  }

  if (state.subscribedMatchId != null && state.subscribedMatchId !== matchId) {
    state.socket.send(JSON.stringify({ type: 'unsubscribe', matchId: state.subscribedMatchId }));
  }

  if (matchId != null) {
    state.socket.send(JSON.stringify({ type: 'subscribe', matchId }));
  }

  state.subscribedMatchId = matchId;
}

function connectSocket() {
  if (state.socket) {
    state.socket.close();
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);

  socket.addEventListener('open', () => {
    elements.wsStatus.textContent = 'Socket connected';
    elements.wsDot.classList.add('connected');
    syncSubscription(state.selectedMatchId);
  });

  socket.addEventListener('close', () => {
    elements.wsStatus.textContent = 'Socket reconnecting...';
    elements.wsDot.classList.remove('connected');
    state.subscribedMatchId = null;
    window.setTimeout(connectSocket, 1600);
  });

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data);

    if (payload.type === 'match_created' && payload.data) {
      upsertMatch(payload.data);
    }

    if (payload.type === 'commentary' && payload.data && payload.data.matchId === state.selectedMatchId) {
      const item = renderCommentaryItem(payload.data, { live: true });
      elements.commentaryList.prepend(item);
    }

    if (payload.type === 'score_update' && payload.data) {
      applyScoreUpdate(payload.data);
    }
  });

  state.socket = socket;
}

async function loadMatches() {
  elements.httpStatus.textContent = 'API loading...';
  const payload = await fetchJson('/matches?limit=24');
  state.matches = Array.isArray(payload.data) ? payload.data : [];
  elements.httpStatus.textContent = 'API connected';
  renderMatches();

  if (state.selectedMatchId == null && state.matches.length) {
    selectMatch(state.matches[0].id);
  }
}

async function selectMatch(matchId) {
  state.selectedMatchId = matchId;
  renderMatches();

  const match = state.matches.find((entry) => entry.id === matchId);
  elements.selectedLabel.textContent = match ? `${match.homeTeam} vs ${match.awayTeam}` : `Match ${matchId}`;
  elements.feedTitle.textContent = match ? `${match.homeTeam} vs ${match.awayTeam}` : `Match ${matchId}`;
  renderSummary(match);
  syncSubscription(matchId);

  try {
    const payload = await fetchJson(`/matches/${matchId}/commentary?limit=20`);
    renderCommentaryList(Array.isArray(payload.data) ? payload.data : []);
  } catch (error) {
    elements.commentaryList.innerHTML = `<div class="error-banner">${error.message}</div>`;
  }
}

async function bootstrap() {
  elements.refreshButton.addEventListener('click', () => {
    loadMatches().catch(showFatalError);
  });

  connectSocket();

  try {
    await loadMatches();
  } catch (error) {
    showFatalError(error);
  }
}

function showFatalError(error) {
  elements.httpStatus.textContent = 'API unavailable';
  elements.matchList.innerHTML = `<div class="error-banner">${error.message}</div>`;
  elements.commentaryList.innerHTML = '';
}

bootstrap();