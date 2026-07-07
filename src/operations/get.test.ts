import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tableFromArrays, tableToIPC } from 'apache-arrow';
import type { Table } from 'apache-arrow';
import { GetOperation } from './get.js';
import { parseIPCMessages } from '../ipc.js';
import type { FlightServiceClient } from '../generated/Flight.js';
import type { FlightData, Ticket } from '../generated/Flight.js';

/** Split a Table into FlightData messages the way a server would for DoGet. */
function tableToFlightData(table: Table): FlightData[] {
  return [...parseIPCMessages(tableToIPC(table))].map(({ header, body }) => ({
    flightDescriptor: undefined,
    dataHeader: header,
    appMetadata: new Uint8Array(),
    dataBody: body,
  }));
}

/** Mock that captures the Ticket and CallOptions sent to doGet, then streams messages. */
function mockClient(messages: FlightData[] = []) {
  const captured: Ticket[] = [];
  const capturedOptions: unknown[] = [];

  const client = {
    captured,
    capturedOptions,
    doGet: async function* (ticket: Ticket, options?: unknown) {
      captured.push(ticket);
      capturedOptions.push(options);
      for (const m of messages) {
        yield m;
      }
    },
  } as unknown as FlightServiceClient & { captured: Ticket[]; capturedOptions: unknown[] };

  return client;
}

describe('GetOperation', () => {
  it('sends a Ticket object through unchanged', async () => {
    const client = mockClient();
    const ticket: Ticket = { ticket: Buffer.from('tok') };

    await new GetOperation(client, ticket).execute();

    assert.deepEqual(Buffer.from(client.captured[0].ticket), Buffer.from('tok'));
  });

  it('wraps raw bytes into a Ticket', async () => {
    const client = mockClient();

    await new GetOperation(client, Buffer.from('raw-ticket')).execute();

    assert.deepEqual(Buffer.from(client.captured[0].ticket), Buffer.from('raw-ticket'));
  });

  it('throws a clear error when the ticket is undefined', () => {
    const client = mockClient();

    assert.throws(() => new GetOperation(client, undefined), /no ticket/i);
  });

  it('passes gRPC metadata when withHeaders() is called', async () => {
    const client = mockClient();

    await new GetOperation(client, Buffer.from('t'))
      .withHeaders({ authorization: 'Bearer tok' })
      .execute();

    const opts = client.capturedOptions[0] as any;
    assert.ok(opts, 'options should be defined');
    assert.equal(opts.metadata.get('authorization'), 'Bearer tok');
  });

  it('passes no options when withHeaders() is not called', async () => {
    const client = mockClient();

    await new GetOperation(client, Buffer.from('t')).execute();

    assert.equal(client.capturedOptions[0], undefined);
  });

  it('exposes the raw FlightData stream', async () => {
    const messages = tableToFlightData(tableFromArrays({ id: [1, 2, 3] }));
    const client = mockClient(messages);

    const result = await new GetOperation(client, Buffer.from('t')).execute();

    assert.equal(result.raw().length, messages.length);
  });

  it('reassembles the stream into a Table', async () => {
    const table = tableFromArrays({ id: [1, 2, 3], name: ['a', 'b', 'c'] });
    const client = mockClient(tableToFlightData(table));

    const result = await new GetOperation(client, Buffer.from('t')).execute();

    assert.equal(result.table().numRows, 3);
    assert.equal(result.table().numCols, 2);
    assert.deepEqual(result.table().getChild('id')!.toArray(), new Float64Array([1, 2, 3]));
  });

  it('exposes rows as plain objects', async () => {
    const table = tableFromArrays({ id: [1, 2], name: ['Alice', 'Bob'] });
    const client = mockClient(tableToFlightData(table));

    const result = await new GetOperation(client, Buffer.from('t')).execute();

    assert.deepEqual(result.rows(), [
      { id: 1, name: 'Alice' },
      { id: 2, name: 'Bob' },
    ]);
  });

  it('memoizes table and rows across accesses', async () => {
    const client = mockClient(tableToFlightData(tableFromArrays({ id: [1] })));

    const result = await new GetOperation(client, Buffer.from('t')).execute();

    assert.equal(result.table(), result.table());
    assert.equal(result.rows(), result.rows());
  });

  it('returns empty raw and throws on table for an empty stream', async () => {
    const client = mockClient([]);

    const result = await new GetOperation(client, Buffer.from('t')).execute();

    assert.deepEqual(result.raw(), []);
    assert.throws(() => result.table(), /no data received/i);
  });

  it('withHeaders() returns this for chaining', () => {
    const client = mockClient();
    const op = new GetOperation(client, Buffer.from('t'));

    assert.equal(op.withHeaders({ 'x-token': 'abc' }), op);
  });
});
