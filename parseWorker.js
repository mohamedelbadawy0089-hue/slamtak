// parseWorker.js – runs in a Web Worker context
self.addEventListener('message', function (e) {
  const text = e.data;
  // ------- parseExcelPasteRaw logic (simplified) -------
  if (!text) {
    self.postMessage({ headers: [], rows: [], delimiter: null, hasHeader: false });
    return;
  }
  const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  if (lines.length === 0) {
    self.postMessage({ headers: [], rows: [], delimiter: null, hasHeader: false });
    return;
  }
  const headerCells = lines[0].split('\t');
  const dataLines = lines.slice(1).filter(l => l.length > 0);
  const allRows = [headerCells].concat(dataLines.map(l => l.split('\t')));
  let maxCols = 0;
  allRows.forEach(r => { if (r.length > maxCols) maxCols = r.length; });
  const padRow = row => {
    const r = row.slice();
    while (r.length < maxCols) r.push('');
    return r;
  };
  const headers = padRow(headerCells);
  const rows = dataLines.map(l => padRow(l.split('\t')));
  // ---------------------------------------------------
  self.postMessage({ headers, rows, delimiter: '\t', hasHeader: headers.length > 0 });
});
