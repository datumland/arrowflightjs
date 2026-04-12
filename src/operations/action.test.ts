import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ActionOperation } from './action';
import type { FlightServiceClient } from '../generated/Flight';
import type { Action, Result } from '../generated/Flight';

/** Mock that captures the Action and CallOptions sent to doAction. */
function mockClient(results: Result[] = []) {
  const captured: Action[] = [];
  const capturedOptions: unknown[] = [];

  const client = {
    captured,
    capturedOptions,
    doAction: async function* (action: Action, options?: unknown) {
      captured.push(action);
      capturedOptions.push(options);
      for (const r of results) {
        yield r;
      }
    },
  } as unknown as FlightServiceClient & { captured: Action[]; capturedOptions: unknown[] };

  return client;
}

describe('ActionOperation', () => {
  it('sends action type and empty body by default', async () => {
    const client = mockClient();

    await new ActionOperation(client, 'healthcheck').execute();

    assert.equal(client.captured.length, 1);
    assert.equal(client.captured[0].type, 'healthcheck');
    assert.equal(Buffer.from(client.captured[0].body).length, 0);
  });

  it('sends action with body when withBody() is called', async () => {
    const client = mockClient();
    const body = Buffer.from('{"key":"value"}');

    await new ActionOperation(client, 'create')
      .withBody(body)
      .execute();

    assert.deepEqual(Buffer.from(client.captured[0].body), body);
  });

  it('returns result bodies as Buffers', async () => {
    const results: Result[] = [
      { body: Buffer.from('result-1') },
      { body: Buffer.from('result-2') },
    ];
    const client = mockClient(results);

    const out = await new ActionOperation(client, 'list').execute();

    assert.equal(out.length, 2);
    assert.deepEqual(out[0], Buffer.from('result-1'));
    assert.deepEqual(out[1], Buffer.from('result-2'));
  });

  it('returns empty array when server yields no results', async () => {
    const client = mockClient([]);

    const out = await new ActionOperation(client, 'noop').execute();

    assert.deepEqual(out, []);
  });

  it('withBody() returns this for chaining', () => {
    const client = mockClient();
    const op = new ActionOperation(client, 'x');

    assert.equal(op.withBody(Buffer.from('b')), op);
  });

  it('passes gRPC metadata when withHeaders() is called', async () => {
    const client = mockClient();

    await new ActionOperation(client, 'test')
      .withHeaders({ 'x-token': 'abc', 'x-request-id': '42' })
      .execute();

    const opts = client.capturedOptions[0] as any;
    assert.ok(opts, 'options should be defined');
    assert.equal(opts.metadata.get('x-token'), 'abc');
    assert.equal(opts.metadata.get('x-request-id'), '42');
  });

  it('passes no options when withHeaders() is not called', async () => {
    const client = mockClient();

    await new ActionOperation(client, 'test').execute();

    assert.equal(client.capturedOptions[0], undefined);
  });

  it('withHeaders() returns this for chaining', () => {
    const client = mockClient();
    const op = new ActionOperation(client, 'x');

    assert.equal(op.withHeaders({ 'x-token': 'abc' }), op);
  });
});
