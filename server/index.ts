import { mkdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.js';
import { acquireLock, allowedHostsFrom, createApp, isLoopbackHost } from './app.js';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataRoot=path.join(workspace,'.hotori-data');mkdirSync(dataRoot,{recursive:true});
const lockPath=path.join(dataRoot,'server.lock');
// Opt-in deploy settings. Without env vars: 127.0.0.1:3100, local Host/Origin checks only, no password (unchanged local behavior).
const host=process.env.HOST||'127.0.0.1';const port=Number(process.env.PORT||3100);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT 환경 변수가 올바르지 않습니다.');
const accessPassword=process.env.HOTORI_ACCESS_PASSWORD||undefined;
if(!isLoopbackHost(host)&&!accessPassword)throw new Error(`HOST=${host}로 외부에 공개하려면 HOTORI_ACCESS_PASSWORD 환경 변수를 설정해야 합니다.`);
acquireLock(lockPath);
let store:Awaited<ReturnType<typeof openStore>>;
try{store=await openStore(path.join(dataRoot,'postgres'))}catch(error){unlinkSync(lockPath);throw error}
const app=createApp(store,{port,extraHosts:allowedHostsFrom(process.env),accessPassword,distDir:path.join(workspace,'dist')});
const server=app.listen(port,host,()=>console.log(`HOTORI ${accessPassword?'비밀번호 보호':'로컬 데모'} API http://${host}:${port} · 데이터는 .hotori-data에 저장됩니다.`));
let stopping=false;async function shutdown(){if(stopping)return;stopping=true;server.close();await store.close();try{unlinkSync(lockPath)}catch{}process.exit(0)}
process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());server.on('error',async(error)=>{console.error(error.message);await store.close();try{unlinkSync(lockPath)}catch{}process.exit(1)});
