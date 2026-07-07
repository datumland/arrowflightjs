import { tableFromJSON } from 'apache-arrow';
import type { Table } from 'apache-arrow';

/**
 * Collect the union of all keys that appear across an array of objects.
 * For keys whose values are plain objects in at least one element,
 * recurse to collect sub-keys as well.
 */
function collectKeys(
  values: (Record<string, unknown> | null | undefined)[],
): Map<string, Map<string, unknown> | null> {
  const keys = new Map<string, Map<string, unknown> | null>();
  for (const obj of values) {
    if (obj == null || typeof obj !== 'object') continue;
    for (const [k, v] of Object.entries(obj)) {
      if (!keys.has(k)) keys.set(k, null);
      if (v != null && typeof v === 'object' && !Array.isArray(v)) {
        // Mark this key as struct — we'll need to recurse.
        keys.set(k, keys.get(k) ?? new Map());
      }
    }
  }

  // For every key that has struct values, recurse into all its instances.
  for (const [k, sub] of keys) {
    if (sub !== null) {
      const children = values
        .map((obj) => (obj != null ? (obj as Record<string, unknown>)[k] : null))
        .filter((v): v is Record<string, unknown> => v != null && typeof v === 'object' && !Array.isArray(v));
      const childKeys = collectKeys(children);
      keys.set(k, childKeys);
    }
  }

  return keys;
}

/** Fill missing keys with null, recursing into struct sub-keys. */
function normaliseRow(
  row: Record<string, unknown>,
  schema: Map<string, Map<string, unknown> | null>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, childSchema] of schema) {
    const val = key in row ? row[key] : null;
    if (val != null && childSchema !== null && typeof val === 'object' && !Array.isArray(val)) {
      out[key] = normaliseRow(val as Record<string, unknown>, childSchema as Map<string, Map<string, unknown> | null>);
    } else {
      out[key] = val ?? null;
    }
  }
  return out;
}

/** Pivot an array of row objects into a columnar Arrow Table. */
export function rowsToTable(rows: Record<string, unknown>[]): Table {
  if (rows.length === 0) {
    throw new Error('rowsToTable requires at least one row');
  }

  const schema = collectKeys(rows);
  const normalised = rows.map((row) => normaliseRow(row, schema));

  return tableFromJSON(normalised);
}

/**
 * Recursively turn an Arrow row value into plain JS.
 * StructRow.toJSON() is shallow — nested structs come back as StructRow proxies and
 * lists as Vectors — so recurse until every value is a plain object / array / scalar.
 */
function toPlain(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value; // scalars, bigint, null
  if (value instanceof Date || value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return value.map(toPlain);

  const json = (value as { toJSON?: () => unknown }).toJSON?.();
  if (Array.isArray(json)) return json.map(toPlain); // Vector (list)
  if (json != null && typeof json === 'object') {
    // StructRow / MapRow
    return Object.fromEntries(
      Object.entries(json).map(([k, v]) => [k, toPlain(v)]),
    );
  }
  return value;
}

/** Pivot a columnar Arrow Table back into an array of plain row objects. */
export function tableToRows(table: Table): Record<string, unknown>[] {
  return table.toArray().map((row) => toPlain(row) as Record<string, unknown>);
}
