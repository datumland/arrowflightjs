import { tableFromIPC } from 'apache-arrow';
import type { Table } from 'apache-arrow';
import type { FlightData } from './generated/Flight.js';

// Arrow IPC encapsulated-message prefix: 0xFFFFFFFF continuation token.
const CONTINUATION = 0xffffffff;

/** Round a byte length up to the next 8-byte boundary. */
function pad8(n: number): number {
  return (n + 7) & ~7;
}

/**
 * Parse an Arrow IPC stream into individual {header, body} pairs.
 * Each pair maps to one FlightData message:
 *   data_header = IPC Message flatbuffer
 *   data_body   = IPC Message body (record batch buffers)
 */
export function* parseIPCMessages(buf: Uint8Array): Generator<{ header: Buffer; body: Buffer }> {
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

/**
 * Reassemble a stream of FlightData messages into an Arrow Table.
 *
 * Inverse of parseIPCMessages: each message's {dataHeader, dataBody} becomes one
 * encapsulated IPC message (continuation + metadata length + padded header + body),
 * terminated by an end-of-stream marker, then handed to tableFromIPC.
 *
 * The header is padded to an 8-byte boundary so the body starts aligned even when a
 * server sends an unpadded data_header. The body is emitted verbatim: the reader
 * takes its length from the IPC message's own bodyLength field, not from the framing,
 * so padding the body cannot help and would misalign a non-conformant stream.
 *
 * Messages with an empty dataHeader carry only app_metadata and contribute no Arrow
 * data, so they are skipped here (they remain visible via FlightResult.raw).
 */
export function flightDataToTable(messages: FlightData[]): Table {
  const chunks: Buffer[] = [];

  for (const msg of messages) {
    if (msg.dataHeader.length === 0) continue;

    const header = Buffer.from(msg.dataHeader);
    const paddedHeaderLen = pad8(header.length);

    const prefix = Buffer.alloc(8);
    prefix.writeUInt32LE(CONTINUATION, 0);
    prefix.writeInt32LE(paddedHeaderLen, 4);

    const paddedHeader = Buffer.alloc(paddedHeaderLen);
    header.copy(paddedHeader);

    chunks.push(prefix, paddedHeader, Buffer.from(msg.dataBody));
  }

  if (chunks.length === 0) {
    throw new Error('no data received — DoGet stream carried no Arrow data');
  }

  // End-of-stream marker: continuation + zero metadata length.
  const eos = Buffer.alloc(8);
  eos.writeUInt32LE(CONTINUATION, 0);
  eos.writeUInt32LE(0, 4);
  chunks.push(eos);

  return tableFromIPC(Buffer.concat(chunks));
}
