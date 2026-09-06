import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename } from 'node:path';
import { decrypt, deriveKeys, deriveMasterKey, encrypt, keyedBytes, type KdfParams, DEFAULT_KDF, SALT_SIZE, NONCE_SIZE, TAG_SIZE } from '../../crypto/src/index.js';
import { slotFor } from '../../placement/src/index.js';

const MAGIC = Buffer.from('PDENY001', 'ascii');
const HEADER_SIZE = 88;
const MAX_SLOTS = 10_000_000;
const CHUNK_METADATA_SIZE = 256;
const MAX_FILENAME_BYTES = CHUNK_METADATA_SIZE - 34;

export interface Header {
  version: number;
  flags: number;
  slotSize: number;
  slotCount: number;
  kdf: KdfParams;
  salt: Buffer;
  id: Buffer;
}

export interface RecoveredPayload {
  data: Buffer;
  payloadId: string;
  filename: string;
}

export function encodeHeader(header: Header): Buffer {
  const result = Buffer.alloc(HEADER_SIZE);
  MAGIC.copy(result, 0);
  result.writeUInt16BE(header.version, 8);
  result.writeUInt16BE(header.flags, 10);
  result.writeUInt32BE(header.slotSize, 12);
  result.writeUInt32BE(header.slotCount, 16);
  result.writeUInt32BE(header.kdf.memory, 20);
  result.writeUInt32BE(header.kdf.iterations, 24);
  result.writeUInt32BE(header.kdf.parallelism, 28);
  header.salt.copy(result, 32);
  header.id.copy(result, 64);
  return result;
}

export function decodeHeader(buffer: Buffer): Header {
  if (buffer.length < HEADER_SIZE || !buffer.subarray(0, 8).equals(MAGIC)) throw new Error('Invalid container header');
  const header: Header = {
    version: buffer.readUInt16BE(8), flags: buffer.readUInt16BE(10), slotSize: buffer.readUInt32BE(12), slotCount: buffer.readUInt32BE(16),
    kdf: { memory: buffer.readUInt32BE(20), iterations: buffer.readUInt32BE(24), parallelism: buffer.readUInt32BE(28) },
    salt: Buffer.from(buffer.subarray(32, 64)), id: Buffer.from(buffer.subarray(64, 88))
  };
  if (header.version !== 1 || header.slotSize < 1024 || header.slotCount < 1 || header.slotCount > MAX_SLOTS || header.slotSize > 64 * 1024 * 1024 || header.kdf.memory < 8 * 1024) throw new Error('Invalid container header');
  return header;
}

export function payloadCapacity(header: Header): number {
  return header.slotSize - NONCE_SIZE - TAG_SIZE - CHUNK_METADATA_SIZE;
}

export async function createContainer(path: string, size: number, slotSize: number, kdf: KdfParams = DEFAULT_KDF): Promise<Header> {
  if (!Number.isSafeInteger(size) || !Number.isSafeInteger(slotSize) || size < slotSize || slotSize < 1024) throw new Error('Invalid container size');
  const slotCount = Math.floor((size - HEADER_SIZE) / slotSize);
  const header: Header = { version: 1, flags: 0, slotSize, slotCount, kdf, salt: randomBytes(SALT_SIZE), id: randomBytes(24) };
  const handle = await fs.open(path, 'w');
  try {
    await handle.write(encodeHeader(header), 0, HEADER_SIZE, 0);
    const filler = randomBytes(slotSize);
    for (let index = 0; index < slotCount; index += 1) await handle.write(filler, 0, slotSize, HEADER_SIZE + index * slotSize);
  } finally { await handle.close(); }
  return header;
}

function metadata(payloadId: Buffer, chunkIndex: number, totalChunks: number, length: number, filename: string): Buffer {
  const result = Buffer.alloc(CHUNK_METADATA_SIZE);
  const filenameBytes = Buffer.from(basename(filename), 'utf8');
  if (filenameBytes.length > MAX_FILENAME_BYTES) throw new Error('Filename is too long.');
  payloadId.copy(result, 0);
  result.writeUInt32BE(chunkIndex, 16);
  result.writeUInt32BE(totalChunks, 20);
  result.writeUInt32BE(length, 24);
  result.writeUInt32BE(0x5044, 28);
  result.writeUInt16BE(filenameBytes.length, 32);
  filenameBytes.copy(result, 34);
  return result;
}

export async function addPayload(path: string, password: string, data: Buffer, filename = 'recovered-file'): Promise<void> {
  const file = await fs.readFile(path);
  const header = decodeHeader(file);
  const capacity = payloadCapacity(header);
  if (capacity <= 0) throw new Error('Slot is too small');
  const master = await deriveMasterKey(password, header.salt, header.kdf);
  const keys = deriveKeys(master);
  const payloadId = keyedBytes(keys.encryption, 'payload-id/v1', 16);
  const totalChunks = Math.max(1, Math.ceil(data.length / capacity));
  if (totalChunks > header.slotCount) throw new Error('Payload exceeds container capacity');
  const used = new Set<number>();
  const updates: Array<{ offset: number; slot: Buffer }> = [];
  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * capacity;
    const length = Math.min(capacity, Math.max(0, data.length - start));
    const plaintext = Buffer.concat([metadata(payloadId, index, totalChunks, length, filename), data.subarray(start, start + length), randomBytes(capacity - length)]);
    const encoded = encrypt(keys.encryption, plaintext);
    const slot = Buffer.concat([encoded, randomBytes(header.slotSize - encoded.length)]);
    let probe = 0;
    let slotIndex = slotFor(keys.placement, index, header.slotCount, probe);
    while (used.has(slotIndex)) { probe += 1; slotIndex = slotFor(keys.placement, index, header.slotCount, probe); }
    used.add(slotIndex);
    updates.push({ offset: HEADER_SIZE + slotIndex * header.slotSize, slot });
  }
  const handle = await fs.open(path, 'r+');
  try { for (const update of updates) await handle.write(update.slot, 0, update.slot.length, update.offset); } finally { await handle.close(); }
}

export async function extractPayload(path: string, password: string): Promise<RecoveredPayload> {
  const file = await fs.readFile(path);
  const header = decodeHeader(file);
  const master = await deriveMasterKey(password, header.salt, header.kdf);
  const keys = deriveKeys(master);
  const payloadId = keyedBytes(keys.encryption, 'payload-id/v1', 16);
  const chunks = new Map<number, Buffer>();
  let totalChunks: number | undefined;
  let filename: string | undefined;
  for (let index = 0; index < header.slotCount; index += 1) {
    const slot = file.subarray(HEADER_SIZE + index * header.slotSize, HEADER_SIZE + (index + 1) * header.slotSize);
    const plaintext = decrypt(keys.encryption, slot.subarray(0, slot.length - (header.slotSize - (NONCE_SIZE + TAG_SIZE + CHUNK_METADATA_SIZE + payloadCapacity(header)))), undefined);
    if (!plaintext || plaintext.length < CHUNK_METADATA_SIZE || !plaintext.subarray(0, 16).equals(payloadId)) continue;
    const chunkIndex = plaintext.readUInt32BE(16);
    const chunkTotal = plaintext.readUInt32BE(20);
    const length = plaintext.readUInt32BE(24);
    const filenameLength = plaintext.readUInt16BE(32);
    if (plaintext.readUInt32BE(28) !== 0x5044 || filenameLength > MAX_FILENAME_BYTES || chunkTotal < 1 || chunkTotal > header.slotCount || chunkIndex >= chunkTotal || length > payloadCapacity(header) || chunks.has(chunkIndex)) throw new Error('Unable to recover payload.');
    totalChunks = totalChunks ?? chunkTotal;
    if (totalChunks !== chunkTotal) throw new Error('Unable to recover payload.');
    const chunkFilename = plaintext.subarray(34, 34 + filenameLength).toString('utf8');
    filename = filename ?? chunkFilename;
    if (filename !== chunkFilename || !filename || basename(filename) !== filename) throw new Error('Unable to recover payload.');
    chunks.set(chunkIndex, Buffer.from(plaintext.subarray(CHUNK_METADATA_SIZE, CHUNK_METADATA_SIZE + length)));
  }
  if (totalChunks === undefined || chunks.size !== totalChunks) throw new Error('Unable to recover payload.');
  return { data: Buffer.concat(Array.from({ length: totalChunks }, (_, index) => chunks.get(index)!)), payloadId: payloadId.toString('hex'), filename: filename! };
}

export async function inspectContainer(path: string): Promise<Omit<Header, 'salt' | 'id'>> {
  const handle = await fs.open(path, 'r');
  try { const buffer = Buffer.alloc(HEADER_SIZE); await handle.read(buffer, 0, HEADER_SIZE, 0); const { salt, id, ...publicInfo } = decodeHeader(buffer); return publicInfo; } finally { await handle.close(); }
}
