const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFile:         ()       => ipcRenderer.invoke('open-file'),
  getDashboard:     (p)      => ipcRenderer.invoke('get-dashboard', p),
  getPayments:      (p)      => ipcRenderer.invoke('get-payments', p),
  getPaymentDetail: (id)     => ipcRenderer.invoke('get-payment-detail', id),
  exportExcel:      (p)      => ipcRenderer.invoke('export-excel', p),
  onMenu:           (ch, fn) => ipcRenderer.on(ch, fn),
});
