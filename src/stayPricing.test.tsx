import {test} from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import StayPriceEditor from './StayPriceEditor';
const ci='2026-10-31';
test('1박 입력은 총액 단일 필드와 해당 날짜 저장 안내, 렌더는 요금·결제 불변',()=>{
 const rates={nights:{[ci]:170000}},payments=[{amount:170000,method:'card'}];const before=JSON.stringify([rates,payments]);
 const html=renderToStaticMarkup(<StayPriceEditor checkIn={ci} nights={1} rates={rates} price={170000} onChange={()=>{throw Error('렌더 쓰기 금지')}}/>);
 assert.match(html,/해당 숙박일의 요금으로 함께 저장/);assert.match(html,/aria-label="객실료 총액"/);assert.equal((html.match(/<input /g)||[]).length,1);assert.equal(JSON.stringify([rates,payments]),before);
});
test('연박 입력 방식3개, 날짜별 모드는 요일과 금액표 한 곳만 표시',()=>{
 const html=renderToStaticMarkup(<StayPriceEditor checkIn={ci} nights={2} rates={{nights:{[ci]:60000,'2026-11-01':80000}}} price={140000} onChange={()=>{}}/>);
 assert.equal((html.match(/role="tab"/g)||[]).length,3);assert.match(html,/10\/31\(토\)/);assert.match(html,/11\/1\(일\)/);assert.doesNotMatch(html,/박당 금액으로 채우기|판매금도 박별 합계로/);
});

import NowRoomCard from './NowRoomCard';
import {emptySettings}from'../shared/ledger';
import{mk}from'../shared/roomCardCases';
import{roomCardModel}from'../shared/roomCard';
import{detailedStatus}from'../shared/detailedRoomCard';
import{resolveStayPrice}from'../shared/stayPricing';
test('저장 요금은 실제 객실 카드의 해당 날짜17만원으로 표시, 미등록 없음',()=>{
 const r=resolveStayPrice(ci,1,{mode:'total',amount:'170000'}),s=emptySettings();
 const b=mk({checkIn:ci,nights:1,price:r.price,nightRates:r.rates,platformId:'walk',roomId:'r',guestName:'1박 검증'});
 const platform={id:'walk',name:'현장',abbr:'현',onsite:true};
 const html=renderToStaticMarkup(<NowRoomCard roomNo="501" roomType="스탠다드" color="#14653a" booking={b} platform={platform} settings={s} model={roomCardModel({b,plat:platform,bookings:[b],info:null,view:ci,today:ci})} status={detailedStatus(b,ci,{stayTimes:s.stayTimes,clock:{wallDate:ci,time:'17:00'}})} group={null} showGroup onDetail={()=>{}} onQuick={()=>{}} onMemo={()=>{}} memoCount={0}/>);
 assert.match(html,/10\/31\(토\).*170,000/s);assert.doesNotMatch(html,/요금 미등록/);
});
