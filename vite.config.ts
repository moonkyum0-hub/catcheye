import { readFileSync, existsSync } from 'node:fs';
import { defineConfig } from 'vite';

const KEY = 'certs/key.pem';
const CERT = 'certs/cert.pem';

/**
 * 인증서가 있으면 https로 띄운다. 없으면 http로 띄운다.
 *
 * localhost는 http여도 카메라를 쓸 수 있지만, 다른 기기에서 LAN IP로 접속하면
 * https가 아닌 한 브라우저가 카메라 요청을 조용히 차단한다. `npm run cert`로
 * 인증서를 만들면 그 경로가 열린다.
 */
const https =
  existsSync(KEY) && existsSync(CERT)
    ? { key: readFileSync(KEY), cert: readFileSync(CERT) }
    : undefined;

export default defineConfig({
  // GitHub Pages는 https://<user>.github.io/<repo>/ 로 서빙하므로 하위 경로가 붙는다.
  // 로컬에서는 루트다.
  base: process.env.BASE_PATH ?? '/',
  server: {
    // 다른 기기에서 접속하려면 루프백이 아니라 모든 인터페이스에 바인딩해야 한다.
    host: true,
    port: 5173,
    https,
  },
});
