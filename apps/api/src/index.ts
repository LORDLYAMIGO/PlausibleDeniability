import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { addPayload, createContainer, extractPayload, inspectContainer } from '../../../packages/container/src/index.js';

type RequestBody = Record<string, unknown>;

async function body(request: import('node:http').IncomingMessage): Promise<RequestBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as RequestBody;
}

function send(response: import('node:http').ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

function temporaryPath(extension: string): string {
  return join(tmpdir(), `pd-${randomBytes(12).toString('hex')}${extension}`);
}

async function withTemporaryFiles<T>(work: (containerPath: string, mainPath: string, decoyPath: string) => Promise<T>, main: Buffer, decoy: Buffer): Promise<T> {
  const containerPath = temporaryPath('.pd');
  const mainPath = temporaryPath('.main');
  const decoyPath = temporaryPath('.decoy');
  try {
    await fs.writeFile(mainPath, main);
    await fs.writeFile(decoyPath, decoy);
    return await work(containerPath, mainPath, decoyPath);
  } finally {
    await Promise.all([containerPath, mainPath, decoyPath].map(path => fs.rm(path, { force: true })));
  }
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  const isLocalWebOrigin = origin && /^https?:\/\/localhost:\d+$/.test(origin);
  if (isLocalWebOrigin) {
    response.setHeader('access-control-allow-origin', origin);
    response.setHeader('vary', 'Origin');
    response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
    response.setHeader('access-control-allow-headers', 'content-type');
  }
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }
  try {
    if (request.method === 'GET' && request.url === '/api/container/info') {
      const query = new URL(request.url, 'http://localhost').searchParams;
      return send(response, 200, await inspectContainer(query.get('path') ?? ''));
    }
    const input = await body(request);
    if (request.method === 'POST' && request.url === '/api/container/create') {
      await createContainer(String(input.path), Number(input.size), Number(input.slotSize));
      return send(response, 200, { ok: true });
    }
    if (request.method === 'POST' && request.url === '/api/container/add') {
      await addPayload(String(input.path), String(input.password), await fs.readFile(String(input.input)));
      return send(response, 200, { ok: true });
    }
    if (request.method === 'POST' && request.url === '/api/container/extract') {
      const result = await extractPayload(String(input.path), String(input.password));
      await fs.writeFile(String(input.output), result.data);
      return send(response, 200, { ok: true });
    }
    if (request.method === 'POST' && request.url === '/api/container/encrypt') {
      const main = input.main as { data: string };
      const decoy = input.decoy as { data: string };
      const mainPassword = String(input.mainPassword);
      const decoyPassword = String(input.decoyPassword);
      const containerSize = Number(input.containerSize);
      const slotSize = Number(input.slotSize);
      const encoded = await withTemporaryFiles(async (containerPath, mainPath, decoyPath) => {
        await createContainer(containerPath, containerSize, slotSize);
        await addPayload(containerPath, mainPassword, Buffer.from(main.data, 'base64'));
        await addPayload(containerPath, decoyPassword, Buffer.from(decoy.data, 'base64'));
        return (await fs.readFile(containerPath)).toString('base64');
      }, Buffer.from(main.data, 'base64'), Buffer.from(decoy.data, 'base64'));
      return send(response, 200, { container: encoded });
    }
    if (request.method === 'POST' && request.url === '/api/container/recover') {
      const containerPath = temporaryPath('.pd');
      try {
        await fs.writeFile(containerPath, Buffer.from(String(input.container), 'base64'));
        const result = await extractPayload(containerPath, String(input.password));
        return send(response, 200, { data: result.data.toString('base64') });
      } finally {
        await fs.rm(containerPath, { force: true });
      }
    }
    return send(response, 404, { error: 'Not found' });
  } catch {
    return send(response, 400, { error: 'Operation failed.' });
  }
});

server.listen(Number(process.env.PD_PORT ?? 8787), '127.0.0.1', () => console.log('Plausible Deniability API listening on http://127.0.0.1:8787'));