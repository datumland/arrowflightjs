import { tableToIPC } from 'apache-arrow';
import type { Table } from 'apache-arrow';
import { Metadata } from 'nice-grpc';
import type { FlightServiceClient } from '../generated/Flight.js';
import { FlightDescriptor_DescriptorType } from '../generated/Flight.js';
import type { FlightDescriptor, FlightData, PutResult } from '../generated/Flight.js';

/**
 * Parse an Arrow IPC stream into individual {header, body} pairs.
 * Each pair maps to one FlightData message:
 *   data_header = IPC Message flatbuffer
 *   data_body   = IPC Message body (record batch buffers)
 */
function* parseIPCMessages(buf: Uint8Array): Generator<{ header: Buffer; body: Buffer }> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let offset = 0;

  while (offset + 8 <= buf.length) {
    // Continuation token: 0xFFFFFFFF (-1 as int32)
    if (view.getInt32(offset, true) !== -1) break;
    offset += 4;

    // Metadata length (includes padding to 8-byte boundary)
    const metadataLength = view.getInt32(offset, true);
    offset += 4;
    if (metadataLength === 0) break; // end-of-stream marker

    const header = Buffer.from(buf.buffer, buf.byteOffset + offset, metadataLength);
    offset += metadataLength;

    const bodyLength = readBodyLength(header);

    const body = bodyLength > 0
      ? Buffer.from(buf.buffer, buf.byteOffset + offset, bodyLength)
      : Buffer.alloc(0);
    offset += bodyLength;

    // Pad to 8-byte boundary for next message
    offset = (offset + 7) & ~7;

    yield { header, body };
  }
}

/**
 * Read the bodyLength field from an Arrow IPC Message flatbuffer.
 *
 * Message table fields (vtable indices):
 *   0: version        (int16)
 *   1: header_type    (uint8, union discriminator)
 *   2: header         (offset, union value)
 *   3: bodyLength     (int64)
 *   4: custom_metadata (offset)
 */
function readBodyLength(metadata: Buffer): number {
  const view = new DataView(metadata.buffer, metadata.byteOffset, metadata.byteLength);

  // Root table offset (uint32 at buffer start)
  const rootOffset = view.getUint32(0, true);

  // VTable: root table starts with signed offset to vtable
  const vtableSOffset = view.getInt32(rootOffset, true);
  const vtablePos = rootOffset - vtableSOffset;
  const vtableSize = view.getUint16(vtablePos, true);

  // bodyLength is vtable field 3 → entry at vtablePos + 4 + 2*3
  const entryPos = 4 + 2 * 3; // 10
  if (entryPos + 2 > vtableSize) return 0;

  const fieldOffset = view.getUint16(vtablePos + entryPos, true);
  if (fieldOffset === 0) return 0;

  // Read int64 as low + high uint32
  const pos = rootOffset + fieldOffset;
  const low = view.getUint32(pos, true);
  const high = view.getUint32(pos + 4, true);
  return high * 0x100000000 + low;
}

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
