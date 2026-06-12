const express = require('express');
const multer = require('multer');
const { parseEDI835, flattenToRows } = require('./edi835Parser');
const { buildWorkbook } = require('./spreadsheet');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

/**
 * POST /pharmacy/parse
 * Upload an EDI 835 file (.txt or .edi) and receive an Excel spreadsheet.
 *
 * Form field: `remittance` (file)
 * Response:   application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
 */
router.post('/parse', upload.single('remittance'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Use form field "remittance".' });
  }

  const raw = req.file.buffer.toString('utf8');
  let transactions;
  try {
    transactions = parseEDI835(raw);
  } catch (err) {
    return res.status(422).json({ error: `Parse error: ${err.message}` });
  }

  if (transactions.length === 0) {
    return res.status(422).json({ error: 'No claim transactions found in file. Verify it is EDI 835 format.' });
  }

  const rows = flattenToRows(transactions);
  const buffer = buildWorkbook(rows);

  const filename = `remittance_${Date.now()}.xlsx`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

/**
 * POST /pharmacy/parse/json
 * Same as /parse but returns JSON instead of a file download.
 * Useful for debugging or frontend integration.
 */
router.post('/parse/json', upload.single('remittance'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded. Use form field "remittance".' });
  }

  const raw = req.file.buffer.toString('utf8');
  let transactions;
  try {
    transactions = parseEDI835(raw);
  } catch (err) {
    return res.status(422).json({ error: `Parse error: ${err.message}` });
  }

  const rows = flattenToRows(transactions);
  const summary = buildSummary(rows);
  res.json({ claimCount: transactions.length, rowCount: rows.length, summary, rows });
});

function buildSummary(rows) {
  const totals = {};
  for (const row of rows) {
    const payer = row.Payer || 'Unknown';
    if (!totals[payer]) totals[payer] = { payments: 0, reversals: 0 };
    if (row.Type === 'Reversal') {
      totals[payer].reversals += Math.abs(row.PaidAmount);
    } else {
      totals[payer].payments += row.PaidAmount;
    }
  }
  return Object.entries(totals).map(([payer, t]) => ({
    payer,
    totalPayments: t.payments,
    totalReversals: t.reversals,
    net: t.payments - t.reversals,
  }));
}

module.exports = router;
