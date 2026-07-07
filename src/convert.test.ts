import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rowsToTable, tableToRows } from './convert.js';

describe('rowsToTable', () => {
  it('converts row objects to a columnar Arrow Table', () => {
    const table = rowsToTable([
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]);

    assert.equal(table.numRows, 2);
    assert.equal(table.numCols, 2);
    assert.deepEqual(table.getChild('id')!.toArray(), new Float64Array([1, 2]));
    assert.deepEqual([...table.getChild('name')!], ['Alice', 'Bob']);
  });

  it('handles a single row', () => {
    const table = rowsToTable([{ x: 42 }]);
    assert.equal(table.numRows, 1);
    assert.equal(table.getChild('x')!.get(0), 42);
  });

  it('handles nullable struct columns', () => {
    const table = rowsToTable([
      { id: 1, details: { a: 1 } },
      { id: 2, details: null },
    ]);

    assert.equal(table.numRows, 2);
    assert.equal(table.numCols, 2);
    assert.equal(table.getChild('details')!.get(0)?.a, 1);
    assert.equal(table.getChild('details')!.get(1), null);
  });

  it('handles struct columns missing from some rows (undefined → null)', () => {
    const table = rowsToTable([
      { id: 1 },
      { id: 2, value: { amount: 7555, currency: 'UAH' } },
      { id: 3, value: { amount: 100, currency: 'EUR' } },
    ]);

    assert.equal(table.numRows, 3);
    assert.equal(table.getChild('value')!.get(0), null);
    assert.equal(table.getChild('value')!.get(1)?.amount, 7555);
    assert.equal(table.getChild('value')!.get(2)?.currency, 'EUR');
  });

  it('normalises nested structs with differing sub-keys', () => {
    const table = rowsToTable([
      { id: 1, meta: { a: 1, nested: { x: 10 } } },
      { id: 2, meta: { a: 2 } },
      { id: 3, meta: null },
    ]);

    assert.equal(table.numRows, 3);
    assert.equal(table.getChild('meta')!.get(0)?.nested?.x, 10);
    assert.equal(table.getChild('meta')!.get(1)?.nested, null);
    assert.equal(table.getChild('meta')!.get(2), null);
  });

  it('throws on empty array', () => {
    assert.throws(() => rowsToTable([]), /at least one row/);
  });

  it('handles various value types', () => {
    const table = rowsToTable([
      { int: 1, float: 1.5, str: 'a', bool: true },
    ]);

    assert.equal(table.numCols, 4);
    assert.equal(table.getChild('int')!.get(0), 1);
    assert.equal(table.getChild('float')!.get(0), 1.5);
    assert.equal(table.getChild('str')!.get(0), 'a');
    assert.equal(table.getChild('bool')!.get(0), true);
  });
});

describe('tableToRows', () => {
  it('round-trips flat rows', () => {
    const rows = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ];

    assert.deepEqual(tableToRows(rowsToTable(rows)), rows);
  });

  it('deep-converts nested structs to plain objects', () => {
    const rows = [
      { id: 1, meta: { a: 1, nested: { x: 10 } } },
      { id: 2, meta: { a: 2, nested: { x: 20 } } },
    ];

    const out = tableToRows(rowsToTable(rows));

    assert.deepEqual(out, rows);
    // Nested value must be a plain object, not an Arrow StructRow proxy.
    assert.equal((out[0].meta as { constructor: unknown }).constructor, Object);
  });

  it('keeps null struct cells null', () => {
    const rows = [
      { id: 1, meta: { a: 1 } },
      { id: 2, meta: null },
    ];

    assert.deepEqual(tableToRows(rowsToTable(rows)), rows);
  });
});
