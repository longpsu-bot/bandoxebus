import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const htmlUrl = new URL('../index.html', import.meta.url);
const cssUrl = new URL('../styles.css', import.meta.url);

test('neutral production shell exposes generic map, composition, navigation, controls, and status hosts', async () => {
  const html = await readFile(htmlUrl, 'utf8');
  for (const id of ['map', 'scene-compositor', 'runtime-navigation', 'capability-controls', 'runtime-status']) {
    assert.match(html, new RegExp(`id=["']${id}["']`), id);
  }
  assert.match(html, /<script type="module" src="\.\/src\/app\.js"/);
  assert.doesNotMatch(html, /61-2|Existing|Proposed|Difference|simulation|industrial/i);
});

test('neutral shell CSS keeps 16:9 composition, contained images, touch targets, responsiveness, and reduced motion', async () => {
  const css = await readFile(cssUrl, 'utf8');
  assert.match(css, /#scene-compositor[^}]*aspect-ratio:\s*16\s*\/\s*9/s);
  assert.match(css, /\.scene-overlay img[^}]*object-fit:\s*contain/s);
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media[^\{]*max-width/);
  assert.match(css, /prefers-reduced-motion/);
  assert.doesNotMatch(css, /iPhone|Android|Windows Phone/i);
});

test('legacy semantic content keeps scoped table, chart, image, and legend layout rules', async () => {
  const css = await readFile(cssUrl, 'utf8');
  for (const name of [
    'presentation-content__title', 'presentation-content__subtitle', 'presentation-content__narrative',
    'presentation-metrics', 'presentation-metric', 'presentation-callout',
    'content-table', 'content-chart', 'content-image', 'content-legend'
  ]) assert.match(css, new RegExp(`\\.${name}`));
  assert.match(css, /\*\s*\{[^}]*box-sizing:\s*border-box/s);
  assert.match(css, /#scene-compositor\.presentation-content[^}]*aspect-ratio:\s*auto/s);
  assert.match(css, /#scene-compositor\.presentation-content[^}]*overflow:\s*auto/s);
  assert.match(css, /\.presentation-content__title[^}]*font-size:\s*(?:clamp\(|[2-9][0-9]px)/s);
  assert.match(css, /\.presentation-content__narrative[^}]*line-height:\s*1\.[4-9]/s);
  assert.match(css, /\.presentation-metrics[^}]*grid-template-columns/s);
  assert.match(css, /\.presentation-metric[^}]*min-height/s);
  assert.match(css, /\.content-table[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.content-chart[^}]*min-height/s);
  assert.match(css, /\.content-image img[^}]*max-width:\s*100%/s);
  assert.match(css, /@media[^\{]*max-width:\s*600px[\s\S]*#scene-compositor\.presentation-content[^}]*width:\s*calc\(100vw\s*-\s*28px\)/s);
});
