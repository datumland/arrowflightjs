import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseLocation } from './location.js';

describe('parseLocation', () => {
  it('parses a bare host:port and defers TLS', () => {
    assert.deepEqual(parseLocation('localhost:50051'), { address: 'localhost:50051' });
  });

  it('parses grpc:// as insecure', () => {
    assert.deepEqual(parseLocation('grpc://host:1234'), { address: 'host:1234', tls: false });
  });

  it('parses grpc+tls:// as TLS', () => {
    assert.deepEqual(parseLocation('grpc+tls://host:1234'), { address: 'host:1234', tls: true });
  });

  it('accepts a Location object', () => {
    assert.deepEqual(parseLocation({ uri: 'grpc://host:1234' }), { address: 'host:1234', tls: false });
  });

  it('matches schemes case-insensitively and preserves host casing', () => {
    assert.deepEqual(parseLocation('GRPC+TLS://Host:1234'), { address: 'Host:1234', tls: true });
  });

  it('strips a trailing slash', () => {
    assert.deepEqual(parseLocation('grpc://host:1234/'), { address: 'host:1234', tls: false });
  });

  it('throws when the host is empty', () => {
    assert.throws(() => parseLocation('grpc://'), /no host/i);
  });

  it('throws for reuse-connection locations', () => {
    assert.throws(() => parseLocation(''), /reuse-connection/i);
    assert.throws(() => parseLocation('arrow-flight-reuse-connection://?'), /reuse-connection/i);
  });

  it('throws for HTTP locations', () => {
    assert.throws(() => parseLocation('https://host/data'), /HTTP Flight locations/i);
  });

  it('throws for other unsupported schemes', () => {
    assert.throws(() => parseLocation('grpc+unix:///tmp/sock'), /unsupported Flight location scheme/i);
  });
});
