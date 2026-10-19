import app from './src/app.js';
import { initDb, closeDb } from './src/db/index.js';

const PORT = process.env.PORT || 3000;

// Initialize database
initDb();

const server = app.listen(PORT, () => {
  console.log(`B2B AI Workflow SaaS server running on http://localhost:${PORT}`);
});

function gracefulShutdown(signal) {
  console.log(`Received ${signal}, shutting down gracefully...`);
  server.close(() => {
    closeDb();
    console.log('HTTP server closed, database connection closed.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

export default server;
