import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { addPayload, createContainer, extractPayload, inspectContainer } from '../packages/container/src/index.js';

test('round trips independent payloads', async () => {
  const path = join(tmpdir(), `pd-${Date.now()}.pd`);
  try {
    await createContainer(path, 128 * 1024, 4096);
    await addPayload(path, 'alpha', Buffer.from('first payload'));
    await addPayload(path, 'beta', Buffer.from('second payload'));
    expect((await extractPayload(path, 'alpha')).data.toString()).toBe('first payload');
    expect((await extractPayload(path, 'beta')).data.toString()).toBe('second payload');
    await expect(extractPayload(path, 'wrong')).rejects.toThrow('Unable to recover payload.');
    expect((await inspectContainer(path)).slotCount).toBeGreaterThan(1);
  } finally { await fs.rm(path, { force: true }); }
});

test('rejects tampering', async () => {
  const path = join(tmpdir(), `pd-${Date.now()}-tamper.pd`);
  try {
    await createContainer(path, 64 * 1024, 4096);
    await addPayload(path, 'secret', Buffer.from('data'));
    const bytes = await fs.readFile(path);
    for (let offset = 88; offset < bytes.length; offset += 4096) bytes[offset] ^= 1;
    await fs.writeFile(path, bytes);
    await expect(extractPayload(path, 'secret')).rejects.toThrow('Unable to recover payload.');
  } finally { await fs.rm(path, { force: true }); }
});
