import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
