import { createHmac } from 'node:crypto';

export function slotFor(placementKey: Buffer, chunkIndex: number, slotCount: number, probe = 0): number {
  if (!Number.isSafeInteger(slotCount) || slotCount < 1) throw new Error('Invalid slot count');
  const input = `slot:${chunkIndex}:probe:${probe}`;
  const digest = createHmac('sha256', placementKey).update(input).digest();
  return Number(digest.readBigUInt64BE(0) % BigInt(slotCount));
}

export function candidateSlots(placementKey: Buffer, chunkIndex: number, slotCount: number): number[] {
  const candidates: number[] = [];
  for (let probe = 0; candidates.length < slotCount; probe += 1) {
    const candidate = slotFor(placementKey, chunkIndex, slotCount, probe);
    if (!candidates.includes(candidate)) candidates.push(candidate);
  }
  return candidates;
}
