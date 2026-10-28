import { defineConfig, Plugin } from 'vite';

// dist/index.html을 서버 없이 파일로 열어도(file://) 동작하도록 한다.
// 브라우저는 file://에서 type="module" 스크립트와 crossorigin 리소스를 막으므로
// 일반 스크립트(IIFE)로 묶고, 경로는 상대 경로로 둔다.
function classicScript(): Plugin {
  return {
    name: 'classic-script',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      return html
        .replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/, '<script defer src="$1"></script>')
        .replace(/ crossorigin/g, '');
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [classicScript()],
  build: {
    modulePreload: false,
    cssCodeSplit: false,
    rollupOptions: { output: { format: 'iife' } },
  },
});
