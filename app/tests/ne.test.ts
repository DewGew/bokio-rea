import assert from"node:assert/strict";
import{test}from"node:test";
import{NE_NONE,computeNe,defaultField,type NeChoice}from"../src/lib/ne";
const accounts=new Map([
 [3001,{name:"Försäljning 25 %",vatCode:"25"}],[3004,{name:"Försäljning momsfri",vatCode:"0"}],[3305,{name:"Tjänster utanför EU",vatCode:"0"}],
 [4010,{name:"Inköp",vatCode:""}],[5410,{name:"Förbrukningsinventarier",vatCode:""}],[7010,{name:"Löner",vatCode:""}],
 [7832,{name:"Avskrivning inventarier",vatCode:""}],[8310,{name:"Ränteintäkter",vatCode:""}],[8410,{name:"Räntekostnader",vatCode:""}],[8500,{name:"Konto utan koppling",vatCode:""}]
]);
const bal=new Map<number,number>([[3001,-100_000_00],[3004,-10_000_00],[3305,-5_000_00],[4010,20_000_00],[5410,3_000_00],[7010,12_000_00],[7832,2_500_00],[8310,-250_00],[8410,400_00],[8500,1_000_00],[8999,9_999_00],[2641,7_000_00]]);
test("standardkoppling enligt BAS-schemat",()=>{
 assert.equal(defaultField(3001,"25").field,"R1");assert.equal(defaultField(3004,"0").field,"R2");assert.equal(defaultField(3305,"0").field,"R2");
 assert.equal(defaultField(4010).field,"R5");assert.equal(defaultField(6110).field,"R6");assert.equal(defaultField(7510).field,"R7");
 assert.equal(defaultField(7832).field,"R10");assert.equal(defaultField(7820).field,"R9");assert.equal(defaultField(8310).field,"R4");assert.equal(defaultField(8410).field,"R8");assert.equal(defaultField(8500).field,null);
});
test("vanligt årsbokslut hanterar intervall och räntekonton",()=>{
 assert.equal(defaultField(3740,"").field,"R1");assert.ok(defaultField(3740,"").note);assert.equal(defaultField(3105,"0").field,"R2");
 assert.equal(defaultField(3801).field,"R4");assert.equal(defaultField(7720).field,"R9");assert.equal(defaultField(7740).field,"R8");
 assert.equal(defaultField(7940).field,"R8");assert.equal(defaultField(7550).field,"R7");assert.equal(defaultField(7850).field,null);
 assert.equal(defaultField(8220,"","ej_k1",-500).field,"R4");assert.equal(defaultField(8220,"","ej_k1",500).field,"R8");
 assert.equal(defaultField(8910).field,"R8");assert.equal(defaultField(8990).field,null);
});
test("K1 använder separat kopplingstabell",()=>{
 assert.equal(defaultField(3101,"","k1").field,"R2");assert.equal(defaultField(3200,"","k1").field,"R3");
 assert.equal(defaultField(3500,"","k1").field,"R1");assert.equal(defaultField(3305,"","k1").field,null);
 assert.equal(defaultField(3700,"","k1").field,null);assert.equal(defaultField(3900,"","k1").field,null);
 assert.equal(defaultField(7700,"","k1").field,null);assert.equal(defaultField(7980,"","k1").field,null);
 assert.equal(defaultField(3200,"","ej_k1").field,"R1");assert.equal(defaultField(7820,"","k1").field,"R9");
 assert.equal(defaultField(7810,"","k1").field,"R10");assert.equal(defaultField(7832,"","k1").field,"R10");assert.equal(defaultField(8410,"","k1").field,"R8");assert.equal(defaultField(8910,"","k1").field,null);
 const r=computeNe(new Map([[3200,-100_000],[3700,-50_000],[7700,25_000]]),new Map(),new Map(),"k1");assert.equal(r.fields.R3.kr,1000);assert.equal(r.scheme,"k1");
 assert.deepEqual(r.unmapped.map(x=>x.number),[3700,7700]);assert.ok(r.unmapped.every(x=>x.note));
});
test("fält summeras och R1–R10 ger resultatet",()=>{
 const r=computeNe(bal,accounts,new Map());assert.equal(r.fields.R1.kr,100000);assert.equal(r.fields.R2.kr,15000);assert.equal(r.fields.R4.kr,250);
 assert.equal(r.fields.R5.kr,20000);assert.equal(r.fields.R6.kr,3000);assert.equal(r.fields.R7.kr,12000);assert.equal(r.fields.R8.kr,400);assert.equal(r.fields.R10.kr,2500);
 assert.equal(r.result,100000+15000+250-20000-3000-12000-400-2500);assert.deepEqual(r.unmapped.map(a=>a.number),[8500]);assert.equal(r.unmapped[0].amount,-100_000);
});
test("egna kopplingar och exkludering fungerar",()=>{
 const overrides=new Map<number,NeChoice>([[8500,"R6"],[3305,NE_NONE]]),r=computeNe(bal,accounts,overrides);
 assert.equal(r.unmapped.length,0);assert.equal(r.fields.R6.kr,4000);assert.equal(r.fields.R2.kr,10000);assert.deepEqual(r.excluded.map(a=>a.number),[3305]);
});
test("balansräkningen omfattar B1-B16 och räknar B10 som tillgångar minus skulder",()=>{
 const closing=new Map<number,number>([[1000,1_000_000],[1400,200_000],[1930,300_000],[2010,-400_000],[2350,-200_000],[2440,-100_000],[2510,-50_000]]);
 const r=computeNe(new Map(),new Map(),new Map(),"ej_k1",closing);
 assert.equal(r.balanceFields.B1.kr,10000);
 assert.equal(r.balanceFields.B6.kr,2000);
 assert.equal(r.balanceFields.B9.kr,3000);
 assert.equal(r.balanceFields.B13.kr,2000);
 assert.equal(r.balanceFields.B14.kr,500);
 assert.equal(r.balanceFields.B15.kr,1000);
 assert.equal(r.balanceAssets,15000);
 assert.equal(r.balanceEquityLiabilities,15000);
 assert.equal(r.balanceFields.B10.kr,11500);
 assert.equal(r.balanceDifference,0);
});
test("balanskonton och konton utanför schemat ingår inte i resultaträkningen",()=>{
 const r=computeNe(bal,accounts,new Map()),all=Object.values(r.fields).flatMap(f=>f.accounts.map(a=>a.number));
 assert.ok(!all.includes(2641));assert.ok(!all.includes(8999));
});
