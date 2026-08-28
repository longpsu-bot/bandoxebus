import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const htmlUrl = new URL('../index.html', import.meta.url);
const cssUrl = new URL('../styles.css', import.meta.url);

test('POC shell markup exposes semantic generated-content and button boundaries', async () => {
  const html = await readFile(htmlUrl, 'utf8');
  assert.match(html, /<section id="story-shell"[^>]*hidden/);
  assert.match(html, /id="story-shell-steps"/);
  assert.match(html, /<button id="story-previous"[^>]*type="button"/);
  assert.match(html, /<button id="story-next"[^>]*type="button"/);
  assert.match(html, /<button id="story-explore"[^>]*type="button"[^>]*>\s*Khám phá bản đồ/);
  assert.match(html, /id="story-progress-current"/);
  assert.match(html, /id="story-progress-total"/);
  assert.doesNotMatch(html, /data-story-state-id=/);
});

test('POC CSS uses responsive capability queries and reduced motion without user agents', async () => {
  const css = await readFile(cssUrl, 'utf8');
  assert.match(css, /body\.is-story-shell/);
  assert.match(css, /@media[^\{]*(max-width|max-height|pointer)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /min-height:\s*44px/);
  assert.doesNotMatch(css, /iPhone|Android|Windows Phone/i);
});

test('story step positioning overrides follow the shared presentation renderer rules', async () => {
  const css = await readFile(cssUrl, 'utf8');
  assert.ok(
    css.lastIndexOf('.story-step__content {') > css.lastIndexOf('.presentation-content {'),
    'the shell positioning override must win over the shared renderer absolute positioning'
  );
});

test('active story mode removes the hidden legacy panel from overflow layout', async () => {
  const css = await readFile(cssUrl, 'utf8');
  assert.match(css, /body\.is-story-shell \.panel\s*\{[^}]*display:\s*none/);
});

test('Story 1.1 content has scoped responsive table, chart, image, and legend rules', async () => {
  const css = await readFile(cssUrl, 'utf8');
  for (const name of ['content-table', 'content-chart', 'content-image', 'content-legend']) assert.match(css, new RegExp(`\\.${name}`));
  assert.match(css, /\.content-table[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.content-chart[^}]*min-height/s);
  assert.match(css, /\.content-image img[^}]*max-width:\s*100%/s);
});
