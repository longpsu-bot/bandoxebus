import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProjectRoot } from '../scripts/serve-project-fixture.mjs';

test('fixture server swaps only authored project resources and preserves application assets', () => {
  const fixtureRoot = 'C:\\fixture'; const applicationRoot = 'C:\\application';
  assert.equal(resolveProjectRoot('/project.json', { fixtureRoot, applicationRoot }), 'C:\\fixture\\project.json');
  assert.equal(resolveProjectRoot('/stories/main.story.json', { fixtureRoot, applicationRoot }), 'C:\\fixture\\stories\\main.story.json');
  assert.equal(resolveProjectRoot('/data/schemas/story-1.1.schema.json', { fixtureRoot, applicationRoot }), 'C:\\application\\data\\schemas\\story-1.1.schema.json');
  assert.equal(resolveProjectRoot('/src/app.js', { fixtureRoot, applicationRoot }), 'C:\\application\\src\\app.js');
  assert.throws(() => resolveProjectRoot('/stories/../../src/app.js', { fixtureRoot, applicationRoot }), /unsafe/i);
});
