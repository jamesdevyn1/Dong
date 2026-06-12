const fs = require('fs');
const path = require('path');
const { parseEDI835, flattenToRows } = require('../src/pharmacy/edi835Parser');
const { buildWorkbook } = require('../src/pharmacy/spreadsheet');

const raw = fs.readFileSync(path.join(__dirname, 'sample.835'), 'utf8');

console.log('--- Parsing EDI 835 sample ---');
const transactions = parseEDI835(raw);
console.log(`Found ${transactions.length} claim transactions\n`);

const rows = flattenToRows(transactions);
console.log('Spreadsheet rows:');
for (const row of rows) {
  console.log(
    `  [${row.Type.padEnd(8)}] Claim ${row.ClaimID} | Payer: ${row.Payer} | Paid: $${row.PaidAmount} | Code: ${row.ReasonCode || 'n/a'} (${row.AdjustmentGroup || 'n/a'})`
  );
}

const buf = buildWorkbook(rows);
const outPath = path.join(__dirname, 'output_remittance.xlsx');
fs.writeFileSync(outPath, buf);
console.log(`\nSpreadsheet written to: ${outPath} (${buf.length} bytes)`);
