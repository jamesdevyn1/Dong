const Database = require('better-sqlite3');
const path     = require('path');

let _db = null;

function getDb() {
  if (_db) return _db;
  const { app } = require('electron');
  const dbPath = path.join(app.getPath('userData'), 'pharmacy.db');
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  return _db;
}

function initSchema() {
  getDb().exec(`
    CREATE TABLE IF NOT EXISTS rx_batches (
      id          TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
      file_name   TEXT,
      uploaded_at TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
      claim_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS rx_claims (
      id                     INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id               TEXT    REFERENCES rx_batches(id) ON DELETE CASCADE,
      claim_id               TEXT,
      payer                  TEXT,
      claim_status           TEXT,
      type                   TEXT,
      charged_amount         REAL    DEFAULT 0,
      paid_amount            REAL    DEFAULT 0,
      patient_responsibility REAL    DEFAULT 0,
      service_date           TEXT,
      created_at             TEXT    DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    );

    CREATE TABLE IF NOT EXISTS rx_adjustments (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      claim_db_id      INTEGER REFERENCES rx_claims(id) ON DELETE CASCADE,
      adjustment_group TEXT,
      reason_code      TEXT,
      adjusted_amount  REAL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_claims_created ON rx_claims(created_at);
    CREATE INDEX IF NOT EXISTS idx_claims_type    ON rx_claims(type);
    CREATE INDEX IF NOT EXISTS idx_claims_payer   ON rx_claims(payer);
  `);
}

function saveBatch(fileName, transactions) {
  const db = getDb();

  const insertBatch = db.prepare(
    'INSERT INTO rx_batches (file_name, claim_count) VALUES (?,?) RETURNING id'
  );
  const insertClaim = db.prepare(`
    INSERT INTO rx_claims
      (batch_id, claim_id, payer, claim_status, type,
       charged_amount, paid_amount, patient_responsibility, service_date)
    VALUES (?,?,?,?,?,?,?,?,?) RETURNING id
  `);
  const insertAdj = db.prepare(
    'INSERT INTO rx_adjustments (claim_db_id, adjustment_group, reason_code, adjusted_amount) VALUES (?,?,?,?)'
  );

  const run = db.transaction(() => {
    const { id: batchId } = insertBatch.get(fileName, transactions.length);
    for (const tx of transactions) {
      const { id: claimDbId } = insertClaim.get(
        batchId, tx.claimId, tx.payer, tx.claimStatus,
        tx.paidAmount < 0 ? 'Reversal' : 'Payment',
        tx.chargedAmount, tx.paidAmount, tx.patientResponsibility,
        tx.serviceDate || null
      );
      for (const adj of tx.adjustments) {
        insertAdj.run(claimDbId, adj.groupLabel, adj.reasonCode, adj.adjustedAmount);
      }
    }
    return batchId;
  });

  return run();
}

// ── Date helpers ──────────────────────────────────────────────────────────────

function getPeriodRange(period, dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  let start, end, bucketFmt;

  switch (period) {
    case 'day':
      start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      end   = new Date(start.getTime() + 86400000);
      bucketFmt = '%H';
      break;
    case 'week': {
      const dow = d.getUTCDay();
      start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (dow === 0 ? 6 : dow - 1)));
      end   = new Date(start.getTime() + 7 * 86400000);
      bucketFmt = '%Y-%m-%d';
      break;
    }
    case 'month':
      start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
      end   = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
      bucketFmt = '%Y-%m-%d';
      break;
    case 'year':
    default:
      start = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      end   = new Date(Date.UTC(d.getUTCFullYear() + 1, 0, 1));
      bucketFmt = '%Y-%m';
  }

  return {
    start:     start.toISOString().slice(0, 19) + 'Z',
    end:       end.toISOString().slice(0, 19) + 'Z',
    bucketFmt,
  };
}

function getDashboardData(period, dateStr) {
  const db = getDb();
  const { start, end, bucketFmt } = getPeriodRange(period, dateStr);

  const chartRows = db.prepare(`
    SELECT
      strftime(?, created_at) AS bucket,
      SUM(CASE WHEN type = 'Payment'  THEN paid_amount     ELSE 0 END) AS payments,
      SUM(CASE WHEN type = 'Reversal' THEN ABS(paid_amount) ELSE 0 END) AS reversals,
      COUNT(*) AS claim_count
    FROM rx_claims
    WHERE created_at >= ? AND created_at < ?
    GROUP BY bucket ORDER BY bucket
  `).all(bucketFmt, start, end);

  const summary = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN type = 'Payment'  THEN paid_amount     ELSE 0 END), 0) AS total_payments,
      COALESCE(SUM(CASE WHEN type = 'Reversal' THEN ABS(paid_amount) ELSE 0 END), 0) AS total_reversals,
      COUNT(*) AS claim_count,
      COUNT(DISTINCT payer) AS payer_count
    FROM rx_claims WHERE created_at >= ? AND created_at < ?
  `).get(start, end);

  return { period, start, end, bucketFmt, summary, chartData: chartRows };
}

function getPayments({ period, dateStr, page = 1, limit = 50, search = '' }) {
  const db = getDb();
  const { start, end } = getPeriodRange(period, dateStr);
  const offset = (page - 1) * limit;

  const searchClause = search ? ` AND (claim_id LIKE ? OR payer LIKE ?)` : '';
  const baseParams   = [start, end];
  const searchParam  = search ? [`%${search}%`, `%${search}%`] : [];

  const rows = db.prepare(`
    SELECT id, claim_id, payer, claim_status, type,
           charged_amount, paid_amount, patient_responsibility, service_date, created_at
    FROM rx_claims
    WHERE created_at >= ? AND created_at < ?${searchClause}
    ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(...baseParams, ...searchParam, limit, offset);

  const { total } = db.prepare(`
    SELECT COUNT(*) AS total FROM rx_claims
    WHERE created_at >= ? AND created_at < ?${searchClause}
  `).get(...baseParams, ...searchParam);

  return { total, rows };
}

function getPaymentById(id) {
  const db = getDb();
  const claim = db.prepare('SELECT * FROM rx_claims WHERE id = ?').get(id);
  if (!claim) return null;
  const adjustments = db.prepare('SELECT * FROM rx_adjustments WHERE claim_db_id = ? ORDER BY id').all(id);
  return { ...claim, adjustments };
}

module.exports = { initSchema, saveBatch, getDashboardData, getPayments, getPaymentById };
