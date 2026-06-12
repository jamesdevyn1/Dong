const express = require('express');
const { Pool } = require('pg');
const Database = require('better-sqlite3');

const app = express();
const port = process.env.PORT || 3000;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const sqlite = new Database(process.env.SQLITE_PATH || '/app/data/app.db');
sqlite.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)');

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/db-check', async (_req, res) => {
  try {
    const result = await pool.query('SELECT NOW() AS now');
    res.json({ status: 'ok', time: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/sqlite-check', (_req, res) => {
  try {
    sqlite.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES ('ping', 'pong')").run();
    const row = sqlite.prepare("SELECT value FROM kv WHERE key = 'ping'").get();
    res.json({ status: 'ok', response: row.value });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
