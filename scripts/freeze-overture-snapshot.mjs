import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freezeProject } from './lib/freeze-project.mjs';

const OPTIONS = { project: 'projectDir', plan: 'planPath', output: 'outputDir',
  'source-archive': 'sourceArchive', 'source-sha256': 'sourceSha256' };

export function parseFreezeArgs(args) {
  const input = {};
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/.exec(argument);
    if (!match || !Object.hasOwn(OPTIONS, match[1])) throw new Error(`Unknown or malformed option: ${argument}`);
    const name = OPTIONS[match[1]];
    if (Object.hasOwn(input, name)) throw new Error(`Duplicate option: --${match[1]}`);
    if (!match[2].trim()) throw new Error(`Empty option: --${match[1]}`);
    input[name] = match[2];
  }
  for (const name of ['projectDir', 'planPath', 'outputDir']) {
    if (!Object.hasOwn(input, name)) throw new Error('Required options: --project=PATH --plan=PATH --output=PATH');
  }
  if (Object.hasOwn(input, 'sourceArchive') !== Object.hasOwn(input, 'sourceSha256')) {
    throw new Error('--source-archive and --source-sha256 are required as a pair.');
  }
  return input;
}

export async function main(args = process.argv.slice(2), { freeze = freezeProject, print = console.log } = {}) {
  print(JSON.stringify(await freeze(parseFreezeArgs(args))));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(`Freeze failed: ${error.message}`); process.exitCode = 1; });
}
