const SEGMENT_TERMINATOR  = '~';
const ELEMENT_SEPARATOR   = '*';
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
  let currentClaim  = null;

  for (const seg of segments) {
    const id = seg[0];

    if (id === 'N1' && seg[1] === 'PR') {
      currentPayer = seg[2] || '';
    }

    if (id === 'CLP') {
      if (currentClaim) transactions.push(currentClaim);
      currentClaim = {
        claimId:             seg[1] || '',
        statusCode:          seg[2] || '',
        claimStatus:         claimStatusLabel(seg[2] || ''),
        chargedAmount:       parseFloat(seg[3]) || 0,
        paidAmount:          parseFloat(seg[4]) || 0,
        patientResponsibility: parseFloat(seg[5]) || 0,
        payer:               currentPayer,
        serviceDate:         null,
        adjustments:         [],
        serviceLines:        [],
      };
    }

    // Claim-level service date
    if (id === 'DTM' && currentClaim) {
      const qualifier = seg[1];
      if (qualifier === '232' || qualifier === '472') {
        const raw = seg[2] || '';
        if (raw.length === 8) {
          currentClaim.serviceDate = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
        }
      }
    }

    if (id === 'CAS' && currentClaim) {
      const groupCode = seg[1];
      let i = 2;
      while (i + 1 < seg.length && seg[i]) {
        currentClaim.adjustments.push({
          groupCode,
          groupLabel:     adjustmentGroupLabel(groupCode),
          reasonCode:     seg[i],
          adjustedAmount: parseFloat(seg[i + 1]) || 0,
        });
        i += 3;
      }
    }

    if (id === 'SVC' && currentClaim) {
      const [, procedureComposite, chargedAmt, paidAmt] = seg;
      const [qualifier, procedureCode] = (procedureComposite || '').split(SUBELEMENT_SEPARATOR);
      currentClaim.serviceLines.push({
        qualifier,
        procedureCode,
        chargedAmount: parseFloat(chargedAmt) || 0,
        paidAmount:    parseFloat(paidAmt) || 0,
      });
    }
  }

  if (currentClaim) transactions.push(currentClaim);
  return transactions;
}

function flattenToRows(transactions) {
  const rows = [];
  for (const claim of transactions) {
    const isReversal = claim.paidAmount < 0;
    const base = {
      ClaimID:               claim.claimId,
      Payer:                 claim.payer,
      ClaimStatus:           claim.claimStatus,
      Type:                  isReversal ? 'Reversal' : 'Payment',
      ChargedAmount:         claim.chargedAmount,
      PaidAmount:            claim.paidAmount,
      PatientResponsibility: claim.patientResponsibility,
    };
    if (claim.adjustments.length === 0) {
      rows.push({ ...base, AdjustmentGroup: '', ReasonCode: '', AdjustedAmount: 0 });
    } else {
      for (const adj of claim.adjustments) {
        rows.push({ ...base, AdjustmentGroup: adj.groupLabel, ReasonCode: adj.reasonCode, AdjustedAmount: adj.adjustedAmount });
      }
    }
  }
  return rows;
}

function claimStatusLabel(code) {
  const map = {
    '1': 'Processed - Primary', '2': 'Processed - Secondary', '3': 'Processed - Tertiary',
    '4': 'Denied', '19': 'Processed - Primary, Forwarded', '20': 'Processed - Secondary, Forwarded',
    '22': 'Reversal',
  };
  return map[code] || code;
}

function adjustmentGroupLabel(code) {
  const map = {
    CO: 'Contractual Obligation', PR: 'Patient Responsibility',
    OA: 'Other Adjustment', PI: 'Payer Initiated', CR: 'Correction / Reversal',
  };
  return map[code] || code;
}

module.exports = { parseEDI835, flattenToRows, claimStatusLabel, adjustmentGroupLabel };
