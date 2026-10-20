/* 用模拟 SDK 构建一份 WorkBuddy 版，供端到端测试：→ test/wb-dist/index.html */
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let esbuild;
try {
  esbuild = require('esbuild');
} catch (e) {
  esbuild = require(process.env.ESBUILD_PATH || '/opt/npm-tools/node_modules/esbuild');
}
const ROOT = new URL('..', import.meta.url).pathname;
const r = await esbuild.build({
  entryPoints: [ROOT + 'src/main.js'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  outdir: ROOT + 'test/wb-dist',
  loader: { '.css': 'css' },
  charset: 'utf8',
  alias: {
    '@platform': ROOT + 'src/platform-workbuddy.js',
    '@tencent-ai/workbuddy-cloud-sdk': ROOT + 'test/mock-workbuddy-sdk.js'
  }
});
let js = '';
let css = '';
for (const f of r.outputFiles) {
  if (f.path.endsWith('.js')) js = f.text.replace(/�/g, '\\uFFFD');
  else css = f.text;
}
const html = readFileSync(ROOT + 'index.html', 'utf8')
  .replace(/\s*<script type="module"[^\n]*<\/script>/, '')
  .replace('<!--INLINE_CSS-->', () => `<style>${css}</style>`)
  .replace('<!--INLINE_JS-->', () => `<script>${js.replace(/<\/script/gi, '<\\/script')}</script>`);
mkdirSync(ROOT + 'test/wb-dist', { recursive: true });
writeFileSync(ROOT + 'test/wb-dist/index.html', html);
cpSync(ROOT + 'public', ROOT + 'test/wb-dist', { recursive: true });
console.log('test/wb-dist/index.html');
