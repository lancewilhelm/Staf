import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const project = fileURLToPath(new URL('../../', import.meta.url));
const directory = resolve(project, '.prototype/agent-avatars');
const read = path => readFile(resolve(project, path), 'utf8');
const font = await readFile(resolve(project, 'web/assets/dm-sans.woff2'));
const styles = (await read('web/style.css')).replace("url('./assets/dm-sans.woff2')", `url('data:font/woff2;base64,${font.toString('base64')}')`);
const script = (await read('web/prototype/avatar-art.js')).replace(/^export /gm, '') + '\n' + await read('web/prototype/agent-avatars.js');
const template = await read('web/prototype/agent-avatars.html');
const html = template.replace('/* STAF_STYLES */', styles)
  .replace('/* PROTOTYPE_STYLES */', await read('web/prototype/agent-avatars.css'))
  .replace('/* PROTOTYPE_SCRIPT */', () => script.replaceAll('</script', '<\\/script'));
await mkdir(directory, {recursive: true});
const output = resolve(directory, 'index.html');
await writeFile(output, html);
// T3's inline renderer uses a content-sized frame rather than a page viewport.
const inline = html.replace(/\b(\d+(?:\.\d+)?)d?vh\b/g, (_, number) => `${Number(number) * 8.4}px`)
  .replace(/\b(\d+(?:\.\d+)?)vw\b/g, (_, number) => `${Number(number)}%`)
  .replace('</head>', '<style>html,body,#prototype-app{background:transparent!important;margin:0;padding:0}html{font-family:var(--font-sans,system-ui);color:var(--foreground)}.shell{background:transparent}.p-bar{position:absolute}</style></head>');
await writeFile(resolve(directory, 'inline.html'), inline);
await writeFile(resolve(directory, 'DMSans-OFL.txt'), (await read('web/assets/DMSans-OFL.txt')).replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, ''));
console.log(`Agent avatar prototype: ${pathToFileURL(output).href}`);
console.log('One gallery: rounded shapes + regular polygons, with eight colors.');
console.log('Open Change image to choose a shape and color. Changes stay in memory.');
if (!process.argv.includes('--no-open')) {
  const url = pathToFileURL(output).href;
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer.exe' : 'xdg-open';
  const child = spawn(command, [url], {stdio: 'ignore', detached: true});
  child.on('error', () => console.log('Open the file URL above in your browser.'));
  child.unref();
}
