const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs   = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Pharmacy Accounting',
    backgroundColor: '#f0f2f5',
    show: false,
  });

  mainWindow.loadFile('renderer/index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.whenReady().then(() => {
  // Init DB (lazy — getDb() called inside initSchema)
  require('./src/pharmacy/db').initSchema();
  createWindow();
  buildMenu();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC handlers ──────────────────────────────────────────────────────────────

const { parseEDI835 }      = require('./src/pharmacy/edi835Parser');
const { buildWorkbook }    = require('./src/pharmacy/spreadsheet');
const db                   = require('./src/pharmacy/db');

ipcMain.handle('open-file', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Open EDI 835 Remittance File',
    filters: [
      { name: 'EDI Files', extensions: ['835', 'edi', 'txt', 'x12'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return null;

  const raw = fs.readFileSync(filePaths[0], 'utf8');
  let transactions;
  try {
    transactions = parseEDI835(raw);
  } catch (err) {
    return { error: `Parse error: ${err.message}` };
  }
  if (!transactions.length) return { error: 'No claims found in file. Is this an EDI 835?' };

  try {
    const batchId = db.saveBatch(path.basename(filePaths[0]), transactions);
    return { ok: true, batchId, claimCount: transactions.length, fileName: path.basename(filePaths[0]) };
  } catch (err) {
    return { error: `Database error: ${err.message}` };
  }
});

ipcMain.handle('get-dashboard', (_e, { period, date }) => {
  return db.getDashboardData(period, date);
});

ipcMain.handle('get-payments', (_e, params) => {
  return db.getPayments(params);
});

ipcMain.handle('get-payment-detail', (_e, id) => {
  return db.getPaymentById(id);
});

ipcMain.handle('export-excel', async (_e, { period, date }) => {
  const { rows } = db.getPayments({ period, dateStr: date, page: 1, limit: 100000, search: '' });

  const formatted = rows.map(r => ({
    ClaimID:               r.claim_id,
    Payer:                 r.payer,
    ClaimStatus:           r.claim_status,
    Type:                  r.type,
    ChargedAmount:         +r.charged_amount,
    PaidAmount:            +r.paid_amount,
    PatientResponsibility: +r.patient_responsibility,
    AdjustmentGroup:       '',
    ReasonCode:            '',
    AdjustedAmount:        0,
  }));

  const buffer = buildWorkbook(formatted);

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export to Excel',
    defaultPath: `remittance_${period}_${date}.xlsx`,
    filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
  });
  if (canceled || !filePath) return { canceled: true };

  fs.writeFileSync(filePath, buffer);
  shell.showItemInFolder(filePath);
  return { ok: true, filePath };
});

// Allow menu items to trigger renderer actions
function buildMenu() {
  const send = (ch) => mainWindow && mainWindow.webContents.send(ch);
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Open EDI 835 File…', accelerator: 'CmdOrCtrl+O', click: () => send('menu-open') },
        { label: 'Export to Excel…',   accelerator: 'CmdOrCtrl+E', click: () => send('menu-export') },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [{ role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { label: 'Toggle Developer Tools', accelerator: 'CmdOrCtrl+Shift+I', role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
