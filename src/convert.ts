import { tableFromArrays } from 'apache-arrow';
import type { Table } from 'apache-arrow';

/** Pivot an array of row objects into a columnar Arrow Table. */
export function rowsToTable(rows: Record<string, unknown>[]): Table {
  if (rows.length === 0) {
    throw new Error('rowsToTable requires at least one row');
  }

  const columns: Record<string, unknown[]> = {};
  for (const key of Object.keys(rows[0])) {
    columns[key] = rows.map(r => r[key]);
  }

  return tableFromArrays(columns);
}
