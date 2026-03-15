import AgentAPI from "apminsight";
AgentAPI.config();

import express from 'express';
import http from 'http';
import { fileURLToPath } from 'url';
import {matchRouter} from "./routes/matches.js";
import {attachWebSocketServer} from "./ws/server.js";
import {securityMiddleware} from "./arcjet.js";
import {commentaryRouter} from "./routes/commentary.js";
import { integrationsRouter } from "./routes/integrations.js";

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '0.0.0.0';
const publicDir = fileURLToPath(new URL('../public', import.meta.url));

const app = express();
const server = http.createServer(app);

app.use(express.json());
app.use(express.static(publicDir));

// app.use(securityMiddleware());

app.use('/matches', matchRouter);
app.use('/matches/:id/commentary', commentaryRouter);
app.use('/integrations', integrationsRouter);

const { broadcastMatchCreated, broadcastCommentary, broadcastScoreUpdate } = attachWebSocketServer(server);
app.locals.broadcastMatchCreated = broadcastMatchCreated;
app.locals.broadcastCommentary = broadcastCommentary;
app.locals.broadcastScoreUpdate = broadcastScoreUpdate;

server.listen(PORT, HOST, () => {
    const baseUrl = HOST === '0.0.0.0' ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;

    console.log(`Server is running on ${baseUrl}`);
    console.log(`WebSocket Server is running on ${baseUrl.replace('http', 'ws')}/ws`);
});
