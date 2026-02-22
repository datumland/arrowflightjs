import type { FlightServiceClient } from '../generated/Flight';

export class ActionOperation {
  private body: Buffer | undefined;

  constructor(
    private client: FlightServiceClient,
    private type: string,
  ) {}

  withBody(body: Buffer): this {
    this.body = body;
    return this;
  }

  async execute(): Promise<Buffer[]> {
    const results: Buffer[] = [];

    for await (const result of this.client.doAction({
      type: this.type,
      body: this.body ?? Buffer.alloc(0),
    })) {
      results.push(Buffer.from(result.body));
    }

    return results;
  }
}
