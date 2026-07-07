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
} from './generated/Flight.js';
import { PutOperation } from './operations/put.js';
import { rowsToTable } from './convert.js';
import { ActionOperation } from './operations/action.js';
import { GetOperation } from './operations/get.js';
import type { TicketInput } from './operations/get.js';
import { FlightsOperation } from './operations/flights.js';
import type { DescriptorInput } from './operations/flights.js';
import { parseLocation } from './location.js';
import type { Location } from './generated/Flight.js';

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

  constructor(location: string | Location, options: FlightClientOptions = {}) {
    const { address, tls } = parseLocation(location);
    const useTls = tls ?? options.tls ?? false;
    const creds = useTls
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

  flights(descriptor: DescriptorInput): FlightsOperation {
    return new FlightsOperation(this.grpcClient, descriptor);
  }

  get(ticket: TicketInput | undefined): GetOperation {
    return new GetOperation(this.grpcClient, ticket);
  }

  action(type: string): ActionOperation {
    return new ActionOperation(this.grpcClient, type);
  }

  async close(): Promise<void> {
    this.channel.close();
  }
}
