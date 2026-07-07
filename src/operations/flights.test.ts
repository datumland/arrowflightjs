import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FlightsOperation } from './flights.js';
import { FlightDescriptor_DescriptorType } from '../generated/Flight.js';
import type { FlightServiceClient } from '../generated/Flight.js';
import type { FlightDescriptor, FlightInfo } from '../generated/Flight.js';

function emptyFlightInfo(): FlightInfo {
  return {
    schema: new Uint8Array(),
    flightDescriptor: undefined,
    endpoint: [],
    totalRecords: 0,
    totalBytes: 0,
    ordered: false,
    appMetadata: new Uint8Array(),
  };
}

/** Mock that captures the FlightDescriptor and CallOptions sent to getFlightInfo. */
function mockClient(info: FlightInfo = emptyFlightInfo()) {
  const captured: FlightDescriptor[] = [];
  const capturedOptions: unknown[] = [];

  const client = {
    captured,
    capturedOptions,
    getFlightInfo: async (descriptor: FlightDescriptor, options?: unknown): Promise<FlightInfo> => {
      captured.push(descriptor);
      capturedOptions.push(options);
      return info;
    },
  } as unknown as FlightServiceClient & { captured: FlightDescriptor[]; capturedOptions: unknown[] };

  return client;
}

describe('FlightsOperation', () => {
  it('maps { path } to a PATH descriptor', async () => {
    const client = mockClient();

    await new FlightsOperation(client, { path: ['db', 'table'] }).execute();

    assert.deepEqual(client.captured[0], {
      type: FlightDescriptor_DescriptorType.PATH,
      path: ['db', 'table'],
      cmd: Buffer.alloc(0),
    });
  });

  it('maps { cmd } to a CMD descriptor', async () => {
    const client = mockClient();
    const cmd = Buffer.from('SELECT 1');

    await new FlightsOperation(client, { cmd }).execute();

    assert.equal(client.captured[0].type, FlightDescriptor_DescriptorType.CMD);
    assert.deepEqual(Buffer.from(client.captured[0].cmd), cmd);
    assert.deepEqual(client.captured[0].path, []);
  });

  it('exposes the server FlightInfo via raw()', async () => {
    const info = emptyFlightInfo();
    info.totalRecords = 42;
    const client = mockClient(info);

    const result = await new FlightsOperation(client, { path: ['x'] }).execute();

    assert.equal(result.raw().totalRecords, 42);
  });

  it('exposes the endpoints via endpoints()', async () => {
    const info = emptyFlightInfo();
    info.endpoint = [
      { ticket: { ticket: Buffer.from('t1') }, location: [], expirationTime: undefined, appMetadata: new Uint8Array() },
    ];
    const client = mockClient(info);

    const result = await new FlightsOperation(client, { path: ['x'] }).execute();

    assert.equal(result.endpoints().length, 1);
    assert.deepEqual(Buffer.from(result.endpoints()[0].ticket!.ticket), Buffer.from('t1'));
  });

  it('passes gRPC metadata when withHeaders() is called', async () => {
    const client = mockClient();

    await new FlightsOperation(client, { path: ['x'] })
      .withHeaders({ authorization: 'Bearer tok' })
      .execute();

    const opts = client.capturedOptions[0] as any;
    assert.ok(opts, 'options should be defined');
    assert.equal(opts.metadata.get('authorization'), 'Bearer tok');
  });

  it('passes no options when withHeaders() is not called', async () => {
    const client = mockClient();

    await new FlightsOperation(client, { path: ['x'] }).execute();

    assert.equal(client.capturedOptions[0], undefined);
  });

  it('withHeaders() returns this for chaining', () => {
    const client = mockClient();
    const op = new FlightsOperation(client, { path: ['x'] });

    assert.equal(op.withHeaders({ 'x-token': 'abc' }), op);
  });
});
