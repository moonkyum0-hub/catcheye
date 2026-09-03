import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import selfsigned from 'selfsigned';

const DIR = 'certs';
const KEY = `${DIR}/key.pem`;
const CERT = `${DIR}/cert.pem`;

if (existsSync(KEY) && existsSync(CERT)) {
  console.log('인증서가 이미 있습니다. 다시 만들려면 certs/ 를 지우세요.');
  process.exit(0);
}

/** 이 기기의 LAN IPv4 주소들. 인증서에 넣어야 다른 기기가 그 주소로 접속할 수 있다. */
function lanAddresses() {
  const found = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) found.push(address.address);
    }
  }
  return found;
}

const ips = ['127.0.0.1', ...lanAddresses()];
// type 2 = DNS 이름, type 7 = IP 주소. 브라우저는 접속한 주소가 SAN에 없으면
// 인증서를 아예 거부하므로 LAN IP를 반드시 넣어야 한다.
const altNames = [
  { type: 2, value: 'localhost' },
  ...ips.map((ip) => ({ type: 7, ip })),
];

// selfsigned 5.x의 generate는 async다. await를 빼면 빈 객체를 받는다.
const pems = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
  days: 365,
  keySize: 2048,
  algorithm: 'sha256',
  extensions: [{ name: 'subjectAltName', altNames }],
});

await mkdir(DIR, { recursive: true });
await writeFile(KEY, pems.private);
await writeFile(CERT, pems.cert);

console.log(`인증서를 만들었습니다: ${CERT}`);
console.log(`이 주소들에서 쓸 수 있습니다: localhost, ${ips.join(', ')}`);
console.log('자체 서명이라 브라우저가 경고를 띄웁니다. 한 번 통과시키면 됩니다.');
