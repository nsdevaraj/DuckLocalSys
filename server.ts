import express from 'express';
import http from 'http';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { syncGateway } from './server/syncGateway';
import { gitLog } from './server/gitRepo';
import { backendDuckDB } from './server/backendDuckDB';

async function startServer() {
  const app = express();
  const PORT = 3000;
  const httpServer = http.createServer(app);

  try {
    // 1. Initialize Authoritative Git Repository & Materialized DuckDB Subsystems
    await gitLog.initialize();
    await backendDuckDB.initialize();
    console.log('[Dual DuckDB System] Git repository and backend DuckDB ready.');

    // 2. Attach Sync Gateway (WebSocket + REST endpoints)
    syncGateway.attach(httpServer, app);

    // 3. Static snapshots serving
    const snapshotsDir = path.resolve(process.cwd(), 'public', 'snapshots');
    app.use('/snapshots', express.static(snapshotsDir));

    // 4. Vite middleware for development or Static bundle for production
    if (process.env.NODE_ENV !== 'production') {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), 'dist');
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }

    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`[Dual DuckDB Server] running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Fatal error starting Dual DuckDB server:', error);
    process.exit(1);
  }
}

startServer();
