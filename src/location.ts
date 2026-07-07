import type { Location } from './generated/Flight.js';

export interface ResolvedLocation {
  address: string;
  /** Whether the scheme forces TLS. `undefined` means defer to client options. */
  tls?: boolean;
}

/**
 * Resolve a Flight Location (or its URI / a bare host:port) into an address and
 * TLS setting for FlightClient. Only bare addresses and the gRPC schemes are
 * accepted (scheme matching is case-insensitive):
 *
 *   grpc://host:port      → insecure
 *   grpc+tls://host:port  → TLS
 *   host:port             → address as-is, TLS deferred to client options
 *
 * Every other URI scheme throws: reuse-connection and HTTP can't back a standalone
 * gRPC DoGet client, and grpc+unix / other schemes aren't supported yet.
 */
export function parseLocation(input: string | Location): ResolvedLocation {
  const uri = typeof input === 'string' ? input : input.uri;
  const scheme = uri.toLowerCase();

  if (uri === '' || scheme.startsWith('arrow-flight-reuse-connection')) {
    throw new Error(
      'cannot open a client for a reuse-connection location — redeem the ticket on the originating client',
    );
  }
  if (scheme.startsWith('grpc+tls://')) {
    return { address: host(uri.slice('grpc+tls://'.length), uri), tls: true };
  }
  if (scheme.startsWith('grpc://')) {
    return { address: host(uri.slice('grpc://'.length), uri), tls: false };
  }
  if (scheme.startsWith('http://') || scheme.startsWith('https://')) {
    throw new Error(`HTTP Flight locations are not supported: ${uri}`);
  }
  if (uri.includes('://')) {
    throw new Error(`unsupported Flight location scheme: ${uri}`);
  }
  return { address: host(uri, uri) };
}

/** Strip a trailing slash and reject an empty host. */
function host(address: string, uri: string): string {
  const trimmed = address.replace(/\/+$/, '');
  if (trimmed === '') {
    throw new Error(`location has no host: ${uri}`);
  }
  return trimmed;
}
