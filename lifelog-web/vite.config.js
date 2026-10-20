/* WorkBuddy 版构建（国内可访问的独立网站）
   npm run build:wb  →  dist/（index.html + assets/ + PWA 图标、manifest、sw.js）
   然后运行 sync.sh 同步到 web/，在 WorkBuddy 里说「发布一下」。 */
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: '.',
  base: './',
  resolve: {
    alias: {
      '@platform': fileURLToPath(new URL('./src/platform-workbuddy.js', import.meta.url))
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020'
  },
  server: {
    port: 5288,
    host: '127.0.0.1'
  }
});
