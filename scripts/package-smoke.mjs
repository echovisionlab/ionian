import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ionian-pack-smoke-'));
const consumerDir = path.join(tmpDir, 'consumer');
const sourcePackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

try {
  execFileSync('pnpm', ['pack', '--pack-destination', tmpDir], {
    cwd: repoRoot,
    stdio: 'pipe',
  });

  const tarball = fs.readdirSync(tmpDir).find((entry) => entry.endsWith('.tgz'));
  if (!tarball) {
    throw new Error('pnpm pack did not create a tarball');
  }

  const tarballPath = path.join(tmpDir, tarball);
  const archiveEntries = execFileSync('tar', ['-tzf', tarballPath], {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  const requiredEntries = [
    'package/CHANGELOG.md',
    'package/LICENSE.md',
    'package/README.md',
    'package/THIRD_PARTY_LICENSES/',
    'package/THIRD_PARTY_NOTICES.md',
    'package/dist/',
    'package/dist/index.d.ts',
  ];
  for (const requiredEntry of requiredEntries) {
    if (!archiveEntries.some((entry) => entry === requiredEntry || entry.startsWith(requiredEntry))) {
      throw new Error(`package tarball is missing ${requiredEntry}`);
    }
  }

  const packedPackage = JSON.parse(
    execFileSync('tar', ['-xOf', tarballPath, 'package/package.json'], {
      encoding: 'utf8',
    }),
  );
  if (packedPackage.name !== sourcePackage.name || packedPackage.version !== sourcePackage.version) {
    throw new Error(`unexpected package identity: ${packedPackage.name}@${packedPackage.version}`);
  }
  if (packedPackage.license !== sourcePackage.license) {
    throw new Error(`unexpected package license: ${packedPackage.license}`);
  }

  fs.mkdirSync(consumerDir);
  fs.writeFileSync(
    path.join(consumerDir, 'package.json'),
    JSON.stringify(
      {
        name: 'ionian-package-smoke',
        private: true,
        type: 'module',
      },
      null,
      2,
    ),
  );

  execFileSync(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--silent',
      tarballPath,
      'three@0.184.0',
      'three-stdlib@2.36.1',
      'mitt@3.0.1',
      'typescript@5.8.3',
    ],
    {
      cwd: consumerDir,
      stdio: 'inherit',
    },
  );

  fs.writeFileSync(
    path.join(consumerDir, 'index.mjs'),
    `
import { ParticlesEngine, resolveSequenceInterpolation } from '@echovisionlab/ionian';

if (typeof ParticlesEngine !== 'function') {
  throw new Error('ParticlesEngine export is not a constructor');
}

const interpolation = resolveSequenceInterpolation(0.5, 3);
if (interpolation.indexA !== 1 || interpolation.indexB !== 2 || interpolation.localProgress !== 0) {
  throw new Error('resolveSequenceInterpolation returned an unexpected value');
}
`,
  );
  execFileSync('node', ['index.mjs'], { cwd: consumerDir, stdio: 'inherit' });

  fs.writeFileSync(
    path.join(consumerDir, 'index.ts'),
    `
import { resolveSequenceInterpolation, type ParticlesEngineParameters, type TextureSequence } from '@echovisionlab/ionian';

const sequence: TextureSequence = [
  { type: 'color', value: '#ffffff' },
  { type: 'matcap', id: 'warm' },
];

const params = {
  textureSize: 128,
  scene: undefined as never,
  renderer: undefined as never,
  dracoDecoderPath: '/draco/',
} satisfies ParticlesEngineParameters;

resolveSequenceInterpolation(0.5, sequence.length);
params.textureSize.toFixed();
`,
  );
  fs.writeFileSync(
    path.join(consumerDir, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ESNext',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ['index.ts'],
      },
      null,
      2,
    ),
  );
  execFileSync(path.join(consumerDir, 'node_modules/.bin/tsc'), ['--noEmit'], {
    cwd: consumerDir,
    stdio: 'inherit',
  });
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
