import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tableToIPC } from 'apache-arrow';
import type { Table } from 'apache-arrow';
import { parseIPCMessages, flightDataToTable } from './ipc.js';
import { rowsToTable, tableToRows } from './convert.js';
import type { FlightData } from './generated/Flight.js';

/** Split a Table into FlightData messages, mirroring what a DoGet server sends. */
function tableToFlightData(table: Table): FlightData[] {
  return [...parseIPCMessages(tableToIPC(table))].map(({ header, body }) => ({
    flightDescriptor: undefined,
    dataHeader: header,
    appMetadata: new Uint8Array(),
    dataBody: body,
  }));
}

describe('flightDataToTable', () => {
  it('round-trips rows through the FlightData framing', () => {
    const rows = [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
      { id: 3, name: 'Carol' },
    ];

    const messages = tableToFlightData(rowsToTable(rows));
    const table = flightDataToTable(messages);

    assert.deepEqual(tableToRows(table), rows);
  });

  it('round-trips a multi-column table with its schema and values', () => {
    const rows = [{ int: 1, float: 1.5, str: 'a', bool: true }];

    const table = flightDataToTable(tableToFlightData(rowsToTable(rows)));

    assert.equal(table.numRows, 1);
    assert.equal(table.numCols, 4);
    assert.deepEqual(tableToRows(table), rows);
  });

  it('pads data_header whose length is not a multiple of 8', () => {
    const rows = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }];
    // Simulate a server that sends an unpadded data_header. Appending bytes makes the
    // length non-8-aligned; trailing bytes are ignored by the flatbuffer reader, so
    // this exercises the header padding without risk of corrupting the message.
    const messages = tableToFlightData(rowsToTable(rows)).map((m) => ({
      ...m,
      dataHeader: Buffer.concat([Buffer.from(m.dataHeader), Buffer.alloc(5)]),
    }));

    assert.deepEqual(tableToRows(flightDataToTable(messages)), rows);
  });

  it('reassembles a multi-record-batch stream', () => {
    const batchA = tableToFlightData(rowsToTable([{ id: 1 }, { id: 2 }]));
    const batchB = tableToFlightData(rowsToTable([{ id: 3 }, { id: 4 }]));
    // Same schema, so reuse the first schema message and append both batch messages.
    const combined = [...batchA, batchB[batchB.length - 1]];

    const table = flightDataToTable(combined);

    assert.deepEqual(tableToRows(table), [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
  });

  it('round-trips nested structs and null cells', () => {
    const rows = [
      { id: 1, meta: { a: 1, nested: { x: 10 } } },
      { id: 2, meta: { a: 2, nested: { x: 20 } } },
      { id: 3, meta: null },
    ];

    const table = flightDataToTable(tableToFlightData(rowsToTable(rows)));

    assert.deepEqual(tableToRows(table), rows);
  });

  it('skips app-metadata-only frames (empty dataHeader)', () => {
    const rows = [{ id: 1 }, { id: 2 }];
    const messages = tableToFlightData(rowsToTable(rows));

    const withMetaFrame: FlightData[] = [
      { flightDescriptor: undefined, dataHeader: new Uint8Array(), appMetadata: Buffer.from('meta'), dataBody: new Uint8Array() },
      ...messages,
    ];

    assert.deepEqual(tableToRows(flightDataToTable(withMetaFrame)), rows);
  });

  it('throws when no message carries Arrow data', () => {
    const metaOnly: FlightData[] = [
      { flightDescriptor: undefined, dataHeader: new Uint8Array(), appMetadata: Buffer.from('meta'), dataBody: new Uint8Array() },
    ];

    assert.throws(() => flightDataToTable(metaOnly), /no data received/i);
    assert.throws(() => flightDataToTable([]), /no data received/i);
  });
});
