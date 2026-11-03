const ExcelJS = require('exceljs');

/**
 * Neutralises spreadsheet formula injection: text starting with = + - @,
 * tab or carriage return is prefixed with an apostrophe.
 */
const safeCell = (value) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    const text = String(value);
    return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
};

const csvField = (value) => {
    const text = String(safeCell(value));
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** CSV with a UTF-8 BOM so Excel opens non-English names correctly. */
const toCsv = (columns, rows) => {
    const lines = [columns.map((c) => csvField(c.header)).join(',')];
    for (const row of rows) lines.push(columns.map((c) => csvField(row[c.key])).join(','));
    return `﻿${lines.join('\r\n')}\r\n`;
};

const toXlsxBuffer = async (columns, rows, sheetName) => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(sheetName.slice(0, 31));
    sheet.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width || 18 }));
    for (const row of rows) {
        sheet.addRow(Object.fromEntries(columns.map((c) => [c.key, safeCell(row[c.key])])));
    }
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    return Buffer.from(await workbook.xlsx.writeBuffer());
};

/** Sends rows as CSV (default) or Excel with a dated attachment filename. */
const sendExport = async (res, { format, basename, sheetName, columns, rows }) => {
    const date = new Date().toISOString().slice(0, 10);
    const isXlsx = format === 'xlsx';
    const body = isXlsx ? await toXlsxBuffer(columns, rows, sheetName) : toCsv(columns, rows);

    res.set({
        'Content-Type': isXlsx
            ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            : 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${basename}-${date}.${isXlsx ? 'xlsx' : 'csv'}"`,
        'Cache-Control': 'private, no-store',
    });
    return res.send(body);
};

module.exports = { safeCell, toCsv, toXlsxBuffer, sendExport };
