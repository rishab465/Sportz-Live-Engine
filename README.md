# Sportz Live Engine

Simple sports live updates app with:
- REST API
- WebSocket live feed
- PostgreSQL (Drizzle ORM)

## Requirements
- Node.js 20+
- npm
- PostgreSQL connection string

## Setup
1. Install dependencies:

```bash
npm install
```

2. Create `.env` in project root:

```env
DATABASE_URL=
PORT=8000
HOST=0.0.0.0
API_URL=http://localhost:8000

# Optional
THESPORTSDB_API_KEY=3
THESPORTSDB_LEAGUE_ID=4328
APIFOOTBALL_API_KEY=
ARCJET_KEY=
ARCJET_ENV=development
```

3. Run migrations:

```bash
npm run db:migrate
```

## Run
Development:

```bash
npm run dev
```

Production mode:

```bash
npm start
```

App URLs:
- HTTP: http://localhost:8000
- WebSocket: ws://localhost:8000/ws

## Useful Commands
```bash
npm run seed
npm run db:generate
npm run db:migrate
npm run db:studio
```

## Main API
- `GET /matches?limit=20`
- `POST /matches`
- `GET /matches/:id/commentary?limit=20`
- `POST /matches/:id/commentary`
- `PATCH /matches/:id/score`

Integration endpoints:
- `GET /integrations/thesportsdb/preview`
- `POST /integrations/thesportsdb/sync`
- `GET /integrations/apifootball/live/preview`
- `POST /integrations/apifootball/live-commentary/sync`

## Notes
- Match list is sorted with live matches first.
- Match list currently returns football matches only.
- API-Football endpoints require `APIFOOTBALL_API_KEY`.



