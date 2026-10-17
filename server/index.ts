import express, {type ErrorRequestHandler} from 'express';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DomainError } from './domain.js';
import { openStore } from './store.js';
const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataRoot=path.join(workspace,'.hotori-data');mkdirSync(dataRoot,{recursive:true});
const lockPath=path.join(dataRoot,'server.lock');
function acquireLock(){try {const fd=openSync(lockPath,'wx');writeFileSync(fd,String(process.pid));closeSync(fd)}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const pid=Number(readFileSync(lockPath,'utf8'));try{process.kill(pid,0)}catch(probe){if((probe as NodeJS.ErrnoException).code==='ESRCH'){unlinkSync(lockPath);return acquireLock()}throw probe}throw new Error(`HOTORI 서버가 이미 실행 중입니다 (PID ${pid}). 기존 서버를 먼저 종료해 주세요.`)}}
acquireLock();
let store:Awaited<ReturnType<typeof openStore>>;
try{store=await openStore(path.join(dataRoot,'postgres'))}catch(error){unlinkSync(lockPath);throw error}
const app=express();app.disable('x-powered-by');
const allowedHosts=new Set(['127.0.0.1:3100','127.0.0.1:5173']);const allowedOrigins=new Set(['http://127.0.0.1:3100','http://127.0.0.1:5173']);
app.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cross-Origin-Resource-Policy','same-origin');if(!allowedHosts.has(req.headers.host??''))return res.status(403).json({error:'허용되지 않은 로컬 호스트입니다.',code:'INVALID_HOST'});if(req.headers.origin&&!allowedOrigins.has(req.headers.origin))return res.status(403).json({error:'허용되지 않은 요청 출처입니다.',code:'INVALID_ORIGIN'});if(req.method!=='GET'&&req.method!=='HEAD'&&(!req.is('application/json')))return res.status(415).json({error:'JSON 요청만 허용합니다.',code:'JSON_REQUIRED'});next()});
app.use(express.json({limit:'64kb'}));
app.get('/api/health',(_req,res)=>res.json({ok:true,demo:true,storage:'embedded-postgresql',authentication:'trusted-local-demo-only'}));
app.get('/api/state',async(req,res)=>res.json(await store.state(typeof req.query.date==='string'?req.query.date:undefined)));
app.get('/api/reports',async(req,res)=>res.json(await store.report(String(req.query.start??''),String(req.query.end??''))));
app.post('/api/commands',async(req,res)=>res.json(await store.command(req.body)));
app.use('/api',(_req,res)=>res.status(404).json({error:'API 경로를 찾을 수 없습니다.',code:'NOT_FOUND'}));
const dist=path.join(workspace,'dist');if(existsSync(path.join(dist,'index.html'))){app.use(express.static(dist));app.use((req,res,next)=>req.method==='GET'?res.sendFile(path.join(dist,'index.html')):next())}
const errorHandler:ErrorRequestHandler=(error,_req,res,_next)=>{if(error instanceof DomainError)return void res.status(error.status).json({error:error.message,code:error.code});if(error instanceof SyntaxError)return void res.status(400).json({error:'JSON 형식이 올바르지 않습니다.',code:'INVALID_JSON'});if(error?.type==='entity.too.large')return void res.status(413).json({error:'요청 내용이 너무 큽니다.',code:'PAYLOAD_TOO_LARGE'});console.error('HOTORI 요청 처리 실패:',error instanceof Error?error.message:'unknown');res.status(500).json({error:'서버 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',code:'INTERNAL_ERROR'})};app.use(errorHandler);
const server=app.listen(3100,'127.0.0.1',()=>console.log('HOTORI 로컬 데모 API http://127.0.0.1:3100 · 데이터는 .hotori-data에 저장됩니다.'));
let stopping=false;async function shutdown(){if(stopping)return;stopping=true;server.close();await store.close();try{unlinkSync(lockPath)}catch{}process.exit(0)}
process.on('SIGINT',()=>void shutdown());process.on('SIGTERM',()=>void shutdown());server.on('error',async(error)=>{console.error(error.message);await store.close();try{unlinkSync(lockPath)}catch{}process.exit(1)});
