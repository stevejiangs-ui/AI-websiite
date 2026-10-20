/* claude.ai 版构建：把整个应用打成一个自包含的 HTML 文件（dist/个人APP.html）。
   用法：node build.mjs
   （WorkBuddy 版用 Vite：npm run build:wb，见 vite.config.js）
   需要 esbuild（npm i -D esbuild，或任何能 import 到 esbuild 的环境）。 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let esbuild;
try {
  esbuild = require('esbuild');
} catch (e) {
  esbuild = require(process.env.ESBUILD_PATH || '/opt/npm-tools/node_modules/esbuild');
}

const result = await esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  minify: true,
  write: false,
  outdir: 'dist',
  loader: { '.css': 'css' },
  legalComments: 'none',
  alias: { '@platform': './src/platform-claude.js' },
  charset: 'utf8'
});

let js = '';
let css = '';
for (const f of result.outputFiles) {
  /* 账单导入里有检测乱码用的 '\uFFFD'，esbuild 按 utf8 输出成了原字符，转回转义写法 */
  if (f.path.endsWith('.js')) js = f.text.replace(/\uFFFD/g, '\\uFFFD');
  else if (f.path.endsWith('.css')) css = f.text;
}

const shell = readFileSync('index.html', 'utf8');
const html = shell
  .replace(/\s*<!-- PWA[^\n]*\n(\s*<link[^\n]*\n){3}/, '\n')
  .replace(/\s*<!-- Vite[^\n]*\n\s*<script type="module"[^\n]*<\/script>/, '')
  .replace('<!--INLINE_CSS-->', () => `<style>${css}</style>`)
  .replace('<!--INLINE_JS-->', () => `<script>${js.replace(/<\/script/gi, '<\\/script')}</script>`);

mkdirSync('dist', { recursive: true });
writeFileSync('dist/个人APP.html', html);
console.log(`dist/个人APP.html  ${(html.length / 1024).toFixed(0)} KB`);

/* claude.ai 发布版：宿主会自己包 <!doctype><html><head><body>，
   这里只保留 <title>/<meta>/<style> 和页面内容 */
const head = html.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta charset[^>]*>|<meta name="viewport"[^>]*>/g, '');
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1];
writeFileSync('dist/artifact.html', head.trim() + '\n<style>body{background:#f7f6f3}</style>\n' + body.trim() + '\n');
console.log('dist/artifact.html（claude.ai 发布用）');
