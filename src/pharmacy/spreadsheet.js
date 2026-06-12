const XLSX = require('xlsx');

const COLUMNS = [
  { header: 'Claim ID',              key: 'ClaimID' },
  { header: 'Payer (Insurance Co.)', key: 'Payer' },
  { header: 'Claim Status',          key: 'ClaimStatus' },
  { header: 'Type',                  key: 'Type' },
  { header: 'Charged Amount ($)',    key: 'ChargedAmount' },
  { header: 'Paid Amount ($)',       key: 'PaidAmount' },
  { header: 'Patient Responsibility ($)', key: 'PatientResponsibility' },
  { header: 'Adjustment Group',      key: 'AdjustmentGroup' },
  { header: 'Reason Code',          key: 'ReasonCode' },
  { header: 'Adjusted Amount ($)',   key: 'AdjustedAmount' },
];

/**
 * Build an Excel workbook from flattened remittance rows.
 * Returns a Buffer suitable for sending as a download.
 */
function buildWorkbook(rows) {
  const wb = XLSX.utils.book_new();

  // Main remittance sheet
  const wsData = [
    COLUMNS.map((c) => c.header),
    ...rows.map((row) => COLUMNS.map((c) => row[c.key] ?? '')),
  ];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  styleSheet(ws, rows.length);
  XLSX.utils.book_append_sheet(wb, ws, 'Remittance Detail');

  // Summary sheet
  const summaryWs = buildSummarySheet(rows);
  XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary by Payer');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function buildSummarySheet(rows) {
  const totals = {};
  for (const row of rows) {
    const payer = row.Payer || 'Unknown';
    if (!totals[payer]) {
      totals[payer] = { payments: 0, reversals: 0, count: 0 };
    }
    if (row.Type === 'Reversal') {
      totals[payer].reversals += Math.abs(row.PaidAmount);
    } else {
      totals[payer].payments += row.PaidAmount;
    }
    totals[payer].count += 1;
  }

  const data = [
    ['Payer', 'Total Payments ($)', 'Total Reversals ($)', 'Net ($)', 'Claim Count'],
    ...Object.entries(totals).map(([payer, t]) => [
      payer,
      t.payments.toFixed(2),
      t.reversals.toFixed(2),
      (t.payments - t.reversals).toFixed(2),
      t.count,
    ]),
  ];
  return XLSX.utils.aoa_to_sheet(data);
}

function styleSheet(ws, rowCount) {
  // Set column widths
  ws['!cols'] = COLUMNS.map((c) => ({ wch: Math.max(c.header.length + 2, 18) }));
  // Freeze header row
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
}

module.exports = { buildWorkbook };
