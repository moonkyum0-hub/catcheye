// Deno Deploy의 기본 진입점.
//
// 플랫폼은 설정이 없으면 루트의 main.ts를 찾는다. 실제 서버는 server/deno.ts에
// 있고, 이 파일은 그것을 불러오기만 한다. 진입점을 UI에서 지정하지 않아도
// 배포가 되게 하려는 것이다.
import './server/deno.ts';
