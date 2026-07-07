import { Metadata } from 'nice-grpc';
import type { FlightServiceClient } from '../generated/Flight.js';
import type { FlightDescriptor, FlightEndpoint, FlightInfo } from '../generated/Flight.js';
import { FlightDescriptor_DescriptorType } from '../generated/Flight.js';

export type DescriptorInput = { path: string[] } | { cmd: Buffer | Uint8Array };

/** The response of a GetFlightInfo call: the raw FlightInfo and its endpoints. */
export class FlightInfoResult {
  constructor(private readonly info: FlightInfo) {}

  raw(): FlightInfo {
    return this.info;
  }

  endpoints(): FlightEndpoint[] {
    return this.info.endpoint;
  }
}

function toDescriptor(input: DescriptorInput): FlightDescriptor {
  if ('cmd' in input) {
    return {
      type: FlightDescriptor_DescriptorType.CMD,
      cmd: input.cmd,
      path: [],
    };
  }
  return {
    type: FlightDescriptor_DescriptorType.PATH,
    path: input.path,
    cmd: Buffer.alloc(0),
  };
}

export class FlightsOperation {
  private descriptor: FlightDescriptor;
  private headers: Record<string, string> | undefined;

  constructor(
    private client: FlightServiceClient,
    descriptor: DescriptorInput,
  ) {
    this.descriptor = toDescriptor(descriptor);
  }

  withHeaders(headers: Record<string, string>): this {
    this.headers = headers;
    return this;
  }

  async execute(): Promise<FlightInfoResult> {
    const options = this.headers ? { metadata: Metadata(this.headers) } : undefined;
    return new FlightInfoResult(await this.client.getFlightInfo(this.descriptor, options));
  }
}
