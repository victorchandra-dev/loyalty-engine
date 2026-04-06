const {spawnSync} = require('node:child_process');

const result = spawnSync(
  process.execPath,
  [
    './node_modules/eslint/bin/eslint.js',
    '--cache',
    '--cache-location',
    './node_modules/.cache/eslint',
    ...process.argv.slice(2),
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ESLINT_USE_FLAT_CONFIG: 'false',
    },
    stdio: 'inherit',
  },
);

process.exit(result.status ?? 1);
