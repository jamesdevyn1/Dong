/* globals Chart, api */

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  period:  'month',
  date:    todayStr(),
  page:    1,
  limit:   50,
  search:  '',
  chart:   null,
  total:   0,
};

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  bindEvents();
  setActiveTab('month');
  refresh();
});

function bindEvents() {
  // Period tabs
  document.getElementById('periodTabs').addEventListener('click', e => {
    const tab = e.target.closest('[data-period]');
    if (!tab) return;
    state.period = tab.dataset.period;
    state.page   = 1;
    state.date   = todayStr();
    setActiveTab(state.period);
    refresh();
  });

  document.getElementById('btnPrev').addEventListener('click',  () => shiftPeriod(-1));
  document.getElementById('btnNext').addEventListener('click',  () => shiftPeriod(+1));
  document.getElementById('btnToday').addEventListener('click', () => { state.date = todayStr(); state.page = 1; refresh(); });

  // Open file
  document.getElementById('btnOpen').addEventListener('click',  openFile);
  document.getElementById('btnExport').addEventListener('click', exportExcel);

  // Search (debounced)
  let searchTimer;
  document.getElementById('searchInput').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = e.target.value.trim();
      state.page   = 1;
      loadPayments();
    }, 300);
  });

  // Modal close
  document.getElementById('modalClose').addEventListener('click',   closeModal);
  document.getElementById('backdrop').addEventListener('click', e => {
    if (e.target === document.getElementById('backdrop')) closeModal();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  // Menu triggers from main process
  api.onMenu('menu-open',   openFile);
  api.onMenu('menu-export', exportExcel);
}

// ── Open + import file ────────────────────────────────────────────────────────
async function openFile() {
  const result = await api.openFile();
  if (!result) return;
  if (result.error) { showToast(result.error, true); return; }
  showToast(`✓ Imported ${result.claimCount} claims from ${result.fileName}`);
  refresh();
}

async function exportExcel() {
  const result = await api.exportExcel({ period: state.period, date: state.date });
  if (result && result.canceled) return;
  if (result && result.error) { showToast(result.error, true); return; }
  showToast('✓ Excel file saved');
}

// ── Refresh (dashboard + table) ───────────────────────────────────────────────
async function refresh() {
  updateDateLabel();
  await Promise.all([loadDashboard(), loadPayments()]);
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function loadDashboard() {
  let data;
  try {
    data = await api.getDashboard({ period: state.period, date: state.date });
  } catch (e) {
    return;
  }
  updateCards(data.summary);
  updateChart(data);
}

function updateCards(s) {
  const payments  = +s.total_payments  || 0;
  const reversals = +s.total_reversals || 0;
  const net       = payments - reversals;

  document.getElementById('cPayments').textContent    = fmt(payments);
  document.getElementById('cPaymentClaims').textContent = `${s.claim_count} claim${s.claim_count !== 1 ? 's' : ''}`;
  document.getElementById('cReversals').textContent   = fmt(reversals);
  document.getElementById('cNet').textContent         = fmt(net);
  document.getElementById('cClaims').textContent      = s.claim_count;
  document.getElementById('cPayers').textContent      = `${s.payer_count} payer${s.payer_count !== 1 ? 's' : ''}`;

  const card = document.getElementById('cNetCard');
  card.classList.remove('green', 'red', 'blue');
  card.classList.add(net > 0 ? 'green' : net < 0 ? 'red' : 'blue');
  document.getElementById('cNetIcon').textContent = net > 0 ? '▲' : net < 0 ? '▼' : '—';
}

function updateChart(data) {
  const chartWrap  = document.getElementById('chartWrap');
  const chartEmpty = document.getElementById('chartEmpty');

  if (!data.chartData || !data.chartData.length) {
    chartWrap.style.display  = 'none';
    chartEmpty.style.display = 'flex';
    if (state.chart) { state.chart.destroy(); state.chart = null; }
    return;
  }

  chartWrap.style.display  = 'block';
  chartEmpty.style.display = 'none';

  const { labels, payments, reversals } = buildChartSeries(data);

  if (state.chart) {
    state.chart.data.labels                 = labels;
    state.chart.data.datasets[0].data       = payments;
    state.chart.data.datasets[1].data       = reversals;
    state.chart.data.datasets[2].data       = payments.map((p, i) => p - reversals[i]);
    state.chart.update('active');
    return;
  }

  const ctx = document.getElementById('chart').getContext('2d');
  state.chart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar', label: 'Payments',
          data: payments, backgroundColor: '#86efac', borderColor: '#16a34a', borderWidth: 1.5, borderRadius: 4,
        },
        {
          type: 'bar', label: 'Reversals',
          data: reversals, backgroundColor: '#fca5a5', borderColor: '#dc2626', borderWidth: 1.5, borderRadius: 4,
        },
        {
          type: 'line', label: 'Net Income',
          data: payments.map((p, i) => p - reversals[i]),
          borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,.08)',
          pointBackgroundColor: '#2563eb', pointRadius: 3, tension: .35,
          fill: true, borderWidth: 2, yAxisID: 'y',
        },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 16, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.raw)}`,
          },
        },
      },
      scales: {
        x: { grid: { display: false }, ticks: { font: { size: 11 } } },
        y: {
          beginAtZero: true,
          ticks: { font: { size: 11 }, callback: v => '$' + shortFmt(v) },
          grid: { color: '#f1f5f9' },
        },
      },
    },
  });
}

function buildChartSeries({ period, start, bucketFmt, chartData }) {
  // Build the full set of expected labels for this period
  const expected = buildExpectedBuckets(period, start);
  const dataMap  = Object.fromEntries(
    (chartData || []).map(r => [r.bucket, { payments: +r.payments, reversals: +r.reversals }])
  );
  const labels   = expected.map(b => b.label);
  const payments  = expected.map(b => dataMap[b.key]?.payments  || 0);
  const reversals = expected.map(b => dataMap[b.key]?.reversals || 0);
  return { labels, payments, reversals };
}

function buildExpectedBuckets(period, startIso) {
  const start = new Date(startIso);
  const buckets = [];
  switch (period) {
    case 'day':
      for (let h = 0; h < 24; h++) {
        const label = h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h - 12} PM`;
        buckets.push({ key: String(h).padStart(2, '0'), label });
      }
      break;
    case 'week': {
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      for (let i = 0; i < 7; i++) {
        const d = new Date(start.getTime() + i * 86400000);
        const key   = d.toISOString().slice(0, 10);
        const label = `${days[i]} ${d.getUTCDate()}`;
        buckets.push({ key, label });
      }
      break;
    }
    case 'month': {
      const y = start.getUTCFullYear(), m = start.getUTCMonth();
      const days = new Date(y, m + 1, 0).getDate();
      for (let d = 1; d <= days; d++) {
        const key = `${y}-${String(m + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        buckets.push({ key, label: String(d) });
      }
      break;
    }
    case 'year': {
      const y = start.getUTCFullYear();
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      for (let m = 0; m < 12; m++) {
        const key = `${y}-${String(m + 1).padStart(2,'0')}`;
        buckets.push({ key, label: months[m] });
      }
      break;
    }
  }
  return buckets;
}

// ── Payments table ────────────────────────────────────────────────────────────
async function loadPayments() {
  let data;
  try {
    data = await api.getPayments({
      period: state.period, dateStr: state.date,
      page: state.page, limit: state.limit, search: state.search,
    });
  } catch (e) {
    return;
  }

  state.total = data.total;
  const tbody = document.getElementById('tblBody');

  if (!data.rows.length) {
    tbody.innerHTML = `<tr><td colspan="8" class="tbl-empty">No payments for this period.</td></tr>`;
    document.getElementById('pager').innerHTML = '';
    return;
  }

  tbody.innerHTML = data.rows.map(r => `
    <tr data-id="${r.id}">
      <td>${fmtDate(r.created_at)}</td>
      <td><code style="font-size:12px">${esc(r.claim_id)}</code></td>
      <td>${esc(r.payer || '—')}</td>
      <td><span class="badge badge-${r.type.toLowerCase()}">${esc(r.type)}</span></td>
      <td class="num">${fmt(r.charged_amount)}</td>
      <td class="num" style="font-weight:600;color:${r.type==='Reversal'?'var(--red)':'var(--green)'}">
        ${fmt(Math.abs(r.paid_amount))}
      </td>
      <td class="num">${fmt(r.patient_responsibility)}</td>
      <td style="font-size:12px;color:var(--muted)">${esc(r.claim_status || '—')}</td>
    </tr>
  `).join('');

  // Row click → detail modal
  tbody.querySelectorAll('tr[data-id]').forEach(row => {
    row.addEventListener('click', () => openModal(+row.dataset.id));
  });

  renderPager(data.total);
}

function renderPager(total) {
  const pages = Math.ceil(total / state.limit);
  if (pages <= 1) { document.getElementById('pager').innerHTML = `<span>${total} record${total !== 1 ? 's' : ''}</span>`; return; }

  const cur   = state.page;
  let btns    = `<span style="margin-right:8px">${total} records</span>`;
  btns += `<button class="pager-btn" ${cur===1?'disabled':''} data-pg="${cur-1}">&#8592;</button>`;

  const lo = Math.max(1, cur - 2), hi = Math.min(pages, cur + 2);
  if (lo > 1)      btns += `<button class="pager-btn" data-pg="1">1</button>${lo>2?'<span>…</span>':''}`;
  for (let p = lo; p <= hi; p++)
    btns += `<button class="pager-btn ${p===cur?'active':''}" data-pg="${p}">${p}</button>`;
  if (hi < pages)  btns += `${hi<pages-1?'<span>…</span>':''}<button class="pager-btn" data-pg="${pages}">${pages}</button>`;

  btns += `<button class="pager-btn" ${cur===pages?'disabled':''} data-pg="${cur+1}">&#8594;</button>`;

  const pager = document.getElementById('pager');
  pager.innerHTML = btns;
  pager.querySelectorAll('[data-pg]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.page = +btn.dataset.pg;
      loadPayments();
    });
  });
}

// ── Payment detail modal ──────────────────────────────────────────────────────
async function openModal(id) {
  let p;
  try { p = await api.getPaymentDetail(id); } catch (e) { return; }
  if (!p) return;

  document.getElementById('modalTitle').textContent = `Claim ${p.claim_id}`;

  const adjRows = p.adjustments.length
    ? p.adjustments.map(a => `
        <tr>
          <td>${esc(a.adjustment_group || '—')}</td>
          <td><strong>${esc(a.reason_code || '—')}</strong></td>
          <td class="num">${fmt(a.adjusted_amount)}</td>
        </tr>`).join('')
    : `<tr><td colspan="3" class="no-adj" style="padding:10px">No adjustments recorded.</td></tr>`;

  document.getElementById('modalBody').innerHTML = `
    <div class="detail-grid">
      <div class="detail-field"><label>Claim ID</label><span>${esc(p.claim_id)}</span></div>
      <div class="detail-field"><label>Payer</label><span>${esc(p.payer || '—')}</span></div>
      <div class="detail-field"><label>Type</label><span class="badge badge-${p.type.toLowerCase()}">${esc(p.type)}</span></div>
      <div class="detail-field"><label>Status</label><span>${esc(p.claim_status || '—')}</span></div>
      <div class="detail-field"><label>Charged Amount</label><span>${fmt(p.charged_amount)}</span></div>
      <div class="detail-field"><label>Paid Amount</label><span style="font-weight:700;color:${p.type==='Reversal'?'var(--red)':'var(--green)'}">
        ${fmt(Math.abs(p.paid_amount))}</span></div>
      <div class="detail-field"><label>Patient Responsibility</label><span>${fmt(p.patient_responsibility)}</span></div>
      <div class="detail-field"><label>Date Imported</label><span>${fmtDate(p.created_at)}</span></div>
      ${p.service_date ? `<div class="detail-field"><label>Service Date</label><span>${p.service_date}</span></div>` : ''}
    </div>
    <div class="detail-section-title">Adjustments / Reason Codes</div>
    <table class="adj-table">
      <thead><tr><th>Group</th><th>Reason Code</th><th class="num">Adjusted Amount</th></tr></thead>
      <tbody>${adjRows}</tbody>
    </table>
  `;

  document.getElementById('backdrop').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('backdrop').classList.add('hidden');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n) {
  const v = +n || 0;
  return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function shortFmt(n) {
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(0);
}
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function setActiveTab(period) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.period === period));
}

function updateDateLabel() {
  document.getElementById('dateLabel').textContent = formatPeriodLabel(state.period, state.date);
}

function formatPeriodLabel(period, dateStr) {
  const d = new Date(dateStr + 'T12:00:00Z');
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const SHORT  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  switch (period) {
    case 'day':
      return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    case 'week': {
      const dow = d.getUTCDay();
      const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (dow === 0 ? 6 : dow - 1)));
      const sun = new Date(mon.getTime() + 6 * 86400000);
      return `${SHORT[mon.getUTCMonth()]} ${mon.getUTCDate()} – ${SHORT[sun.getUTCMonth()]} ${sun.getUTCDate()}, ${sun.getUTCFullYear()}`;
    }
    case 'month':
      return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    case 'year':
      return String(d.getUTCFullYear());
  }
}

function shiftPeriod(dir) {
  const d = new Date(state.date + 'T12:00:00Z');
  switch (state.period) {
    case 'day':   d.setUTCDate(d.getUTCDate()         + dir);     break;
    case 'week':  d.setUTCDate(d.getUTCDate()         + dir * 7); break;
    case 'month': d.setUTCMonth(d.getUTCMonth()       + dir);     break;
    case 'year':  d.setUTCFullYear(d.getUTCFullYear() + dir);     break;
  }
  state.date = d.toISOString().slice(0, 10);
  state.page = 1;
  refresh();
}

function showToast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className   = `toast${isError ? ' error' : ''}`;
  setTimeout(() => t.classList.add('hidden'), 3500);
}
