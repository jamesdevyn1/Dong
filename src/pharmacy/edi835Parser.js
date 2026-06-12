/**
 * EDI 835 (Electronic Remittance Advice) parser.
 *
 * Insurance companies transmit payment/adjustment data in EDI 835 format.
 * This parser extracts claim-level transactions: amount paid, amount reversed,
 * insurance payer, and CARC/RARC reason codes.
 *
 * EDI 835 segments used:
 *   ISA - Interchange header (sender/receiver IDs)
 *   GS  - Functional group header
 *   ST  - Transaction set header
 *   BPR - Financial information (total payment amount)
 *   N1  - Name (payer / payee)
 *   CLP - Claim-level payment data
 *   CAS - Claim adjustment (reason codes + amounts)
 *   SVC - Service line detail
 */

const SEGMENT_TERMINATOR = '~';
const ELEMENT_SEPARATOR = '*';
const SUBELEMENT_SEPARATOR = ':';

function parseEDI835(rawText) {
  const segments = rawText
    .replace(/\r?\n/g, '')
    .split(SEGMENT_TERMINATOR)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split(ELEMENT_SEPARATOR));

  const transactions = [];
  let currentPayer = '';
  let currentClaim = null;

  for (const seg of segments) {
    const id = seg[0];

    if (id === 'N1' && seg[1] === 'PR') {
      // Payer name
      currentPayer = seg[2] || '';
    }

    if (id === 'CLP') {
      if (currentClaim) transactions.push(currentClaim);
      currentClaim = {
        claimId: seg[1] || '',
        statusCode: seg[2] || '',    // 1=Processed as Primary, 4=Denied, etc.
        chargedAmount: parseFloat(seg[3]) || 0,
        paidAmount: parseFloat(seg[4]) || 0,
        patientResponsibility: parseFloat(seg[5]) || 0,
        payer: currentPayer,
        adjustments: [],
        serviceLines: [],
      };
    }

    if (id === 'CAS' && currentClaim) {
      // Claim Adjustment Segment — may have up to 6 reason/amount pairs
      const groupCode = seg[1]; // CO=Contractual, PR=Patient Responsibility, OA=Other
      let i = 2;
      while (i + 1 < seg.length && seg[i]) {
        const reasonCode = seg[i];
        const adjustedAmount = parseFloat(seg[i + 1]) || 0;
        currentClaim.adjustments.push({ groupCode, reasonCode, adjustedAmount });
        i += 3; // code, amount, quantity (optional)
      }
    }

    if (id === 'SVC' && currentClaim) {
      const [, procedureComposite, chargedAmt, paidAmt] = seg;
      const [qualifier, procedureCode] = (procedureComposite || '').split(SUBELEMENT_SEPARATOR);
      currentClaim.serviceLines.push({
        qualifier,
        procedureCode,
        chargedAmount: parseFloat(chargedAmt) || 0,
        paidAmount: parseFloat(paidAmt) || 0,
      });
    }
  }

  if (currentClaim) transactions.push(currentClaim);
  return transactions;
}

/**
 * Flatten parsed transactions into spreadsheet-ready rows.
 * One row per adjustment reason code; reversal = negative paidAmount.
 */
function flattenToRows(transactions) {
  const rows = [];
  for (const claim of transactions) {
    const isReversal = claim.paidAmount < 0;
    const baseRow = {
      ClaimID: claim.claimId,
      Payer: claim.payer,
      ClaimStatus: claimStatusLabel(claim.statusCode),
      ChargedAmount: claim.chargedAmount,
      PaidAmount: claim.paidAmount,
      Type: isReversal ? 'Reversal' : 'Payment',
      PatientResponsibility: claim.patientResponsibility,
    };

    if (claim.adjustments.length === 0) {
      rows.push({ ...baseRow, AdjustmentGroup: '', ReasonCode: '', AdjustedAmount: 0 });
    } else {
      for (const adj of claim.adjustments) {
        rows.push({
          ...baseRow,
          AdjustmentGroup: adjustmentGroupLabel(adj.groupCode),
          ReasonCode: adj.reasonCode,
          AdjustedAmount: adj.adjustedAmount,
        });
      }
    }
  }
  return rows;
}

function claimStatusLabel(code) {
  const map = {
    '1': 'Processed - Primary',
    '2': 'Processed - Secondary',
    '3': 'Processed - Tertiary',
    '4': 'Denied',
    '19': 'Processed - Primary, Forwarded',
    '20': 'Processed - Secondary, Forwarded',
    '22': 'Reversal',
  };
  return map[code] || code;
}

function adjustmentGroupLabel(code) {
  const map = {
    CO: 'Contractual Obligation',
    PR: 'Patient Responsibility',
    OA: 'Other Adjustment',
    PI: 'Payer Initiated',
    CR: 'Correction / Reversal',
  };
  return map[code] || code;
}

module.exports = { parseEDI835, flattenToRows };
