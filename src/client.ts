import {
  createChannel,
  createClientFactory,
  ClientMiddleware,
  CallOptions,
  Channel,
  ChannelCredentials,
  Metadata,
} from 'nice-grpc';
import type { Table } from 'apache-arrow';
import {
  FlightServiceDefinition,
  FlightServiceClient,
} from './generated/Flight';
import { PutOperation } from './operations/put';
import { rowsToTable } from './convert';
import { ActionOperation } from './operations/action';

export interface FlightClientOptions {
  tls?: boolean;
  headers?: Record<string, string>;
  middleware?: ClientMiddleware[];
}

function headersMiddleware(
  headers: Record<string, string>,
): ClientMiddleware {
  return async function* (call, options: CallOptions) {
    const metadata = Metadata(options.metadata);
    for (const [key, value] of Object.entries(headers)) {
      metadata.set(key, value);
    }
    return yield* call.next(call.request, {
      ...options,
      metadata,
    });
  };
}

export class FlightClient {
  private channel: Channel;
  private grpcClient: FlightServiceClient;

  constructor(address: string, options: FlightClientOptions = {}) {
    const creds = options.tls
      ? ChannelCredentials.createSsl()
      : ChannelCredentials.createInsecure();

    this.channel = createChannel(address, creds);

    const mw: ClientMiddleware[] = [];
    if (options.headers) {
      mw.push(headersMiddleware(options.headers));
    }
    if (options.middleware) {
      mw.push(...options.middleware);
    }

    let factory = createClientFactory();
    for (const m of mw) {
      factory = factory.use(m);
    }

    this.grpcClient = factory.create(FlightServiceDefinition, this.channel);
  }

  /** @internal Exposed for operation builders. */
  get rpc(): FlightServiceClient {
    return this.grpcClient;
  }

  put(data: Table | Record<string, unknown>[]): PutOperation {
    const table = Array.isArray(data) ? rowsToTable(data) : data;
    return new PutOperation(this.grpcClient, table);
  }

  action(type: string): ActionOperation {
    return new ActionOperation(this.grpcClient, type);
  }

  async close(): Promise<void> {
    this.channel.close();
  }
}
