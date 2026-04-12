import { Metadata } from 'nice-grpc';
import type { FlightServiceClient } from '../generated/Flight.js';

export class ActionOperation {
  private body: Buffer | undefined;
  private headers: Record<string, string> | undefined;

  constructor(
    private client: FlightServiceClient,
    private type: string,
  ) {}

  withBody(body: Buffer): this {
    this.body = body;
    return this;
  }

  withHeaders(headers: Record<string, string>): this {
    this.headers = headers;
    return this;
  }

  async execute(): Promise<Buffer[]> {
    const options = this.headers ? { metadata: Metadata(this.headers) } : undefined;
    const results: Buffer[] = [];

    for await (const result of this.client.doAction({
      type: this.type,
      body: this.body ?? Buffer.alloc(0),
    }, options)) {
      results.push(Buffer.from(result.body));
    }

    return results;
  }
}
