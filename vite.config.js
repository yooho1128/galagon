import { defineConfig } from 'vite';
import aitDevtools from '@apps-in-toss/devtools/unplugin';

export default defineConfig({
  // 브라우저에서 개발할 때 앱인토스 브릿지를 mock으로 대체해줘요 (npm run dev).
  plugins: [aitDevtools.vite()],
});
