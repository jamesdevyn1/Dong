const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.BANK_PORT || 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Categorization rules ────────────────────────────────────────────────────

const RULES = [
  {
    category: 'Income',
    color: '#22c55e',
    keywords: ['payroll', 'salary', 'direct dep', 'direct deposit', 'ach credit', 'refund', 'reimburs', 'interest paid', 'cashback', 'reward'],
  },
  {
    category: 'Groceries',
    color: '#84cc16',
    keywords: ['kroger', 'safeway', 'whole foods', 'trader joe', 'aldi', 'publix', 'wegmans', 'stop & shop', 'stop and shop', 'food lion', 'h-e-b', 'heb', 'sprouts', 'meijer', 'market basket', 'giant', 'albertsons', 'vons', 'smart & final', 'grocery', 'supermarket', 'fresh market'],
  },
  {
    category: 'Restaurants',
    color: '#f97316',
    keywords: ['restaurant', 'mcdonald', 'burger king', 'wendy', 'taco bell', 'chipotle', 'subway', 'pizza hut', 'domino', 'papa john', 'chick-fil-a', 'chick fil a', 'popeyes', 'kfc', 'starbucks', 'dunkin', 'panera', 'olive garden', 'applebee', 'chili\'s', 'denny', 'ihop', 'waffle house', 'sushi', 'doordash', 'uber eats', 'grubhub', 'postmates', 'instacart restaurant', 'eatery', 'bistro', 'grill', 'diner', 'cafe', 'bakery'],
  },
  {
    category: 'Transportation',
    color: '#3b82f6',
    keywords: ['uber', 'lyft', 'taxi', 'shell', 'chevron', 'bp station', 'exxon', 'mobil', 'sunoco', 'marathon', 'citgo', 'valero', 'gasoline', 'fuel', 'gas station', 'parking', 'garage park', 'toll', 'e-zpass', 'fastrak', 'metro', 'mta', 'bart', 'cta', 'septa', 'wmata', 'transit', 'bus pass', 'train', 'amtrak'],
  },
  {
    category: 'Shopping',
    color: '#a855f7',
    keywords: ['amazon', 'walmart', 'target', 'ebay', 'etsy', 'best buy', 'home depot', 'lowes', 'ikea', 'costco', 'sam\'s club', 'bj\'s', 'gap', 'old navy', 'banana republic', 'h&m', 'zara', 'uniqlo', 'macy', 'nordstrom', 'bloomingdale', 'tj maxx', 'marshalls', 'ross dress', 'burlington', 'nike', 'adidas', 'foot locker', 'dick\'s sporting', 'chewy', 'petco', 'petsmart', 'wayfair', 'overstock', 'shopify'],
  },
  {
    category: 'Entertainment',
    color: '#ec4899',
    keywords: ['netflix', 'spotify', 'hulu', 'disney+', 'disney plus', 'hbo', 'apple tv', 'peacock', 'paramount+', 'sling', 'youtube premium', 'amazon prime', 'twitch', 'steam', 'playstation', 'xbox', 'nintendo', 'apple music', 'tidal', 'pandora', 'movie theater', 'amc theatre', 'regal cinema', 'concert', 'ticketmaster', 'eventbrite', 'bowling', 'arcade', 'museum', 'zoo'],
  },
  {
    category: 'Utilities',
    color: '#06b6d4',
    keywords: ['electric', 'electricity', 'gas utility', 'natural gas', 'water bill', 'sewer', 'comcast', 'xfinity', 'spectrum', 'cox comm', 'att internet', 'verizon fios', 'centurylink', 't-mobile', 'verizon wireless', 'sprint', 'boost mobile', 'internet', 'cable tv', 'utility', 'pge', 'con edison', 'duke energy', 'dominion energy'],
  },
  {
    category: 'Healthcare',
    color: '#14b8a6',
    keywords: ['cvs pharmacy', 'walgreens', 'rite aid', 'pharmacy', 'hospital', 'urgent care', 'clinic', 'dental', 'orthodont', 'vision', 'optometrist', 'eye care', 'doctor', 'physician', 'medical', 'health ins', 'blue cross', 'aetna', 'cigna', 'humana', 'unitedhealthcare', 'lab corp', 'quest diagnost'],
  },
  {
    category: 'Travel',
    color: '#f59e0b',
    keywords: ['hotel', 'airbnb', 'vrbo', 'marriott', 'hilton', 'hyatt', 'ihg', 'wyndham', 'best western', 'motel', 'inn', 'resort', 'airfare', 'delta air', 'american airlines', 'united airlines', 'southwest air', 'jetblue', 'spirit airlines', 'frontier air', 'alaska air', 'booking.com', 'expedia', 'kayak', 'priceline', 'travelocity', 'rental car', 'hertz', 'enterprise', 'avis', 'budget rent'],
  },
  {
    category: 'Financial',
    color: '#6366f1',
    keywords: ['transfer', 'wire transfer', 'bill pay', 'loan payment', 'mortgage', 'car payment', 'auto loan', 'student loan', 'insurance premium', 'life insurance', 'fidelity', 'vanguard', 'schwab', 'robinhood', 'coinbase', 'credit card payment', 'bank fee', 'atm fee', 'overdraft'],
  },
];

function categorize(description) {
  const lower = description.toLowerCase();
  for (const rule of RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) return rule.category;
    }
  }
  return 'Other';
}

// ── CSV column detection ─────────────────────────────────────────────────────

function detectColumns(headers) {
  const h = headers.map((x) => x.toLowerCase().trim());

  const dateIdx = h.findIndex((x) => x.includes('date') || x === 'posted' || x === 'transaction date');
  const descIdx = h.findIndex((x) => x.includes('desc') || x.includes('memo') || x.includes('narrat') || x.includes('detail') || x.includes('payee') || x === 'name');

  // Amount: look for a single "amount" column first, then debit/credit
  let amountIdx = h.findIndex((x) => x === 'amount');
  let debitIdx = h.findIndex((x) => x.includes('debit') || x === 'withdrawal');
  let creditIdx = h.findIndex((x) => x.includes('credit') || x === 'deposit');

  return { dateIdx, descIdx, amountIdx, debitIdx, creditIdx };
}

function parseAmount(str) {
  if (!str || str.trim() === '' || str.trim() === '-') return null;
  const cleaned = str.replace(/[$,\s]/g, '').replace(/[()]/g, (m) => (m === '(' ? '-' : ''));
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}

// ── Upload endpoint ──────────────────────────────────────────────────────────

app.post('/api/upload', upload.single('file'), (req, res) => {
  try {
    const csv = req.file.buffer.toString('utf8');

    let records;
    try {
      records = parse(csv, { columns: true, skip_empty_lines: true, trim: true, bom: true });
    } catch {
      // Try without header
      records = parse(csv, { columns: false, skip_empty_lines: true, trim: true, bom: true });
      if (!records.length) return res.status(400).json({ error: 'Could not parse CSV' });
      // Use first row as headers
      const headers = records[0];
      records = records.slice(1).map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
    }

    if (!records.length) return res.status(400).json({ error: 'CSV is empty' });

    const headers = Object.keys(records[0]);
    const { dateIdx, descIdx, amountIdx, debitIdx, creditIdx } = detectColumns(headers);

    const transactions = [];

    for (const row of records) {
      const values = Object.values(row);
      const keys = Object.keys(row);

      const date = dateIdx >= 0 ? values[dateIdx] : (row['Date'] || row['date'] || '');
      const description = descIdx >= 0 ? values[descIdx] : (row['Description'] || row['description'] || row['Memo'] || row['memo'] || values[1] || '');

      let amount = null;
      if (amountIdx >= 0) {
        amount = parseAmount(values[amountIdx]);
      } else if (debitIdx >= 0 || creditIdx >= 0) {
        const debit = debitIdx >= 0 ? parseAmount(values[debitIdx]) : null;
        const credit = creditIdx >= 0 ? parseAmount(values[creditIdx]) : null;
        if (debit != null && debit !== 0) amount = -Math.abs(debit);
        else if (credit != null && credit !== 0) amount = Math.abs(credit);
      }

      if (!description && amount == null) continue;

      transactions.push({
        id: transactions.length,
        date: date || '',
        description: description || '',
        amount: amount ?? 0,
        category: categorize(description || ''),
      });
    }

    res.json({ transactions, headers });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to process file: ' + err.message });
  }
});

app.post('/api/recategorize', (req, res) => {
  const { transactions } = req.body;
  const updated = transactions.map((t) => ({
    ...t,
    category: categorize(t.description),
  }));
  res.json({ transactions: updated });
});

app.get('/api/categories', (_req, res) => {
  res.json(RULES.map(({ category, color }) => ({ category, color })).concat([{ category: 'Other', color: '#9ca3af' }]));
});

// Serve frontend for all other routes
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(port, () => {
  console.log(`Bank categorizer running on http://localhost:${port}`);
});
