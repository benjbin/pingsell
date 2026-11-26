import { detectColumns, isEmptyCell, languageOfCell, splitFullName, type ContactField } from './csvColumns.js';

/** A cell longer than this, or a row with more cells, is not a contact list: the file is rejected at once. */
export const CSV_MAX_FIELD_CHARS = 100_000;
export const CSV_MAX_CELLS = 1_000;

/** Thrown by parseCsv on a file no spreadsheet produces (one 20 MB cell, a million columns…). */
export class CsvLimitError extends Error {}

/**
 * Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF) with
 * delimiter auto-detection (`,` `;` or tab — French Excel exports use `;`).
 * Stops once `maxRows` non-blank rows are read: a 20 MB file of short lines is never fully materialised
 * (millions of small arrays) just to be rejected by the row cap afterwards. Throws CsvLimitError on a cell longer
 * than CSV_MAX_FIELD_CHARS or a row of more than CSV_MAX_CELLS cells.
 */
export function parseCsv(input: string, maxRows = Infinity): string[][] {
  const text = input.replace(/^﻿/, '');
  // Delimiter guessed from the start of the first line only: a 20 MB line without a newline would otherwise be
  // split three times into millions of pieces on the event loop.
  const firstLine = text.slice(0, 64 * 1024).split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best,
  );

  const rows: string[][] = [];
  const keep = (r: string[]) => {
    if (r.some((cell) => cell.trim() !== '')) rows.push(r);
  };
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
        if (field.length > CSV_MAX_FIELD_CHARS) throw new CsvLimitError('field');
      }
      continue;
    }
    if (ch === '"' && field === '') inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
      if (row.length > CSV_MAX_CELLS) throw new CsvLimitError('cells');
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      keep(row);
      row = [];
      field = '';
      if (rows.length >= maxRows) return rows;
    } else {
      field += ch;
      if (field.length > CSV_MAX_FIELD_CHARS) throw new CsvLimitError('field');
    }
  }
  if (field !== '' || row.length) {
    row.push(field);
    keep(row);
  }
  return rows;
}

export interface CsvContactRow {
  row: number;
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  language?: string;
  tags?: string[];
  status?: string;
  attributes: Record<string, string>;
}

/** Maps CSV rows (first row = header) to contact inputs. Unknown columns become attributes. */
export function csvToContacts(csv: string): CsvContactRow[] {
  const parsed = csvToContactsWithColumns(csv);
  return parsed.rows;
}

/**
 * Same, plus what each column was recognised as (`hasEmail` false = no column holds email addresses).
 * With `maxRows`, parsing stops after `maxRows + 1` data rows and `tooMany` is true when the file has more.
 */
export function csvToContactsWithColumns(
  csv: string,
  maxRows = Infinity,
): { headers: string[]; columns: Array<ContactField | null>; hasEmail: boolean; rows: CsvContactRow[]; tooMany: boolean } {
  const rows = parseCsv(csv, maxRows + 2);
  const tooMany = rows.length - 1 > maxRows;
  if (tooMany) rows.length = maxRows + 1;
  if (rows.length < 2) return { headers: rows[0] ?? [], columns: [], hasEmail: false, rows: [], tooMany };
  const headers = rows[0].map((h) => h.trim());
  const keys = detectColumns(headers, rows.slice(1, 201));
  const out = rows.slice(1).map((cells, i) => {
    const out: CsvContactRow = { row: i + 2, email: '', attributes: {} };
    let fullName = '';
    cells.forEach((raw, col) => {
      const value = raw.trim();
      const key = keys[col];
      if (isEmptyCell(value)) return;
      switch (key) {
        case 'email':
          out.email = value;
          break;
        case 'tags':
          out.tags = value.split(/[|,;]/).map((t) => t.trim()).filter(Boolean);
          break;
        case 'full_name':
          fullName = value;
          break;
        case 'language': {
          // Not a language (« oui », « 1 »…): kept as an attribute rather than lost.
          const code = languageOfCell(value);
          if (code) out.language = code;
          else if (headers[col]) out.attributes[headers[col]] = value;
          break;
        }
        case 'first_name':
        case 'last_name':
        case 'phone':
        case 'status':
          out[key] = value;
          break;
        default:
          if (headers[col]) out.attributes[headers[col]] = value;
      }
    });
    if (fullName && !out.first_name && !out.last_name) Object.assign(out, splitFullName(fullName));
    if (out.status) {
      const s = out.status.toLowerCase();
      // Unknown statuses ("active", "1"…) are kept as an attribute instead of rejecting the row.
      if (!(['subscribed', 'unsubscribed', 'bounced', 'complained'] as string[]).includes(s)) {
        out.attributes.status = out.status;
        delete out.status;
      } else out.status = s;
    }
    return out;
  });
  return { headers, columns: keys, hasEmail: keys.includes('email'), rows: out, tooMany };
}
