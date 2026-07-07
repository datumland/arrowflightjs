import { Metadata } from 'nice-grpc';
import type { Table } from 'apache-arrow';
import type { FlightServiceClient } from '../generated/Flight.js';
import type { FlightData, Ticket } from '../generated/Flight.js';
import { flightDataToTable } from '../ipc.js';
import { tableToRows } from '../convert.js';

export type TicketInput = Ticket | Buffer | Uint8Array;

function toTicket(input: TicketInput | undefined): Ticket {
  if (input == null) {
    throw new Error('no ticket to redeem — the endpoint carries no ticket');
  }
  return input instanceof Uint8Array ? { ticket: input } : input;
}

/**
 * The materialized response of a DoGet stream. Holds the raw FlightData messages
 * and derives the Table / row views lazily, caching each so all three can be read.
 */
export class FlightResult {
  private tableCache: Table | undefined;
  private rowsCache: Record<string, unknown>[] | undefined;

  constructor(private readonly messages: FlightData[]) {}

  raw(): FlightData[] {
    return this.messages;
  }

  table(): Table {
    if (!this.tableCache) {
      this.tableCache = flightDataToTable(this.messages);
    }
    return this.tableCache;
  }

  rows(): Record<string, unknown>[] {
    if (!this.rowsCache) {
      this.rowsCache = tableToRows(this.table());
    }
    return this.rowsCache;
  }
}

export class GetOperation {
  private ticket: Ticket;
  private headers: Record<string, string> | undefined;

  constructor(
    private client: FlightServiceClient,
    ticket: TicketInput | undefined,
  ) {
    this.ticket = toTicket(ticket);
  }

  withHeaders(headers: Record<string, string>): this {
    this.headers = headers;
    return this;
  }

  async execute(): Promise<FlightResult> {
    const options = this.headers ? { metadata: Metadata(this.headers) } : undefined;
    const messages: FlightData[] = [];
    for await (const data of this.client.doGet(this.ticket, options)) {
      messages.push(data);
    }
    return new FlightResult(messages);
  }
}
