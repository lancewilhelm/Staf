import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

function render(text) {
  return execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e',
    "import {renderMarkdown} from './web/markdown.ts'; console.log(renderMarkdown(JSON.parse(process.argv[1])))", JSON.stringify(text)],
  {cwd: new URL('..', import.meta.url), encoding: 'utf8'});
}

test('response Markdown retains formatting, safe links, and copyable code', () => {
  const html = render('# Heading\n\n**bold** and *italic*\n\n[Source](https://example.com)\n\n```js\nconst value = "<safe>";\n```');
  assert.match(html, /<h1>Heading<\/h1>/);
  assert.match(html, /<strong>bold<\/strong> and <em>italic<\/em>/);
  assert.match(html, /href="https:\/\/example.com" target="_blank" rel="noopener noreferrer"/);
  assert.match(html, /class="code-block"><button class="quiet" type="button">Copy<\/button><pre><code class="language-js">/);
  assert.match(html, /const value = "&#x3C;safe>";/);
});

test('response Markdown excludes raw HTML and executable URLs', () => {
  const html = render('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert%281%29)\n\n![bad](data:text/html,attack)');
  assert.doesNotMatch(html, /<script|onerror|javascript:|data:text\/html|src="x"/);
  assert.match(html, />bad<\/a>/);
});
