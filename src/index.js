const express = require('express');
const { Pool } = require('pg');
const { createClient } = require('redis');
const pharmacyRoutes = require('./pharmacy/routes');

const app = express();
const port = process.env.PORT || 3000;

app.use('/pharmacy', pharmacyRoutes);

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const redisClient = createClient({ url: process.env.REDIS_URL });
redisClient.on('error', (err) => console.error('Redis error:', err));

(async () => {
  await redisClient.connect();
})();

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

app.get('/redis-check', async (_req, res) => {
  try {
    const pong = await redisClient.ping();
    res.json({ status: 'ok', response: pong });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
