import { Router } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/db.js';
import { commentary, matches } from '../db/schema.js';
import { fetchUpcomingLeagueEvents, getDefaultLeagueId } from '../integrations/thesportsdb.js';
import {
  fetchApiFootballFixtureEvents,
  fetchApiFootballLiveFixtures,
  hasApiFootballKey,
} from '../integrations/apifootball.js';

export const integrationsRouter = Router();

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

async function findLocalMatchForFixture(fixture) {
  const allMatches = await db.select().from(matches).orderBy(desc(matches.createdAt)).limit(300);

  const home = normalizeName(fixture.homeTeam);
  const away = normalizeName(fixture.awayTeam);

  return allMatches.find((row) => (
    normalizeName(row.homeTeam) === home
    && normalizeName(row.awayTeam) === away
    && normalizeName(row.sport) === 'football'
  )) || null;
}

async function ensureLocalMatchFromFixture(fixture, res) {
  const existing = await findLocalMatchForFixture(fixture);

  if (existing) {
    const changed = (
      existing.homeScore !== fixture.homeScore
      || existing.awayScore !== fixture.awayScore
      || existing.status !== fixture.status
      || new Date(existing.endTime).getTime() !== fixture.endTime.getTime()
    );

    if (!changed) {
      return { match: existing, created: false, updated: false };
    }

    const [updated] = await db
      .update(matches)
      .set({
        status: fixture.status,
        endTime: fixture.endTime,
        homeScore: fixture.homeScore,
        awayScore: fixture.awayScore,
      })
      .where(eq(matches.id, existing.id))
      .returning();

    if (res.app.locals.broadcastScoreUpdate) {
      res.app.locals.broadcastScoreUpdate(updated.id, {
        homeScore: updated.homeScore,
        awayScore: updated.awayScore,
      });
    }

    return { match: updated, created: false, updated: true };
  }

  const [created] = await db
    .insert(matches)
    .values({
      sport: 'football',
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      status: fixture.status,
      startTime: fixture.startTime,
      endTime: fixture.endTime,
      homeScore: fixture.homeScore,
      awayScore: fixture.awayScore,
    })
    .returning();

  if (res.app.locals.broadcastMatchCreated) {
    res.app.locals.broadcastMatchCreated(created);
  }

  return { match: created, created: true, updated: false };
}

async function getRecentDedupeKeys(matchId) {
  const rows = await db
    .select({ metadata: commentary.metadata })
    .from(commentary)
    .where(eq(commentary.matchId, matchId))
    .orderBy(desc(commentary.createdAt))
    .limit(500);

  const keys = new Set();
  for (const row of rows) {
    const key = row?.metadata?.dedupeKey;
    if (typeof key === 'string' && key.length > 0) {
      keys.add(key);
    }
  }

  return keys;
}

async function insertApiFootballCommentary(matchId, event, existingKeys) {
  if (existingKeys.has(event.dedupeKey)) {
    return null;
  }

  const [inserted] = await db
    .insert(commentary)
    .values({
      matchId,
      minute: event.minute,
      period: 'live',
      eventType: event.eventType,
      actor: event.actor,
      team: event.team,
      message: event.message,
      metadata: event.metadata,
      tags: event.tags,
    })
    .returning();

  existingKeys.add(event.dedupeKey);
  return inserted;
}

function buildSyncMessage(event) {
  const raw = event.rawStatus || 'unknown';
  return `Synced from TheSportsDB: ${event.homeTeam} ${event.homeScore}-${event.awayScore} ${event.awayTeam} (${raw}).`;
}

async function insertSyncCommentary(matchId, event) {
  const message = buildSyncMessage(event);

  const [latest] = await db
    .select({ message: commentary.message })
    .from(commentary)
    .where(eq(commentary.matchId, matchId))
    .orderBy(desc(commentary.createdAt))
    .limit(1);

  if (latest?.message === message) {
    return false;
  }

  await db.insert(commentary).values({
    matchId,
    minute: 0,
    period: 'sync',
    eventType: 'sync_snapshot',
    team: event.homeTeam,
    actor: 'TheSportsDB',
    message,
    metadata: {
      provider: 'thesportsdb',
      rawStatus: event.rawStatus,
      homeScore: event.homeScore,
      awayScore: event.awayScore,
    },
    tags: ['sync', 'external-api'],
  });

  return true;
}

integrationsRouter.get('/thesportsdb/preview', async (req, res) => {
  try {
    const events = await fetchUpcomingLeagueEvents({ leagueId: req.query.leagueId });
    res.json({
      provider: 'thesportsdb',
      leagueId: req.query.leagueId || getDefaultLeagueId(),
      count: events.length,
      data: events,
    });
  } catch (error) {
    res.status(502).json({ error: 'Failed to fetch TheSportsDB data.', details: String(error.message || error) });
  }
});

integrationsRouter.post('/thesportsdb/sync', async (req, res) => {
  try {
    const events = await fetchUpcomingLeagueEvents({ leagueId: req.body?.leagueId || req.query.leagueId });

    const summary = {
      fetched: events.length,
      inserted: 0,
      updated: 0,
      unchanged: 0,
      commentaryInserted: 0,
    };

    for (const event of events) {
      const [existing] = await db
        .select()
        .from(matches)
        .where(and(
          eq(matches.sport, 'football'),
          eq(matches.homeTeam, event.homeTeam),
          eq(matches.awayTeam, event.awayTeam),
          eq(matches.startTime, event.startTime),
        ))
        .limit(1);

      if (!existing) {
        const [created] = await db
          .insert(matches)
          .values({
            sport: event.sport,
            homeTeam: event.homeTeam,
            awayTeam: event.awayTeam,
            status: event.status,
            startTime: event.startTime,
            endTime: event.endTime,
            homeScore: event.homeScore,
            awayScore: event.awayScore,
          })
          .returning();

        summary.inserted += 1;

        if (await insertSyncCommentary(created.id, event)) {
          summary.commentaryInserted += 1;
        }

        if (res.app.locals.broadcastMatchCreated) {
          res.app.locals.broadcastMatchCreated(created);
        }
        continue;
      }

      const changed =
        existing.homeScore !== event.homeScore
        || existing.awayScore !== event.awayScore
        || existing.status !== event.status
        || new Date(existing.endTime).getTime() !== event.endTime.getTime();

      if (!changed) {
        if (await insertSyncCommentary(existing.id, event)) {
          summary.commentaryInserted += 1;
        }
        summary.unchanged += 1;
        continue;
      }

      const [updated] = await db
        .update(matches)
        .set({
          status: event.status,
          endTime: event.endTime,
          homeScore: event.homeScore,
          awayScore: event.awayScore,
        })
        .where(eq(matches.id, existing.id))
        .returning();

      summary.updated += 1;

      if (await insertSyncCommentary(updated.id, event)) {
        summary.commentaryInserted += 1;
      }

      if (res.app.locals.broadcastCommentary) {
        const [lastSyncEntry] = await db
          .select()
          .from(commentary)
          .where(eq(commentary.matchId, updated.id))
          .orderBy(desc(commentary.createdAt))
          .limit(1);

        if (lastSyncEntry && lastSyncEntry.eventType === 'sync_snapshot') {
          res.app.locals.broadcastCommentary(updated.id, lastSyncEntry);
        }
      }

      if (res.app.locals.broadcastScoreUpdate) {
        res.app.locals.broadcastScoreUpdate(updated.id, {
          homeScore: updated.homeScore,
          awayScore: updated.awayScore,
        });
      }
    }

    res.json({
      provider: 'thesportsdb',
      leagueId: req.body?.leagueId || req.query.leagueId || getDefaultLeagueId(),
      summary,
    });
  } catch (error) {
    res.status(502).json({ error: 'Failed to sync TheSportsDB data.', details: String(error.message || error) });
  }
});

integrationsRouter.get('/apifootball/live/preview', async (req, res) => {
  try {
    if (!hasApiFootballKey()) {
      return res.status(400).json({
        error: 'Missing APIFOOTBALL_API_KEY. Add it to your environment variables.',
      });
    }

    const fixtures = await fetchApiFootballLiveFixtures();
    res.json({
      provider: 'api-football',
      count: fixtures.length,
      data: fixtures,
    });
  } catch (error) {
    res.status(502).json({ error: 'Failed to fetch API-Football live fixtures.', details: String(error.message || error) });
  }
});

integrationsRouter.post('/apifootball/live-commentary/sync', async (req, res) => {
  try {
    if (!hasApiFootballKey()) {
      return res.status(400).json({
        error: 'Missing APIFOOTBALL_API_KEY. Add it to your environment variables.',
      });
    }

    const fixtures = await fetchApiFootballLiveFixtures();
    const summary = {
      provider: 'api-football',
      fixturesFetched: fixtures.length,
      matchesCreated: 0,
      matchesUpdated: 0,
      commentaryInserted: 0,
    };

    for (const fixture of fixtures) {
      const { match, created, updated } = await ensureLocalMatchFromFixture(fixture, res);

      if (created) {
        summary.matchesCreated += 1;
      }
      if (updated) {
        summary.matchesUpdated += 1;
      }

      const events = await fetchApiFootballFixtureEvents(fixture.externalId);
      const existingKeys = await getRecentDedupeKeys(match.id);

      for (const event of events) {
        const inserted = await insertApiFootballCommentary(match.id, event, existingKeys);
        if (!inserted) {
          continue;
        }

        summary.commentaryInserted += 1;
        if (res.app.locals.broadcastCommentary) {
          res.app.locals.broadcastCommentary(match.id, inserted);
        }
      }
    }

    res.json(summary);
  } catch (error) {
    res.status(502).json({ error: 'Failed to sync live commentary from API-Football.', details: String(error.message || error) });
  }
});