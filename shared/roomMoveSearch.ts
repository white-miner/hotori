import { addDays, allRooms, boardMove, boardMoveTargets, boardMoveWindow, freeRooms, holdNightsOf, isEarlyOut, occupiesRoom, placementOf, proposeRoomSwap, roomOnNight, usedNights, type Booking, type HotelSettings, type Placement, type RoomSwapPlan } from './ledger';

export function moveSourceKey(b: Booking): string {
  return JSON.stringify([b.id,b.kind,b.status,b.checkIn,b.nights,b.earlyOut,b.checkedOutAt,b.openEnded,b.holdAhead,placementOf(b)]);
}
export function roomMoveRange(b: Booking): {min:string;max:string} | null {
  if(b.kind!=='stay'||!occupiesRoom(b)||isEarlyOut(b)||!b.roomId||!(b.nights&&b.nights>0))return null;
  return {min:b.checkIn,max:addDays(b.checkIn,(usedNights(b)??b.nights)-1)};
}
function protectedFree(s: HotelSettings, bookings: Booking[], b: Booking, night: string) {
  const w=boardMoveWindow(b,night);
  return freeRooms(s,bookings,{id:b.id,kind:'stay',checkIn:w.checkIn,nights:w.nights+holdNightsOf(b),startTime:null,endTime:null});
}
export type RoomMovePlan = {kind:'move';booking:Booking;before:Placement;after:Placement} | {kind:'swap';booking:Booking;swap:RoomSwapPlan} | {kind:'blocked';reason:string};
/** 검색 목록과 저장 직전의 동일한 검증. 배치만 반환하고 요금·결제는 변경하지 않는다. */
export function planRoomMove(s:HotelSettings,bookings:Booking[],id:string,night:string,to:string,expectedKey?:string):RoomMovePlan {
  const b=bookings.find(x=>x.id===id);
  if(!b)return {kind:'blocked',reason:'예약이 없어졌습니다. 다시 확인해 주세요.'};
  if(expectedKey&&moveSourceKey(b)!==expectedKey)return {kind:'blocked',reason:'예약의 일정·객실·이용 상태가 변경됐습니다. 다시 선택해 주세요.'};
  const range=roomMoveRange(b);
  if(!range)return {kind:'blocked',reason:'객실이 배정된 이용 중·입실 예정 숙박만 이동할 수 있습니다.'};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(night)||night<range.min||night>range.max||Number.isNaN(Date.parse(night))||new Date(night+'T00:00:00Z').toISOString().slice(0,10)!==night)return {kind:'blocked',reason:'이동일은 예약의 숙박일 안에서 선택하세요.'};
  if(!allRooms(s).some(r=>r.id===to))return {kind:'blocked',reason:'존재하지 않는 객실입니다.'};
  if(roomOnNight(b,night)===to)return {kind:'blocked',reason:'해당 이동일에 사용 중인 출발 객실입니다.'};
  const free=boardMoveTargets(s,bookings,b,night);
  if(free.has(to)&&protectedFree(s,bookings,b,night).has(to))return {kind:'move',booking:b,before:placementOf(b),after:boardMove(b,night,to)};
  if(night===b.checkIn){
    const swap=proposeRoomSwap(bookings,b,to,night);
    if(swap){
      const next=bookings.map(x=>x.id===swap.a.id?{...x,...swap.aPlace}:x.id===swap.b.id?{...x,...swap.bPlace}:x);
      if(protectedFree(s,next,{...swap.a,...swap.aPlace},swap.a.checkIn).has(to)&&protectedFree(s,next,{...swap.b,...swap.bPlace},swap.b.checkIn).has(swap.fromRoomId))return {kind:'swap',booking:b,swap};
    }
  }
  return {kind:'blocked',reason:night===b.checkIn?'이동 기간에 점유·객실 마감이 있거나 전체 맞교환 조건을 충족하지 않습니다.':'선택일부터 퇴실까지 점유·객실 마감이 있습니다. 맞교환은 숙박 전체에서 선택하세요.'};
}

/** 기존 순차 맞교환 저장. 실패하면 B를 먼저 원위치로 돌려 A의 출발 객실을 비운다. */
export async function executeRoomSwap(write:(id:string,p:Placement)=>Promise<unknown>,plan:RoomSwapPlan):Promise<void>{
 const aBefore=placementOf(plan.a),bBefore=placementOf(plan.b);
 try{await write(plan.a.id,{roomId:null,segments:null});await write(plan.b.id,plan.bPlace);await write(plan.a.id,plan.aPlace)}catch(original){
   const failures:unknown[]=[];
   // 응답만 실패하고 A 이동은 반영된 경우에도 B의 원래 객실을 먼저 비운다.
   try{await write(plan.a.id,{roomId:null,segments:null})}catch(e){failures.push(e)}
   try{await write(plan.b.id,bBefore)}catch(e){failures.push(e)}
   try{await write(plan.a.id,aBefore)}catch(e){failures.push(e)}
   if(failures.length){const error=new Error('맞교환 저장과 일부 객실 배치 복구에 실패했습니다. 두 예약의 객실 배치를 확인해 주세요.');error.name='RoomSwapRecoveryError';throw error}
   throw original;
 }
}
