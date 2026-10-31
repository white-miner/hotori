import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveStayPrice, singleNightFromPrice } from './stayPricing';
import { buildStaySaleDrafts } from './staySale';
import { normalizeSettings } from './ledger';
import { roomSlots, slotRows, unpricedMessage } from './groupRates';
const ci='2026-10-31';
test('1박 총액170000은 해당 날짜 약정170000으로 저장',()=>{
 const r=resolveStayPrice(ci,1,{mode:'total',amount:'170000'});
 assert.equal(r.price,170000);assert.deepEqual(r.rates.nights,{[ci]:170000});assert.equal(r.error,null);
});
test('균일가: 기간 변경도 모든 해당 날짜에 적용, 과거 다른 날짜 제거',()=>{
 const d={mode:'uniform' as const,amount:'70000'};
 assert.equal(resolveStayPrice(ci,3,d).price,210000);
 const r=resolveStayPrice('2026-11-01',2,d); assert.deepEqual(r.rates.nights,{'2026-11-01':70000,'2026-11-02':70000});
});
test('날짜별 다른 요금 합산과 누락 검증, 0원 서비스 날짜 보존',()=>{
 const d={mode:'daily' as const,amount:'',rates:{nights:{[ci]:60000,'2026-11-01':80000,'2026-11-02':0}}};
 assert.equal(resolveStayPrice(ci,3,d).price,140000);assert.equal(resolveStayPrice(ci,3,d).error,null);
 assert.match(resolveStayPrice(ci,4,d).error!,/모든 숙박일/);
});
test('명시적 총액 균등 배분은 마지막 날 나머지 원 포함, 합계 일치',()=>{
 const r=resolveStayPrice(ci,3,{mode:'total',amount:'200000'});
 assert.deepEqual(Object.values(r.rates.nights!),[66666,66666,66668]);assert.equal(r.price,200000);
});
test('추가 항목·시간 비용을 객실료에서 분리하고 할인도 한 번만 반영',()=>{
 const d={mode:'total' as const,amount:'170000',rates:{extras:[{name:'이불',amount:10000}]}};
 const r=resolveStayPrice(ci,1,d,20000);assert.equal(r.price,200000);assert.equal(r.rates.nights![ci],170000);
 assert.equal(resolveStayPrice(ci,1,d,-5000).price,175000);
});
test('1박만 추론: 기존 약정·0원 약정·연박은 그대로, 입력 원본 불변',()=>{
 const r={nights:{[ci]:0},extras:[{name:'이불',amount:10000}]};const before=JSON.stringify(r);
 assert.equal(singleNightFromPrice(ci,1,170000,r)!.nights![ci],0);
 assert.equal(singleNightFromPrice(ci,2,170000,null),null);
 assert.equal(singleNightFromPrice(ci,1,170000,{extras:r.extras},20000)!.nights![ci],140000);
 assert.equal(JSON.stringify(r),before);
});
const s=normalizeSettings({types:[{id:'std',name:'스탠다드'}],platforms:[{id:'walk',name:'현장',onsite:true}],floors:[{id:'f',name:'5층',rooms:[{id:'a',no:'501',typeId:'std'},{id:'b',no:'502',typeId:'std'}]}]});
test('실제 숙박 판매 저장계획: 1박 총액과 시간추가금 분리, 수납 기록 생성하지 않음',()=>{
 const result=buildStaySaleDrafts(s,{roomIds:['a'],checkIn:ci,nights:1,guestName:'검증',guestPhone:'01012345678',guests:2,price:170000,platformId:'walk',payMode:'postpaid',depAmt:'',depMethod:'card',bizDate:ci,earlyInHours:1,earlyInAmount:10000,earlyInMethod:'card'});
 assert.ok(Array.isArray(result));if(!Array.isArray(result))return;assert.equal(result[0].price,180000);assert.deepEqual(result[0].nightRates!.nights,{[ci]:170000});assert.deepEqual(result[0].payments,[]);
});
test('동일 타입2실 각각 다른 단가·추가금 유지, 부분 날짜 미입력 저장 차단',()=>{
 const slots=roomSlots(['a','b'],id=>({typeId:'std',label:id,sub:'스탠다드'}));
 const edits={ 'r:a':{pricing:{mode:'uniform' as const,amount:'60000'},extras:[{name:'이불',amount:10000,perNight:false}]},'r:b':{pricing:{mode:'total' as const,amount:'170000'}}};
 const before=JSON.stringify(edits); const rows=slotRows(s,slots,edits,ci,2);
 assert.deepEqual(rows.map(r=>r.subtotal),[130000,170000]);assert.equal(unpricedMessage(rows),null);
 const partial=slotRows(s,slots,{'r:a':{pricing:{mode:'daily',amount:'',rates:{nights:{[ci]:60000}}}}},ci,2);
 assert.ok(unpricedMessage(partial));assert.equal(JSON.stringify(edits),before);
});

test('한도 초과 금액은 묵시적으로 잘라 저장하지 않고 차단',()=>{
 assert.match(resolveStayPrice(ci,1,{mode:'total',amount:'170000000'}).error!,/이하/);
 assert.match(resolveStayPrice(ci,1,{mode:'daily',amount:'',rates:{nights:{[ci]:170000000}}}).error!,/이하/);
});

test('객실별 입력도 한도초과 오류를 저장 입구에 전달',()=>{
 const slots=roomSlots(['a'],()=>({typeId:'std',label:'501호',sub:'스탠다드'}));
 const rows=slotRows(s,slots,{'r:a':{pricing:{mode:'total',amount:'170000000'}}},ci,1);
 assert.match(unpricedMessage(rows)!,/501호.*이하/);
});
