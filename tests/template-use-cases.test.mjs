import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { resolveProjectRoot } from '../scripts/serve-project-fixture.mjs';

test('fixture server swaps only authored project resources and preserves application assets', () => {
  const fixtureRoot = path.resolve('fixture'); const applicationRoot = path.resolve('application');
  assert.equal(resolveProjectRoot('/project.json', { fixtureRoot, applicationRoot }), path.join(fixtureRoot, 'project.json'));
  assert.equal(resolveProjectRoot('/stories/main.story.json', { fixtureRoot, applicationRoot }), path.join(fixtureRoot, 'stories', 'main.story.json'));
  assert.equal(resolveProjectRoot('/data/schemas/story-1.1.schema.json', { fixtureRoot, applicationRoot }), path.join(applicationRoot, 'data', 'schemas', 'story-1.1.schema.json'));
  assert.equal(resolveProjectRoot('/src/app.js', { fixtureRoot, applicationRoot }), path.join(applicationRoot, 'src', 'app.js'));
  assert.throws(() => resolveProjectRoot('/stories/../../src/app.js', { fixtureRoot, applicationRoot }), /unsafe/i);
});
