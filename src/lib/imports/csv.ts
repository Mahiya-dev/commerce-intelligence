/**
 * RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF/LF, multi-line
 * fields). Strips a UTF-8 BOM. Delimiter is auto-detected between `,` and `;`
 * from the header line (Excel with Indonesian locale saves CSV with `;`).
 */
export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvParseError";
  }
}

export function detectDelimiter(text: string): "," | ";" {
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (const ch of firstLine) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === ",") commas++;
    else if (!quoted && ch === ";") semicolons++;
  }
  return semicolons > commas ? ";" : ",";
}

export function parseCsv(input: string, delimiter?: "," | ";"): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const sep = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;

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
    if (ch === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
    } else if (ch === sep) {
      row.push(field);
      field = "";
      fieldStarted = false;
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      fieldStarted = false;
    } else {
      field += ch;
      fieldStarted = true;
    }
  }
  if (inQuotes) throw new CsvParseError('Tanda kutip (") tidak ditutup; file CSV rusak.');
  if (fieldStarted || field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
