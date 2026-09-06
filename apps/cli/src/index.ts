#!/usr/bin/env node
import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import { createContainer, addPayload, extractPayload, inspectContainer } from '../../../packages/container/src/index.js';

const program = new Command().name('pd').description('Plausible Deniability encrypted container');
function passwordFromEnv(name?: string): string { const password = name ? process.env[name] : process.env.PD_PASSWORD; if (!password) throw new Error('Set PD_PASSWORD or use --password-env.'); return password; }
function parseSize(value: string): number { const match = /^(\d+)([KMG]?)$/i.exec(value); if (!match) throw new Error('Size must look like 512M or 1G.'); const unit = ({ '': 1, K: 1024, M: 1024 ** 2, G: 1024 ** 3 } as Record<string, number>)[match[2].toUpperCase()]; return Number(match[1]) * unit; }

program.command('create').argument('<path>').option('--size <size>', 'container size', '64M').option('--slot-size <size>', 'slot size', '1M').action(async (path, options) => { await createContainer(path, parseSize(options.size), parseSize(options.slotSize)); console.log(`Created ${path}`); });
program.command('add').argument('<container>').argument('<input>').option('--password-env <name>').action(async (container, input, options) => { await addPayload(container, passwordFromEnv(options.passwordEnv), await fs.readFile(input)); console.log('Payload added.'); });
program.command('extract').argument('<container>').argument('<output>').option('--password-env <name>').action(async (container, output, options) => { const result = await extractPayload(container, passwordFromEnv(options.passwordEnv)); await fs.writeFile(output, result.data); console.log('Payload recovered.'); });
program.command('inspect').argument('<container>').action(async container => console.log(await inspectContainer(container)));
program.parseAsync().catch(error => { console.error(error instanceof Error ? error.message : 'Operation failed.'); process.exitCode = 1; });
