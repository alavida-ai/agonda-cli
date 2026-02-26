import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listWorkbenches, getMarketplace, findWorkbench } from '../src/lib/marketplace.js';

const TMP = join(tmpdir(), `agonda-marketplace-test-${Date.now()}`);

before(() => {
  mkdirSync(join(TMP, '.git'), { recursive: true });
  mkdirSync(join(TMP, '.claude-plugin'), { recursive: true });

  writeFileSync(
    join(TMP, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'test-market',
      plugins: [
        { name: 'alpha', source: './plugins/alpha', version: '1.0.0', description: 'Alpha plugin' },
        { name: 'beta', source: './plugins/beta', version: '2.0.0', description: 'Beta plugin' },
        { name: 'gamma', source: './plugins/gamma', version: '0.1.0', description: 'Gamma plugin' },
      ],
    })
  );
});

after(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe('getMarketplace', () => {
  it('reads marketplace.json', () => {
    const mp = getMarketplace(TMP);
    assert.equal(mp.name, 'test-market');
    assert.equal(mp.plugins.length, 3);
  });
});

describe('listWorkbenches', () => {
  it('lists all workbenches', () => {
    const workbenches = listWorkbenches(TMP);
    assert.equal(workbenches.length, 3);
  });

  it('includes name, version, source', () => {
    const workbenches = listWorkbenches(TMP);
    const alpha = workbenches.find((w) => w.name === 'alpha');
    assert.equal(alpha.version, '1.0.0');
    assert.equal(alpha.source, './plugins/alpha');
    assert.equal(alpha.description, 'Alpha plugin');
  });

  it('does not include status or scope fields', () => {
    const workbenches = listWorkbenches(TMP);
    const alpha = workbenches.find((w) => w.name === 'alpha');
    assert.equal('status' in alpha, false);
    assert.equal('scope' in alpha, false);
  });
});

describe('findWorkbench', () => {
  it('finds workbench by name', () => {
    const w = findWorkbench('beta', TMP);
    assert.ok(w);
    assert.equal(w.version, '2.0.0');
  });

  it('returns null for unknown workbench', () => {
    const w = findWorkbench('nonexistent', TMP);
    assert.equal(w, null);
  });
});
