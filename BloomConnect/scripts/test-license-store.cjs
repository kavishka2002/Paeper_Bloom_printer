const {buildSync} = require('esbuild');
const {spawnSync} = require('node:child_process');
const {mkdtempSync, rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');

const directory = mkdtempSync(join(tmpdir(), 'bloomconnect-dpapi-test-'));
try {
  const entry = join(directory, 'test.cjs');
  buildSync({entryPoints: ['tests/offline-license-store.ts'], bundle: true, platform: 'node', external: ['electron'], outfile: entry});
  const env = {...process.env};
  delete env.ELECTRON_RUN_AS_NODE;
  if (process.argv[2]) {
    env.BLOOMCONNECT_TEST_SIGNER = join(directory, 'website-generator.cjs');
    buildSync({entryPoints:[process.argv[2]],bundle:true,platform:'node',format:'cjs',outfile:env.BLOOMCONNECT_TEST_SIGNER});
  }
  const result = spawnSync(require('electron'), [entry], {env, stdio: 'inherit', timeout: 30_000});
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  rmSync(directory, {recursive: true, force: true});
}
