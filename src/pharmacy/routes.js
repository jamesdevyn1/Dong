const express  = require('express');
const multer   = require('multer');
const { parseEDI835, flattenToRows } = require('./edi835Parser');
const { buildWorkbook } = require('./spreadsheet');
const db = require('./db');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ─── Upload + store in DB ────────────────────────────────────────────────────

router.post('/upload', upload.single('remittance'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded. Use field "remittance".' });
  const raw = req.file.buffer.toString('utf8');
  let transactions;
  try {
    transactions = parseEDI835(raw);
  } catch (err) {
    return res.status(422).json({ error: `Parse error: ${err.message}` });
  }
  if (transactions.length === 0) {
    return res.status(422).json({ error: 'No claims found. Verify EDI 835 format.' });
  }
  try {
    const batchId = await db.saveBatch(req.file.originalname, transactions);
    res.json({ ok: true, batchId, claimCount: transactions.length });
  } catch (err) {
    console.error('DB save error:', err);
    res.status(500).json({ error: 'Database error: ' + err.message });
  }
});

// ─── Dashboard API ───────────────────────────────────────────────────────────

router.get('/api/dashboard', async (req, res) => {
  const period  = ['day', 'week', 'month', 'year'].includes(req.query.period) ? req.query.period : 'month';
  const dateStr = req.query.date || new Date().toISOString().slice(0, 10);
  try {
    const data = await db.getDashboardData(period, dateStr);
    res.json(data);
  } catch (err) {
    console.error('Dashboard query error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/payments', async (req, res) => {
  const period  = ['day', 'week', 'month', 'year'].includes(req.query.period) ? req.query.period : 'month';
  const dateStr = req.query.date   || new Date().toISOString().slice(0, 10);
  const page    = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit   = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const search  = (req.query.search || '').trim().slice(0, 100);
  try {
    const data = await db.getPayments({ period, dateStr, page, limit, search });
    res.json(data);
  } catch (err) {
    console.error('Payments query error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/payments/:id', async (req, res) => {
  try {
    const payment = await db.getPaymentById(parseInt(req.params.id, 10));
    if (!payment) return res.status(404).json({ error: 'Not found' });
    res.json(payment);
  } catch (err) {
    console.error('Payment detail error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Direct Excel download (no DB) ──────────────────────────────────────────

router.post('/parse', upload.single('remittance'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const raw = req.file.buffer.toString('utf8');
  let transactions;
  try { transactions = parseEDI835(raw); }
  catch (err) { return res.status(422).json({ error: `Parse error: ${err.message}` }); }
  if (transactions.length === 0) return res.status(422).json({ error: 'No claims found.' });

  const rows   = flattenToRows(transactions);
  const buffer = buildWorkbook(rows);
  res.setHeader('Content-Disposition', `attachment; filename="remittance_${Date.now()}.xlsx"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

router.post('/parse/json', upload.single('remittance'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  const raw = req.file.buffer.toString('utf8');
  let transactions;
  try { transactions = parseEDI835(raw); }
  catch (err) { return res.status(422).json({ error: `Parse error: ${err.message}` }); }
  res.json({ claimCount: transactions.length, rows: flattenToRows(transactions) });
});

module.exports = router;
