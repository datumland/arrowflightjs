import { tableToIPC } from 'apache-arrow';
import type { Table } from 'apache-arrow';
import { Metadata } from 'nice-grpc';
import type { FlightServiceClient } from '../generated/Flight.js';
import { FlightDescriptor_DescriptorType } from '../generated/Flight.js';
import type { FlightDescriptor, FlightData, PutResult } from '../generated/Flight.js';
import { parseIPCMessages } from '../ipc.js';

export class PutOperation {
  private descriptor: FlightDescriptor | undefined;
  private appMetadata: Buffer | undefined;
  private headers: Record<string, string> | undefined;

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

  withHeaders(headers: Record<string, string>): this {
    this.headers = headers;
    return this;
  }

  async execute(): Promise<PutResult[]> {
    if (!this.descriptor) {
      throw new Error('Flight descriptor required — call toPath() or toCmd() before execute()');
    }

    const ipcStream = tableToIPC(this.table);
    const messages = [...parseIPCMessages(ipcStream)];

    const descriptor = this.descriptor;
    const appMetadata = this.appMetadata;

    async function* flightDataStream(): AsyncGenerator<FlightData> {
      for (let i = 0; i < messages.length; i++) {
        const { header, body } = messages[i];
        yield {
          flightDescriptor: i === 0 ? descriptor : undefined,
          dataHeader: header,
          dataBody: body,
          appMetadata: i === 0 && appMetadata ? appMetadata : Buffer.alloc(0),
        };
      }
    }

    const options = this.headers ? { metadata: Metadata(this.headers) } : undefined;
    const results: PutResult[] = [];
    for await (const result of this.client.doPut(flightDataStream(), options)) {
      results.push(result);
    }
    return results;
  }
}
