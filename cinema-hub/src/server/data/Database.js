/**
 * CINEMA HUB — Koneksi spreadsheet & pembuatan/migrasi tabel.
 */
const Database = (() => {
  const TEXT_TYPES = { string: true, text: true, date: true, time: true, datetime: true, json: true, csv: true };

  function ss() {
    return Scope.get('db:ss', () => {
      const id = Config.prop(CH.PROPS.SPREADSHEET_ID);
      if (!id) throw Errors.create('NOT_INSTALLED');
      return SpreadsheetApp.openById(id);
    });
  }

  function sheet(name) {
    return Scope.get('db:sheet:' + name, () => {
      const sh = ss().getSheetByName(name);
      if (!sh) throw Errors.create('NOT_INSTALLED', 'Tabel ' + name + ' belum tersedia. Jalankan setupCinemaHub().');
      return sh;
    });
  }

  function ensureColumns(sh, needed) {
    const max = sh.getMaxColumns();
    if (needed > max) sh.insertColumnsAfter(max, needed - max);
  }

  function ensureRows(sh, needed) {
    const max = sh.getMaxRows();
    if (needed > max) sh.insertRowsAfter(max, Math.max(needed - max, 100));
  }

  /**
   * Membuat sheet bila belum ada dan menambahkan kolom yang belum ada DI KANAN.
   * Tidak pernah menghapus, mengurutkan ulang, atau menimpa data yang sudah ada.
   */
  function ensureTable(spreadsheet, def) {
    let sh = spreadsheet.getSheetByName(def.name);
    const created = !sh;
    if (!sh) sh = spreadsheet.insertSheet(def.name);

    const lastCol = sh.getLastColumn();
    const lastRow = sh.getLastRow();
    const existing = lastCol > 0
      ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map((h) => String(h).trim())
      : [];
    const hasHeader = existing.some(Boolean);
    if (!hasHeader && lastRow > 1) {
      throw new Error('Sheet ' + def.name + ' berisi data tetapi tidak memiliki header. Periksa manual sebelum inisialisasi.');
    }

    const missing = def.columns.filter((c) => existing.indexOf(c.name) < 0);
    const startCol = hasHeader ? lastCol + 1 : 1;
    if (missing.length) {
      ensureColumns(sh, startCol + missing.length - 1);
      sh.getRange(1, startCol, 1, missing.length).setValues([missing.map((c) => c.name)]);
      formatColumns(sh, def, missing, startCol);
    }

    const totalCols = (hasHeader ? lastCol : 0) + missing.length;
    if (created || missing.length) {
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, totalCols)
        .setFontWeight('bold')
        .setBackground('#0B1230')
        .setFontColor('#FFFFFF');
    }
    if (created) {
      try {
        sh.getRange(1, 1, 1, totalCols).protect()
          .setDescription('Header CINEMA HUB — jangan diubah')
          .setWarningOnly(true);
      } catch (e) { /* proteksi opsional */ }
    }
    return { name: def.name, created, addedColumns: missing.map((c) => c.name) };
  }

  /** Format kolom teks sebagai plain text (@) & dropdown untuk kolom enum. */
  function formatColumns(sh, def, columns, startCol) {
    const rows = Math.max(sh.getMaxRows() - 1, 1);
    const formats = [];
    for (let r = 0; r < rows; r++) {
      formats.push(columns.map((c) => (TEXT_TYPES[c.type] ? '@' : (c.type === 'int' ? '0' : 'General'))));
    }
    sh.getRange(2, startCol, rows, columns.length).setNumberFormats(formats);
    columns.forEach((c, i) => {
      const values = def.enums[c.name];
      if (!values) return;
      const rule = SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(true).build();
      sh.getRange(2, startCol + i, rows, 1).setDataValidation(rule);
    });
  }

  return { ss, sheet, ensureTable, ensureRows, ensureColumns };
})();
