/**
 * Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF) with
 * delimiter auto-detection (`,` `;` or tab — French Excel exports use `;`).
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best,
  );

  const rows: string[][] = [];
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
      }
      continue;
    }
    if (ch === '"' && field === '') inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

const HEADER_ALIASES: Record<string, string> = {
  email: 'email',
  'e-mail': 'email',
  mail: 'email',
  courriel: 'email',
  'adresse email': 'email',
  first_name: 'first_name',
  firstname: 'first_name',
  'first name': 'first_name',
  prenom: 'first_name',
  prénom: 'first_name',
  last_name: 'last_name',
  lastname: 'last_name',
  'last name': 'last_name',
  nom: 'last_name',
  'nom de famille': 'last_name',
  phone: 'phone',
  telephone: 'phone',
  téléphone: 'phone',
  tel: 'phone',
  mobile: 'phone',
  tags: 'tags',
  tag: 'tags',
  étiquettes: 'tags',
  etiquettes: 'tags',
  status: 'status',
  statut: 'status',
};

export interface CsvContactRow {
  row: number;
  email: string;
  first_name?: string;
  last_name?: string;
  phone?: string;
  tags?: string[];
  status?: string;
  attributes: Record<string, string>;
}

/** Maps CSV rows (first row = header) to contact inputs. Unknown columns become attributes. */
export function csvToContacts(csv: string): CsvContactRow[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  const keys = headers.map((h) => HEADER_ALIASES[h.toLowerCase()] ?? null);
  return rows.slice(1).map((cells, i) => {
    const out: CsvContactRow = { row: i + 2, email: '', attributes: {} };
    cells.forEach((raw, col) => {
      const value = raw.trim();
      const key = keys[col];
      if (!value) return;
      switch (key) {
        case 'email':
          out.email = value;
          break;
        case 'tags':
          out.tags = value.split(/[|,;]/).map((t) => t.trim()).filter(Boolean);
          break;
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
    return out;
  });
}
