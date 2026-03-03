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

// Execute a server action
const results = await client
  .action('myAction')
  .withBody(Buffer.from('payload'))
  .execute();

await client.close();
```

## API

### `new FlightClient(address, options?)`

Creates a client connected to a Flight server.

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

### `client.action(type)`

Starts a `DoAction` operation.

Returns an `ActionOperation` builder:

```ts
client.action('compact')
  .withBody(Buffer.from('{}'))
  .execute();                  // → Promise<Buffer[]>
```

### `rowsToTable(rows)`

Converts an array of plain objects to a columnar Arrow `Table`.

```ts
const table = rowsToTable([{ x: 1 }, { x: 2 }]);
```

## Development

```bash
npm install
npm run generate   # generate gRPC stubs from Flight.proto
npm run build      # compile TypeScript
npm test           # run tests
```

## License

[MIT](LICENSE)
