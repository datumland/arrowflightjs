import { tableToIPC } from 'apache-arrow';
import type { Table } from 'apache-arrow';
import type { FlightServiceClient } from '../generated/Flight';
import { FlightDescriptor_DescriptorType } from '../generated/Flight';
import type { FlightDescriptor, FlightData, PutResult } from '../generated/Flight';

export class PutOperation {
  private descriptor: FlightDescriptor | undefined;
  private appMetadata: Buffer | undefined;

  constructor(
    private client: FlightServiceClient,
    private table: Table,
  ) {}

  toPath(path: string[]): this {
    this.descriptor = {
      type: FlightDescriptor_DescriptorType.PATH,
      path,
      cmd: Buffer.alloc(0),
    };
    return this;
  }

  toCmd(cmd: Buffer): this {
    this.descriptor = {
      type: FlightDescriptor_DescriptorType.CMD,
      cmd,
      path: [],
    };
    return this;
  }

  withMetadata(metadata: Buffer): this {
    this.appMetadata = metadata;
    return this;
  }

  async execute(): Promise<PutResult[]> {
    if (!this.descriptor) {
      throw new Error('Flight descriptor required — call toPath() or toCmd() before execute()');
    }

    const ipc = tableToIPC(this.table);

    const data: FlightData = {
      flightDescriptor: this.descriptor,
      dataHeader: Buffer.alloc(0),
      dataBody: Buffer.from(ipc),
      appMetadata: this.appMetadata ?? Buffer.alloc(0),
    };

    async function* stream() {
      yield data;
    }

    const results: PutResult[] = [];
    for await (const result of this.client.doPut(stream())) {
      results.push(result);
    }
    return results;
  }
}
