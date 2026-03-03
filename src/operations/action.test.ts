import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ActionOperation } from './action';
import type { FlightServiceClient } from '../generated/Flight';
import type { Action, Result } from '../generated/Flight';

/** Mock that captures the Action sent to doAction. */
function mockClient(results: Result[] = []) {
  const captured: Action[] = [];

  const client = {
    captured,
    doAction: async function* (action: Action) {
      captured.push(action);
      for (const r of results) {
        yield r;
      }
    },
  } as unknown as FlightServiceClient & { captured: Action[] };

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
});
