import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { emptySettings, normalizeSettings, type Booking } from "../shared/ledger";
import { CARD_CASES } from "../shared/roomCardCases";
import { detailedStatus } from "../shared/detailedRoomCard";
import { assignmentRoom, assignableBooking, roomWorkState } from "../shared/roomWork";
import AssignmentRoomCard from "./AssignmentRoomCard";
import RoomWorkSheet from "./RoomWorkSheet";
import type { HotelData } from "./data";

const today="2026-10-30", date="2026-10-28", base=CARD_CASES[0]!.b;
const s=normalizeSettings({types:[{id:"std",name:"스탠다드"},{id:"bath",name:"욕조"}],platforms:[{id:"walk",name:"현장",onsite:true}],floors:[{id:"f",name:"검증층",rooms:[{id:"r",no:"검증101",typeId:"std"},{id:"r2",no:"검증102",typeId:"bath"}]}]});
const booking=(p:Partial<Booking>={}):Booking=>({...base,id:"chosen",kind:"stay",status:"active",typeId:"std",platformId:"walk",roomId:"r",segments:null,checkIn:"2026-10-27",nights:4,earlyOut:null,checkedOutAt:null,arrived:true,guestName:"선택한예약손님",groupId:null,groupName:null,price:290000,nightRates:{nights:{"2026-10-27":60000,"2026-10-28":70000,"2026-10-29":80000,"2026-10-30":80000}},...p});
test("과거 카드의 이용완료는 날짜 기록만 바꾸고 현재 실제 상태와 입퇴실·수납은 보존",()=>{
 const opts={stayTimes:emptySettings().stayTimes,clock:{wallDate:today,time:"18:00"}};
 for(const b of [booking(),booking({checkedOutAt:"2026-10-29T03:00:00Z"}),booking({arrived:false}),booking({kind:"dayuse",startTime:"12:00",endTime:"16:00"})]){
  const before=JSON.stringify(b),result=detailedStatus(b,date,opts,false,today);
  assert.equal(result.label,"이용완료");assert.match(result.note!,/예약 전체의 현재 상태/);assert.equal(JSON.stringify(b),before);
 }
 assert.equal(detailedStatus(null,date,opts,false,today).label,"이용 기록 없음");
 assert.equal(detailedStatus(booking({checkedOutAt:"x"}),today,opts,false,today).label,"퇴실 완료");
});
test("배정 후보는 전체 기간의 활성 점유·마감을 검사하고 완료 기록만 있으면 보존 확인",()=>{
 const draft=booking({id:"new",roomId:null,arrived:false,checkIn:date,nights:2});
 const ended=booking({id:"ended",checkedOutAt:"2026-10-29T03:00:00Z"});
 const raw=JSON.stringify(ended);
 const free=assignmentRoom(s,[draft,ended],draft,"r");assert.equal(free.eligible,true);assert.equal(free.historical,1);assert.equal(JSON.stringify(ended),raw);
 assert.equal(assignmentRoom(s,[draft,booking({id:"active",checkIn:"2026-10-29",nights:2})],draft,"r").eligible,false,"첫 날이 비어도 다음 밤 점유를 검사");
 assert.equal(assignmentRoom(s,[draft],draft,"r2").differentType,true);
 assert.equal(assignableBooking({...draft,checkedOutAt:"done"}),false);
 assert.equal(assignableBooking({...draft,earlyOut:"2026-10-29"}),false);
});
test("입실·퇴실·중도퇴실 능력은 과거 조회일이 아니라 실제 영업일·예약 상태 기준",()=>{
 assert.equal(roomWorkState(booking(),today).earlyOut,true);
 assert.equal(roomWorkState(booking(),today).checkout,false);
 assert.equal(roomWorkState(booking({arrived:false}),today).arrive,true);
 assert.equal(roomWorkState(booking({checkIn:"2026-11-01",arrived:false}),today).arrive,false);
 const ended=roomWorkState(booking({checkedOutAt:"done"}),today);assert.equal(ended.arrive,false);assert.equal(ended.earlyOut,false);assert.equal(ended.checkout,false);
 assert.equal(roomWorkState(booking({nights:2}),today).checkout,true);
 assert.equal(roomWorkState(booking({kind:"dayuse"}),today).endDayuse,true);
});
test("배정 전용 카드는 지난 손님·요금을 노출하지 않고 실제 호실과 대상 기간만 표시",()=>{
 const b=booking({roomId:null}),html=renderToStaticMarkup(<AssignmentRoomCard roomId="r" roomNo="검증101" roomType="스탠다드" color="#2864d7" booking={b} option={assignmentRoom(s,[b],b,"r")} busy={false} onAssign={()=>{}}/>);
 assert.match(html,/검증101/);assert.match(html,/배정 가능/);assert.match(html,/4박/);assert.doesNotMatch(html,/선택한예약손님|290,000|detail-guest-name|detail-contract/);
});
const noop=()=>{};
const props={roomId:"r",bookingId:"chosen",date,today,color:"#2864d7",onClose:noop,onStay:noop,onDayuse:noop,onAssign:noop,onAssignmentMode:noop,onArrive:noop,onCheckout:noop,onEarlyOut:noop,onEndDayuse:noop,onUndoCheckout:noop,onEdit:noop,onRates:noop,onFinance:noop,onSidebar:noop};
test("빠른 업무 기록은 선택한 예약의 박별 약정·수납만 표시하고 다른 객실 이용자는 제외",()=>{
 const chosen=booking({payments:[{id:"p",bookingId:"chosen",kind:"balance",method:"cash",amount:40000,bizDate:date,createdAt:date}]}), other=booking({id:"other",guestName:"노출하면안되는예전손님",price:987654});
 const data={hotel:{settings:s},bookings:[chosen,other],groups:new Map()} as unknown as HotelData;
 const html=renderToStaticMarkup(<RoomWorkSheet {...props} data={data} initialTab="record"/>);
 assert.match(html,/선택한예약손님/);assert.match(html,/60,000원/);assert.match(html,/70,000원/);assert.match(html,/40,000원/);assert.match(html,/반복 결제 주기 미설정/);assert.doesNotMatch(html,/노출하면안되는예전손님|987,654/);
});
test("빠른 업무 전용 모달은 판매·배정·기록·상태 입구를 제공",()=>{
 const data={hotel:{settings:s},bookings:[booking()],groups:new Map()} as unknown as HotelData;
 const html=renderToStaticMarkup(<RoomWorkSheet {...props} data={data} initialTab="quick"/>);
 for(const name of ["숙박 예약·판매","대실 예약·판매","이 객실에 예약 배정","선택 예약 이용·결제 기록","객실 이용상태 변경"])assert.ok(html.includes(name));
 assert.match(html,/role="dialog"/);
});
