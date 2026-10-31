import {type Booking,type HotelSettings} from './ledger';
import {nowLists,canCheckOut,type NowOpts,groupStayPeers} from './nowboard';
import {checkoutBalanceGlance} from './checkoutConfirm';
import {type GroupInfo} from './settle';
export function batchCheckoutRows(s:HotelSettings,bookings:Booking[],groups:Map<string,GroupInfo>,today:string,opts?:NowOpts){
 const lists=nowLists(bookings,today,opts);
 return [...lists.departing,...lists.lateOut].filter(b=>canCheckOut(b,today)).map(b=>{
   const members=b.groupId?groupStayPeers(bookings,b.groupId):[b];
   const glance=checkoutBalanceGlance(members.length?members:[b],s.platforms.find(p=>p.id===b.platformId),b.groupId?groups.get(b.groupId):null);
   return {b,glance,review:glance.priceUnset||(glance.tracked&&glance.left>0)};
 });
}
export type BatchCheckoutResult={done:string[];failed:{id:string;reason:string}[]};
/** 매 예약 저장 직전에 최신 상태·미수금을 재검사한다. 결제·금액·배치는 쓰지 않는다. */
export async function runBatchCheckout(ids:string[],getRows:()=>ReturnType<typeof batchCheckoutRows>,write:(id:string,patch:{checkedOutAt:string;arrived:true})=>Promise<unknown>,leaveBalance:boolean):Promise<BatchCheckoutResult>{
 const result:BatchCheckoutResult={done:[],failed:[]};
 for(const id of new Set(ids)){
  const row=getRows().find(r=>r.b.id===id);
  if(!row){result.failed.push({id,reason:'퇴실예정 대상에서 제외됐습니다. 최신 상태를 확인하세요.'});continue}
  if(row.review&&!leaveBalance){result.failed.push({id,reason:'미수금 또는 금액미정 확인이 필요합니다.'});continue}
  try{await write(id,{checkedOutAt:new Date().toISOString(),arrived:true});result.done.push(id)}catch{result.failed.push({id,reason:'저장에 실패했습니다. 다시 선택해 시도하세요.'})}
 }
 return result;
}
