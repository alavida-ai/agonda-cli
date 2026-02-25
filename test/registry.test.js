import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTag,
  compareSemver,
  getAllVersions,
  getLatestVersion,
  listPrimitives,
  downloadPrimitive,
  seedCache,
  clearCache,
} from '../src/lib/registry.js';

/**
 * Fake tags matching the real alavida-ai/skills repo structure.
 */
const FAKE_TAGS = [
  { name: 'visual-explainer/v2.0.0', sha: 'aaa' },
  { name: 'visual-explainer/v1.1.0', sha: 'bbb' },
  { name: 'visual-explainer/v1.0.0', sha: 'ccc' },
  { name: 'compound-learning/v1.1.0', sha: 'ddd' },
  { name: 'compound-learning/v1.0.0', sha: 'eee' },
  { name: 'agentic-mesh/v1.0.0', sha: 'fff' },
  { name: 'buying-signals/v1.0.0', sha: 'ggg' },
];

afterEach(() => clearCache());

describe('parseTag', () => {
  it('parses standard prefixed tag', () => {
    const result = parseTag('visual-explainer/v1.0.0');
    assert.deepEqual(result, { primitive: 'visual-explainer', version: '1.0.0' });
  });

  it('parses tag with multi-segment name', () => {
    const result = parseTag('compound-learning/v1.1.0');
    assert.deepEqual(result, { primitive: 'compound-learning', version: '1.1.0' });
  });

  it('returns null for unprefixed tag', () => {
    assert.equal(parseTag('v1.0.0'), null);
  });

  it('returns null for tag without v prefix on version', () => {
    assert.equal(parseTag('foo/1.0.0'), null);
  });

  it('returns null for empty string', () => {
    assert.equal(parseTag(''), null);
  });
});

describe('compareSemver', () => {
  it('returns 0 for equal versions', () => {
    assert.equal(compareSemver('1.0.0', '1.0.0'), 0);
  });

  it('returns positive when a > b (major)', () => {
    assert.ok(compareSemver('2.0.0', '1.0.0') > 0);
  });

  it('returns negative when a < b (major)', () => {
    assert.ok(compareSemver('1.0.0', '2.0.0') < 0);
  });

  it('compares minor versions', () => {
    assert.ok(compareSemver('1.2.0', '1.1.0') > 0);
    assert.ok(compareSemver('1.0.0', '1.1.0') < 0);
  });

  it('compares patch versions', () => {
    assert.ok(compareSemver('1.0.2', '1.0.1') > 0);
    assert.ok(compareSemver('1.0.0', '1.0.1') < 0);
  });
});

describe('getAllVersions', () => {
  before(() => seedCache(FAKE_TAGS));

  it('returns versions sorted descending', () => {
    const versions = getAllVersions('visual-explainer');
    assert.deepEqual(versions, ['2.0.0', '1.1.0', '1.0.0']);
  });

  it('returns only matching primitive versions', () => {
    const versions = getAllVersions('compound-learning');
    assert.deepEqual(versions, ['1.1.0', '1.0.0']);
  });

  it('returns empty array for unknown primitive', () => {
    const versions = getAllVersions('nonexistent');
    assert.deepEqual(versions, []);
  });
});

describe('getLatestVersion', () => {
  before(() => seedCache(FAKE_TAGS));

  it('returns highest semver version', () => {
    assert.equal(getLatestVersion('visual-explainer'), '2.0.0');
  });

  it('returns single version when only one exists', () => {
    assert.equal(getLatestVersion('agentic-mesh'), '1.0.0');
  });

  it('returns null for unknown primitive', () => {
    assert.equal(getLatestVersion('nonexistent'), null);
  });
});

describe('listPrimitives', () => {
  before(() => seedCache(FAKE_TAGS));

  it('returns sorted unique primitive names', () => {
    const names = listPrimitives();
    assert.deepEqual(names, [
      'agentic-mesh',
      'buying-signals',
      'compound-learning',
      'visual-explainer',
    ]);
  });
});

describe('downloadPrimitive', () => {
  before(() => seedCache(FAKE_TAGS));

  it('throws NotFoundError for non-existent tag', () => {
    assert.throws(
      () => downloadPrimitive('visual-explainer', '9.9.9', '/tmp/test'),
      (err) => err.code === 'tag_not_found'
    );
  });

  it('throws NotFoundError for unknown primitive', () => {
    assert.throws(
      () => downloadPrimitive('nonexistent', '1.0.0', '/tmp/test'),
      (err) => err.code === 'tag_not_found'
    );
  });
});

describe('seedCache / clearCache', () => {
  it('seedCache populates cache so no API call is made', () => {
    seedCache([{ name: 'test/v1.0.0', sha: 'xxx' }]);
    const result = listPrimitives();
    assert.deepEqual(result, ['test']);
  });

  it('clearCache resets the cache', () => {
    seedCache([{ name: 'test/v1.0.0', sha: 'xxx' }]);
    clearCache();
    // After clear, next call would hit real API — we re-seed to avoid that
    seedCache(FAKE_TAGS);
    const result = listPrimitives();
    assert.ok(result.length === 4);
  });
});
