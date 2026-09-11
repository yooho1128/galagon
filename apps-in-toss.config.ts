import { defineConfig } from '@apps-in-toss/web-framework/config';

export default defineConfig({
  // 토스 개발자센터(https://developers-apps-in-toss.toss.im)에서 앱을 등록하면 발급되는
  // 앱 이름(케밥-케이스)으로 바꿔주세요. 등록 전까지는 `ait build` / `ait deploy`가 동작하지 않아요.
  appName: 'galagon',
  brand: {
    primaryColor: '#3182F6', // 화면에 노출될 앱의 기본 색상으로 바꿔주세요.
  },
  permissions: [],
  webBundleDir: 'dist',
});
