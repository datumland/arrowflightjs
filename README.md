# @datumland/arrowflightjs

A lightweight [Arrow Flight](https://arrow.apache.org/docs/format/Flight.html) client for Node.js. Send Apache Arrow tables over gRPC with a fluent API.

## Install

```bash
npm install @datumland/arrowflightjs
```

Peer requirement: Node.js >= 18.

## Quick start

```ts
import { FlightClient, rowsToTable } from '@datumland/arrowflightjs';

const client = new FlightClient('localhost:50051');

// Upload rows as an Arrow table
await client
  .put([
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
  ])
  .toPath(['my', 'dataset'])
  .execute();

// Or pass an Arrow Table directly
import { tableFromArrays } from 'apache-arrow';

const table = tableFromArrays({ id: [1, 2], name: ['Alice', 'Bob'] });
await client.put(table).toPath(['my', 'dataset']).execute();

// Retrieve: describe a dataset, then fetch an endpoint's ticket
const info = await client.flights({ path: ['my', 'dataset'] }).execute();
const result = await client.get(info.endpoints()[0].ticket).execute();

result.table(); // apache-arrow Table
result.rows();  // [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]

// Execute a server action
const results = await client
  .action('myAction')
  .withBody(Buffer.from('payload'))
  .execute();

await client.close();
```

## API

### `new FlightClient(location, options?)`

Creates a client connected to a Flight server. `location` is a `host:port` address,
a `grpc://` / `grpc+tls://` URI, or a Flight `Location` object (as found on an
endpoint). The scheme sets TLS (`grpc+tls://` → on); a bare address falls back to
the `tls` option. Only bare addresses and `grpc://` / `grpc+tls://` are accepted
(case-insensitive); every other URI scheme — reuse-connection, `http(s)://`,
`grpc+unix://`, … — throws.

| Option       | Type                  | Description                        |
| ------------ | --------------------- | ---------------------------------- |
| `tls`        | `boolean`             | Use TLS (default `false`)          |
| `headers`    | `Record<string, string>` | Headers sent with every RPC     |
| `middleware` | `ClientMiddleware[]`  | nice-grpc middleware chain         |

### `client.put(data)`

Starts a `DoPut` operation. Accepts an Arrow `Table` or an array of row objects (converted via `rowsToTable`).

Returns a `PutOperation` builder:

```ts
client.put(rows)
  .toPath(['bucket', 'key'])   // or .toCmd(Buffer.from('...'))
  .withMetadata(Buffer.from('app meta'))
  .execute();                  // → Promise<PutResult[]>
```

### `client.flights(descriptor)`

Starts a `GetFlightInfo` operation. `descriptor` is `{ path: string[] }` or
`{ cmd: Buffer }`.

Returns a `FlightsOperation` builder whose `execute()` resolves to a
`FlightInfoResult`:

```ts
const info = await client.flights({ path: ['bucket', 'key'] })  // or { cmd: Buffer.from('SELECT ...') }
  .withHeaders({ authorization: 'Bearer tok' })
  .execute();                  // → Promise<FlightInfoResult>

info.raw();        // the underlying FlightInfo (schema, totals, metadata)
info.endpoints();  // FlightEndpoint[] — each carries a ticket and locations
```

A flight may be partitioned across several endpoints; consume each one to read the
whole flight. An endpoint's `location` says where its ticket can be redeemed: an
empty list (or `arrow-flight-reuse-connection`) means the current client; a
`grpc://` / `grpc+tls://` URI means another server, reached by opening a new client:

```ts
for (const endpoint of info.endpoints()) {
  const reuse = endpoint.location.length === 0;
  const target = reuse ? client : new FlightClient(endpoint.location[0]);
  const result = await target.get(endpoint.ticket).execute();
  // ... use result.table() / result.rows()
  if (!reuse) await target.close();
}
```

### `client.get(ticket)`

Starts a `DoGet` operation. `ticket` is a `Ticket` (as found in
`FlightInfo.endpoint[].ticket`) or raw ticket bytes (`Buffer` / `Uint8Array`).

Returns a `GetOperation` builder whose `execute()` resolves to a `FlightResult`:

```ts
const result = await client.get(ticket)
  .withHeaders({ ... })
  .execute();                  // → Promise<FlightResult>

result.table();  // apache-arrow Table
result.rows();   // Record<string, unknown>[]
result.raw();    // FlightData[] (the raw stream)
```

The whole stream is drained by `execute()`. `table()` and `rows()` are derived
lazily and cached; reading an empty stream leaves `raw()` empty and makes
`table()`/`rows()` throw.

### `client.action(type)`

Starts a `DoAction` operation.

Returns an `ActionOperation` builder:

```ts
client.action('compact')
  .withBody(Buffer.from('{}'))
  .execute();                  // → Promise<Buffer[]>
```

### `rowsToTable(rows)` / `tableToRows(table)`

Convert between an array of plain objects and a columnar Arrow `Table`.

```ts
const table = rowsToTable([{ x: 1 }, { x: 2 }]);
const rows = tableToRows(table);   // [{ x: 1 }, { x: 2 }]
```

`tableToRows` recurses into nested structs and lists, so rows are plain objects.
Arrow types map to their JS equivalents — notably 64-bit integers come back as
`bigint` (not JSON-serializable) and timestamps as `Date`.

## Development

```bash
npm install
npm run generate   # generate gRPC stubs from Flight.proto
npm run build      # compile TypeScript
npm test           # run tests
```

## License

[MIT](LICENSE)
