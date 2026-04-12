import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tableFromArrays } from 'apache-arrow';
import { PutOperation } from './put.js';
import { FlightDescriptor_DescriptorType } from '../generated/Flight.js';
import type { FlightServiceClient } from '../generated/Flight.js';
import type { FlightData, PutResult } from '../generated/Flight.js';

/** Minimal mock that captures the FlightData messages and CallOptions sent via doPut. */
function mockClient(putResults: PutResult[] = []) {
  const captured: FlightData[] = [];
  const capturedOptions: unknown[] = [];

  const client = {
    captured,
    capturedOptions,
    doPut: async function* (stream: AsyncIterable<FlightData>, options?: unknown) {
      capturedOptions.push(options);
      for await (const msg of stream) {
        captured.push(msg);
      }
      for (const r of putResults) {
        yield r;
      }
    },
  } as unknown as FlightServiceClient & { captured: FlightData[]; capturedOptions: unknown[] };

  return client;
}

describe('PutOperation', () => {
  const table = tableFromArrays({ id: [1, 2, 3] });

  it('throws when execute() called without descriptor', async () => {
    const client = mockClient();
    const op = new PutOperation(client, table);

    await assert.rejects(() => op.execute(), /descriptor required/i);
  });

  it('sends FlightData with PATH descriptor via toPath()', async () => {
    const client = mockClient();

    await new PutOperation(client, table)
      .toPath(['db', 'table'])
      .execute();

    assert.ok(client.captured.length > 0, 'should send at least one FlightData message');

    const first = client.captured[0];
    assert.deepEqual(first.flightDescriptor, {
      type: FlightDescriptor_DescriptorType.PATH,
      path: ['db', 'table'],
      cmd: Buffer.alloc(0),
    });

    // Descriptor should only be on the first message
    for (const msg of client.captured.slice(1)) {
      assert.equal(msg.flightDescriptor, undefined);
    }
  });

  it('sends FlightData with CMD descriptor via toCmd()', async () => {
    const client = mockClient();
    const cmd = Buffer.from('SELECT 1');

    await new PutOperation(client, table)
      .toCmd(cmd)
      .execute();

    const first = client.captured[0];
    assert.equal(first.flightDescriptor!.type, FlightDescriptor_DescriptorType.CMD);
    assert.deepEqual(Buffer.from(first.flightDescriptor!.cmd), cmd);
  });

  it('attaches appMetadata to first message only', async () => {
    const client = mockClient();
    const meta = Buffer.from('my-meta');

    await new PutOperation(client, table)
      .toPath(['x'])
      .withMetadata(meta)
      .execute();

    const first = client.captured[0];
    assert.deepEqual(Buffer.from(first.appMetadata), meta);

    for (const msg of client.captured.slice(1)) {
      assert.equal(Buffer.from(msg.appMetadata).length, 0);
    }
  });

  it('returns PutResults from server', async () => {
    const expected: PutResult[] = [
      { appMetadata: Buffer.from('ack') },
    ];
    const client = mockClient(expected);

    const results = await new PutOperation(client, table)
      .toPath(['x'])
      .execute();

    assert.equal(results.length, 1);
    assert.deepEqual(Buffer.from(results[0].appMetadata), Buffer.from('ack'));
  });

  it('sends valid IPC data (header and body are non-empty buffers)', async () => {
    const client = mockClient();

    await new PutOperation(client, table)
      .toPath(['x'])
      .execute();

    for (const msg of client.captured) {
      assert.ok(msg.dataHeader.length > 0, 'dataHeader should not be empty');
      // dataBody may be empty for schema-only messages
    }
  });

  it('builder methods return this for chaining', () => {
    const client = mockClient();
    const op = new PutOperation(client, table);

    assert.equal(op.toPath(['a']), op);

    const op2 = new PutOperation(client, table);
    assert.equal(op2.toCmd(Buffer.from('x')), op2);

    const op3 = new PutOperation(client, table);
    assert.equal(op3.withMetadata(Buffer.from('m')), op3);
  });

  it('passes gRPC metadata when withHeaders() is called', async () => {
    const client = mockClient();

    await new PutOperation(client, table)
      .toPath(['x'])
      .withHeaders({ 'authorization': 'Bearer tok' })
      .execute();

    const opts = client.capturedOptions[0] as any;
    assert.ok(opts, 'options should be defined');
    assert.equal(opts.metadata.get('authorization'), 'Bearer tok');
  });

  it('passes no options when withHeaders() is not called', async () => {
    const client = mockClient();

    await new PutOperation(client, table)
      .toPath(['x'])
      .execute();

    assert.equal(client.capturedOptions[0], undefined);
  });

  it('withHeaders() returns this for chaining', () => {
    const client = mockClient();
    const op = new PutOperation(client, table);

    assert.equal(op.withHeaders({ 'x-token': 'abc' }), op);
  });
});
