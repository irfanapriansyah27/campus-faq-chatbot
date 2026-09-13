import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const run = promisify(execFile);
const root = new URL('../', import.meta.url);
// Use an installed Chromium browser; no package or browser download is required.
const browser = process.env.CHAT_LAYOUT_BROWSER || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((candidate) => existsSync(candidate));

test('long chat URLs stay inside bubbles and the viewport', {
  skip: browser ? false : 'Set CHAT_LAYOUT_BROWSER to an installed Chromium executable.',
  timeout: 60_000
}, async (t) => {
  const [html, css, app] = await Promise.all([
    readFile(new URL('public/index.html', root), 'utf8'),
    readFile(new URL('public/styles.css', root), 'utf8'),
    readFile(new URL('public/app.js', root), 'utf8')
  ]);
  const content = `Informasi ujian:\nhttps://example.invalid/${'a'.repeat(1400)}?info=jadwal\nSelesai.`;
  const fixture = html
    .replace('<link rel="stylesheet" href="/styles.css">', `<style>${css}</style>`)
    .replace('<script src="/app.js" defer></script>', `<script>${app}</script>
      <script>
        messages.replaceChildren();
        for (const role of ['bot', 'user']) addMessage(${JSON.stringify(content)}, role);
      </script>`);
  // Iframes provide exact CSS viewport widths, including 320px, even when the
  // browser's top-level window has a larger minimum size.
  const harness = `<!doctype html><html><body><pre id="result"></pre><script>
    const results = [];
    for (const width of [1280, 320]) {
      const frame = document.createElement('iframe');
      frame.style.cssText = 'border:0;width:' + width + 'px;height:900px';
      frame.onload = () => {
        const doc = frame.contentDocument;
        const win = frame.contentWindow;
        const bubbles = [...doc.querySelectorAll('.message')].map((element) => {
          const rect = element.getBoundingClientRect();
          const range = doc.createRange();
          range.selectNodeContents(element);
          const lines = [...range.getClientRects()];
          return {
            role: element.className,
            text: element.textContent,
            overflow: element.scrollWidth - element.clientWidth,
            textInside: lines.every((line) => line.left >= rect.left - 1 && line.right <= rect.right + 1),
            lineCount: lines.length,
            whiteSpace: win.getComputedStyle(element).whiteSpace
          };
        });
        results.push({
          width,
          viewport: win.innerWidth,
          pageOverflow: doc.documentElement.scrollWidth - doc.documentElement.clientWidth,
          containers: ['.page-shell', '.chat', '#messages'].map((selector) => {
            const element = doc.querySelector(selector);
            return { selector, overflow: element.scrollWidth - element.clientWidth };
          }),
          bubbles
        });
        if (results.length === 2) document.querySelector('#result').textContent = JSON.stringify(results);
      };
      frame.srcdoc = ${JSON.stringify(fixture).replaceAll('<', '\\u003c')};
      document.body.append(frame);
    }
  </script></body></html>`;
  const temporary = await mkdtemp(path.join(tmpdir(), 'campus-chat-layout-'));
  t.after(() => rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
  const filename = path.join(temporary, 'layout.html');
  await writeFile(filename, harness);
  const { stdout } = await run(browser, [
    '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    `--user-data-dir=${path.join(temporary, 'profile')}`,
    '--dump-dom', '--timeout=15000', pathToFileURL(filename).href
  ], { timeout: 45_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  const match = stdout.match(/<pre id="result">([^<]+)<\/pre>/);
  assert.ok(match, 'Browser must finish measuring both viewport fixtures.');
  const results = JSON.parse(match[1].replaceAll('&amp;', '&').replaceAll('&gt;', '>').replaceAll('&lt;', '<'));
  assert.equal(results.length, 2);
  for (const result of results.sort((left, right) => right.width - left.width)) {
    await t.test(`${result.width}px: bot and user URLs wrap without horizontal overflow`, () => {
      assert.equal(result.viewport, result.width);
      assert.equal(result.bubbles.length, 2);
      assert.ok(result.pageOverflow <= 1, `page overflows by ${result.pageOverflow}px`);
      for (const container of result.containers) {
        assert.ok(container.overflow <= 1, `${container.selector} overflows by ${container.overflow}px`);
      }
      for (const bubble of result.bubbles) {
        assert.equal(bubble.text, content, 'URL text and newlines must remain unchanged.');
        assert.equal(bubble.whiteSpace, 'pre-wrap');
        assert.ok(bubble.overflow <= 1, `${bubble.role} overflows by ${bubble.overflow}px`);
        assert.ok(bubble.textInside, `${bubble.role} text extends outside the bubble.`);
        assert.ok(bubble.lineCount > 3, 'Long URL must wrap onto additional lines.');
      }
    });
  }
});
