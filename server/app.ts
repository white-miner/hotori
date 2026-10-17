import express, {type ErrorRequestHandler} from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DomainError } from './domain.js';
import type { Store } from './store.js';
// Deploy options are opt-in. Without extra hosts or a password this app keeps the original local-only checks.
export interface AppOptions {port?:number;extraHosts?:string[];accessPassword?:string;distDir?:string}
export const isLoopbackHost=(host:string)=>['127.0.0.1','localhost','::1'].includes(host);
// HOTORI_ALLOWED_HOSTS (comma separated host or host:port) plus Render's public hostname, lowercased and de-duplicated.
export function allowedHostsFrom(env:Record<string,string|undefined>):string[]{return [...new Set([...(env.HOTORI_ALLOWED_HOSTS??'').split(','),env.RENDER_EXTERNAL_HOSTNAME??''].map(h=>h.trim().toLowerCase()).filter(Boolean))]}
// HTTP Basic Auth with a shared password. The user name is ignored; both sides are hashed to fixed length and compared with timingSafeEqual.
export function passwordMatches(authorization:string|undefined,password:string):boolean{const match=/^Basic\s+([A-Za-z0-9+/]+={0,2})\s*$/i.exec(authorization??'');if(!match)return false;const decoded=Buffer.from(match[1],'base64').toString('utf8');const colon=decoded.indexOf(':');if(colon<0)return false;const digest=(value:string)=>createHash('sha256').update(value,'utf8').digest();return timingSafeEqual(digest(decoded.slice(colon+1)),digest(password))}
// A lock left by a dead process, by this same PID (container restart) or with unreadable content is stale and replaced.
export function acquireLock(lockPath:string):void{try{const fd=openSync(lockPath,'wx');writeFileSync(fd,String(process.pid));closeSync(fd)}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;const pid=Number(readFileSync(lockPath,'utf8').trim());let running=Number.isSafeInteger(pid)&&pid>0&&pid!==process.pid;if(running){try{process.kill(pid,0)}catch(probe){const code=(probe as NodeJS.ErrnoException).code;if(code==='ESRCH')running=false;else if(code!=='EPERM')throw probe}}if(running)throw new Error(`HOTORI 서버가 이미 실행 중입니다 (PID ${pid}). 기존 서버를 먼저 종료해 주세요.`);unlinkSync(lockPath);return acquireLock(lockPath)}}
export function createApp(store:Store,{port=3100,extraHosts=[],accessPassword,distDir}:AppOptions={}){
 const app=express();app.disable('x-powered-by');
 const allowedHosts=new Set(['127.0.0.1:3100','127.0.0.1:5173',`127.0.0.1:${port}`,...extraHosts]);const allowedOrigins=new Set(['http://127.0.0.1:3100','http://127.0.0.1:5173',`http://127.0.0.1:${port}`,...extraHosts.flatMap(h=>[`https://${h}`,`http://${h}`])]);
 app.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cross-Origin-Resource-Policy','same-origin');if(!allowedHosts.has((req.headers.host??'').toLowerCase()))return res.status(403).json({error:'허용되지 않은 로컬 호스트입니다.',code:'INVALID_HOST'});if(req.headers.origin&&!allowedOrigins.has(req.headers.origin.toLowerCase()))return res.status(403).json({error:'허용되지 않은 요청 출처입니다.',code:'INVALID_ORIGIN'});if(accessPassword&&!(req.method==='GET'&&req.path==='/api/health')&&!passwordMatches(req.headers.authorization,accessPassword)){res.setHeader('WWW-Authenticate','Basic realm="HOTORI", charset="UTF-8"');return res.status(401).json({error:'호토리 접속 비밀번호가 필요합니다.',code:'AUTH_REQUIRED'})}if(req.method!=='GET'&&req.method!=='HEAD'&&(!req.is('application/json')))return res.status(415).json({error:'JSON 요청만 허용합니다.',code:'JSON_REQUIRED'});next()});
 app.use(express.json({limit:'64kb'}));
 app.get('/api/health',(_req,res)=>res.json({ok:true,demo:true,storage:'embedded-postgresql',authentication:accessPassword?'shared-password-basic-auth':'trusted-local-demo-only'}));
 app.get('/api/state',async(req,res)=>res.json(await store.state(typeof req.query.date==='string'?req.query.date:undefined)));
 app.get('/api/reports',async(req,res)=>res.json(await store.report(String(req.query.start??''),String(req.query.end??''))));
 app.post('/api/commands',async(req,res)=>res.json(await store.command(req.body)));
 app.use('/api',(_req,res)=>res.status(404).json({error:'API 경로를 찾을 수 없습니다.',code:'NOT_FOUND'}));
 if(distDir&&existsSync(path.join(distDir,'index.html'))){app.use(express.static(distDir));app.use((req,res,next)=>req.method==='GET'?res.sendFile(path.join(distDir,'index.html')):next())}
 const errorHandler:ErrorRequestHandler=(error,_req,res,_next)=>{if(error instanceof DomainError)return void res.status(error.status).json({error:error.message,code:error.code});if(error instanceof SyntaxError)return void res.status(400).json({error:'JSON 형식이 올바르지 않습니다.',code:'INVALID_JSON'});if(error?.type==='entity.too.large')return void res.status(413).json({error:'요청 내용이 너무 큽니다.',code:'PAYLOAD_TOO_LARGE'});console.error('HOTORI 요청 처리 실패:',error instanceof Error?error.message:'unknown');res.status(500).json({error:'서버 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',code:'INTERNAL_ERROR'})};app.use(errorHandler);
 return app;
}
