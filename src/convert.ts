import { tableFromJSON } from 'apache-arrow';
import type { Table } from 'apache-arrow';

/** Pivot an array of row objects into a columnar Arrow Table. */
export function rowsToTable(rows: Record<string, unknown>[]): Table {
  if (rows.length === 0) {
    throw new Error('rowsToTable requires at least one row');
  }

  return tableFromJSON(rows);
}
