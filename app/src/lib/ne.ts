/**
 * Underlag för NE-bilagan (enskild firma): kopplar BAS-konton till R1–R10 och räknar fram R11.
 * BAS har separata kopplingstabeller för vanligt årsbokslut (ej_k1) och förenklat årsbokslut (K1).
 * Kontrollera alltid mot NE-blanketten (SKV 2161) för aktuellt inkomstår.
 */
export const NE_FIELDS = [
 {code:"R1",name:"Försäljning och utfört arbete samt övriga momspliktiga intäkter",kind:"income"},
 {code:"R2",name:"Momsfria intäkter",kind:"income"},
 {code:"R3",name:"Bil- och bostadsförmån m.m.",kind:"income"},
 {code:"R4",name:"Ränteintäkter m.m.",kind:"income"},
 {code:"R5",name:"Varor, material och tjänster",kind:"cost"},
 {code:"R6",name:"Övriga externa kostnader",kind:"cost"},
 {code:"R7",name:"Anställd personal",kind:"cost"},
 {code:"R8",name:"Räntekostnader m.m.",kind:"cost"},
 {code:"R9",name:"Avskrivningar och nedskrivningar byggnader och markanläggningar",kind:"cost"},
 {code:"R10",name:"Avskrivningar och nedskrivningar maskiner och inventarier och immateriella tillgångar",kind:"cost"},
] as const;
export type NeField=(typeof NE_FIELDS)[number]["code"];
export const NE_CODES=NE_FIELDS.map(f=>f.code) as NeField[];
export const NE_BALANCE_FIELDS = [
 {code:"B1",name:"Immateriella anläggningstillgångar",section:"Anläggningstillgångar"},
 {code:"B2",name:"Byggnader och markanläggningar",section:"Anläggningstillgångar"},
 {code:"B3",name:"Mark och andra tillgångar som inte får skrivas av",section:"Anläggningstillgångar"},
 {code:"B4",name:"Maskiner och inventarier",section:"Anläggningstillgångar"},
 {code:"B5",name:"Övriga anläggningstillgångar",section:"Anläggningstillgångar"},
 {code:"B6",name:"Varulager",section:"Omsättningstillgångar"},
 {code:"B7",name:"Kundfordringar",section:"Omsättningstillgångar"},
 {code:"B8",name:"Övriga fordringar",section:"Omsättningstillgångar"},
 {code:"B9",name:"Kassa och bank",section:"Omsättningstillgångar"},
 {code:"B10",name:"Eget kapital (tillgångar - skulder)",section:"Eget kapital"},
 {code:"B11",name:"Obeskattade reserver",section:"Obeskattade reserver"},
 {code:"B12",name:"Avsättningar",section:"Avsättningar"},
 {code:"B13",name:"Låneskulder",section:"Skulder"},
 {code:"B14",name:"Skatteskulder",section:"Skulder"},
 {code:"B15",name:"Leverantörsskulder",section:"Skulder"},
 {code:"B16",name:"Övriga skulder",section:"Skulder"},
] as const;
export type NeBalanceField=(typeof NE_BALANCE_FIELDS)[number]["code"];
export const NE_BALANCE_CODES=NE_BALANCE_FIELDS.map(f=>f.code) as NeBalanceField[];
export const NE_MAPPING_CODES=[...NE_CODES,...NE_BALANCE_CODES] as (NeField|NeBalanceField)[];
export const NE_NONE="none";
export type NeChoice=NeField|NeBalanceField|typeof NE_NONE;
export type NeScheme="ej_k1"|"k1";
export const NE_SCHEMES:Record<NeScheme,{label:string;plan:string;description:string}>={
 ej_k1:{label:"Vanligt årsbokslut",plan:"BAS 2026",description:"För enskilda näringsidkare som inte upprättar förenklat årsbokslut. Kontona kopplas efter kontointervall."},
 k1:{label:"Förenklat årsbokslut (K1)",plan:"BAS 2018 för K1",description:"För enskilda näringsidkare som upprättar förenklat årsbokslut enligt K1. Kontona kopplas efter K1-kontoplanens rubrikkonton."}
};
export const isNeScheme=(s:string):s is NeScheme=>s==="ej_k1"||s==="k1";
const kindOf=(f:NeField)=>NE_FIELDS.find(x=>x.code===f)!.kind;
export const NE_FROM=3000,NE_TO=8989,NE_BALANCE_FROM=1000;
export type DefaultMapping={field:NeField|null;note?:string};
const R1_R2="Konton som finns under både R1 och R2 kopplas efter vad som bokförts på kontot: R2 om intäkten är momsfri.";
const R4_ONLY=new Set([801,811,820,821,825,826,830,831,834,836,839,844]);
const R4_OR_R8=new Set([802,803,812,813,822,823,824,829,832,833,835,843,845,849,881,886,888,889]);
const R8_ONLY=new Set([807,808,817,818,827,828,837,838,840,841,842,846,848]);
function ejK1(a:number,vat:string,balance:number):DefaultMapping{
 const g2=Math.floor(a/100),g3=Math.floor(a/10);
 if((g2>=30&&g2<=37)||g2===39){if(vat==="0")return{field:"R2"};return vat?{field:"R1"}:{field:"R1",note:R1_R2};}
 if(g2===38)return{field:"R4",note:"Enligt BAS kopplingstabell hör 38xx till R4."};
 if(g2>=40&&g2<=49)return{field:"R5"};
 if(g2>=50&&g2<=69)return{field:"R6"};
 if(g2>=70&&g2<=76)return{field:"R7"};
 switch(g3){
  case 771:case 773:case 776:case 778:case 781:case 783:return{field:"R10"};
  case 772:case 777:case 782:case 784:return{field:"R9"};
  case 774:case 779:return{field:"R8"};
  case 885:return{field:null,note:"BAS anger R9 eller R10 beroende på vilken tillgång nedskrivningen avser. Välj fält manuellt."};
 }
 if(g2===79)return{field:"R8"};
 if(R4_ONLY.has(g3))return{field:"R4"};
 if(R8_ONLY.has(g3)||(g3>=890&&g3<=898))return{field:"R8"};
 if(R4_OR_R8.has(g3))return{field:balance<0?"R4":"R8",note:"Intäkt går till R4 och kostnad till R8."};
 return{field:null};
}
function k1(a:number,vat:string):DefaultMapping{
 if(a>=3000&&a<=3099)return{field:vat==="0"?"R2":"R1"};
 if(a>=3100&&a<=3199)return{field:"R2"};
 if(a===3200)return{field:"R3",note:"I K1-schemat är 3200 Bil- och bostadsförmån m.m."};
 if(a===3500)return{field:"R1"};
 if(a>=3700&&a<=3799)return{field:null,note:"BAS K1 anger att 37xx kan höra till R1 eller R2. Klassificera utifrån vad som faktiskt bokförts."};
 if(a===3970||a===3980)return{field:"R2"};
 if(a>=3900&&a<=3999)return{field:null,note:"BAS K1 anger att 39xx kan höra till R1 eller R2. Klassificera utifrån vad som faktiskt bokförts."};
 if(a>=4000&&a<=4999)return{field:"R5"};
 if(a>=5000&&a<=6999)return{field:"R6"};
 if(a>=7000&&a<=7699)return{field:"R7"};
 if(a>=7700&&a<=7799)return{field:null,note:"BAS K1 anger R9 eller R10 beroende på vilken tillgång nedskrivningen avser. Välj fält manuellt."};
 if(a>=7810&&a<=7819)return{field:"R10"};
 if(a>=7820&&a<=7829)return{field:"R9"};
 if(a>=7830&&a<=7839)return{field:"R10"};
 if(a>=7980&&a<=7989)return{field:null,note:"BAS K1 anger R9 eller R10 beroende på vilken tillgång ersättningsfonden avser. Välj fält manuellt."};
 if(a===8310||a===8330)return{field:"R4"};
 if(a>=8400&&a<=8499)return{field:"R8"};
 return{field:null};
}
const inRange=(a:number,lo:number,hi:number)=>a>=lo&&a<=hi;
function defaultBalanceField(a:number,scheme:NeScheme,balance=0):NeBalanceField|null{
 // Nettomoms på 1650/2650 placeras efter saldots riktning: fordran i B8, skuld i B14.
 if(a===1650||a===2650)return balance<0?"B14":"B8";
 if(scheme==="k1"){
  if(a===1000)return "B1";
  if(a===1110||a===1150)return "B2";
  if(a===1130||a===1180)return "B3";
  if(a===1220||a===1230||a===1240||a===1291)return "B4";
  if(a===1300)return "B5";
  if(a===1400)return "B6";
  if(a===1500)return "B7";
  if(a===1600||a===1700)return "B8";
  if([1910,1920,1930,1940,1970].includes(a))return "B9";
  if(inRange(a,2010,2010)||inRange(a,2020,2040))return "B10";
  if([2330,2350,2390].includes(a))return "B13";
  if(inRange(a,2510,2539))return "B14";
  if(a===2440)return "B15";
  if(a===2900)return "B16";
  return null;
 }
 if(inRange(a,1000,1099))return "B1";
 if(inRange(a,1100,1129)||inRange(a,1150,1179)||inRange(a,1190,1199))return "B2";
 if(inRange(a,1130,1149)||inRange(a,1180,1189))return "B3";
 if((inRange(a,1200,1290)&&a!==1291)||inRange(a,1292,1299))return "B4";
 if(inRange(a,1300,1399))return "B5";
 if(inRange(a,1400,1499))return "B6";
 if(inRange(a,1500,1599))return "B7";
 if(inRange(a,1600,1899))return "B8";
 if(inRange(a,1900,1999))return "B9";
 if(inRange(a,2010,2019)||inRange(a,2050,2059))return "B10";
 if(inRange(a,2100,2199))return "B11";
 if(inRange(a,2200,2299))return "B12";
 if(inRange(a,2300,2399))return "B13";
 if(inRange(a,2510,2539))return "B14";
 if(inRange(a,2440,2449)||inRange(a,2460,2479))return "B15";
 if(inRange(a,2420,2439)||inRange(a,2450,2509)||inRange(a,2540,2599)||inRange(a,2600,2999))return "B16";
 return null;
}
export function defaultField(account:number,vatCode="",scheme:NeScheme="ej_k1",balance=0):DefaultMapping{return scheme==="k1"?k1(account,vatCode):ejK1(account,vatCode,balance);}
export type NeAccountRow={number:number;name:string;amount:number;field:NeField|NeBalanceField|null;source:"default"|"override"|"none";note?:string};
export type NeResult={
 scheme:NeScheme;
 fields:Record<NeField,{kr:number;accounts:NeAccountRow[]}>;
 balanceFields:Record<NeBalanceField,{kr:number;accounts:NeAccountRow[]}>;
 unmapped:NeAccountRow[];
 excluded:NeAccountRow[];
 balanceUnmapped:NeAccountRow[];
 balanceExcluded:NeAccountRow[];
 result:number;
 booked:number;
 balanceAssets:number;
 balanceEquityLiabilities:number;
 balanceDifference:number;
};
export function computeNe(bal:Map<number,number>,accounts:Map<number,{name:string;vatCode:string}>,overrides:Map<number,NeChoice>,scheme:NeScheme="ej_k1",closing:Map<number,number>=new Map()):NeResult{
 const fields=Object.fromEntries(NE_CODES.map(c=>[c,{kr:0,accounts:[] as NeAccountRow[]}])) as NeResult["fields"];
 const balanceFields=Object.fromEntries(NE_BALANCE_CODES.map(c=>[c,{kr:0,accounts:[] as NeAccountRow[]}])) as NeResult["balanceFields"];
 const unmapped:NeAccountRow[]=[],excluded:NeAccountRow[]=[],balanceUnmapped:NeAccountRow[]=[],balanceExcluded:NeAccountRow[]=[];
 let bookedOre=0;
 for(const[number,balance]of[...bal].sort((x,y)=>x[0]-y[0])){
  if(number<NE_FROM||number>NE_TO||balance===0)continue;
  bookedOre+=-balance;const info=accounts.get(number),name=info?.name??`Konto ${number}`,override=overrides.get(number);
  if(override===NE_NONE){excluded.push({number,name,amount:-balance,field:null,source:"none"});continue;}
  const d:DefaultMapping=override&&NE_CODES.includes(override as NeField)?{field:override as NeField}:defaultField(number,info?.vatCode??"",scheme,balance);
  if(!d.field){unmapped.push({number,name,amount:-balance,field:null,source:"default",note:d.note});continue;}
  const amount=kindOf(d.field)==="income"?-balance:balance;
  fields[d.field].accounts.push({number,name,amount,field:d.field,source:override?"override":"default",note:d.note});
 }
 for(const[number,balance]of[...closing].sort((x,y)=>x[0]-y[0])){
  if(number<NE_BALANCE_FROM||number>=NE_FROM||balance===0)continue;
  const info=accounts.get(number),name=info?.name??`Konto ${number}`,override=overrides.get(number);
  if(override===NE_NONE){balanceExcluded.push({number,name,amount:balance,field:null,source:"none"});continue;}
  const mapped=override&&NE_BALANCE_CODES.includes(override as NeBalanceField)?override as NeBalanceField:defaultBalanceField(number,scheme,balance);
  if(!mapped){balanceUnmapped.push({number,name,amount:balance,field:null,source:"default",note:"Kontot saknar automatisk koppling till B1–B16. Kontrollera kontots innehåll och koppla det manuellt om det ska ingå."});continue;}
  const amount=Number(mapped.slice(1))<=9?balance:-balance;
  balanceFields[mapped].accounts.push({number,name,amount,field:mapped,source:override?"override":"default",note:number===1650||number===2650?"Momssaldo: fordran redovisas i B8 och skuld i B14 beroende på saldots riktning.":mapped==="B10"?"Kontoraden är en specifikation. B10-beloppet beräknas som tillgångar minus skulder enligt blanketten.":undefined});
 }
 for(const c of NE_CODES)fields[c].kr=Math.round(fields[c].accounts.reduce((s,a)=>s+a.amount,0)/100);
 for(const c of NE_BALANCE_CODES)balanceFields[c].kr=Math.round(balanceFields[c].accounts.reduce((s,a)=>s+a.amount,0)/100);
 const k=(c:NeField)=>fields[c].kr;
 const result=k("R1")+k("R2")+k("R3")+k("R4")-k("R5")-k("R6")-k("R7")-k("R8")-k("R9")-k("R10");
 const balanceAssets=NE_BALANCE_CODES.slice(0,9).reduce((sum,c)=>sum+balanceFields[c].kr,0);
 const otherEquityLiabilities=NE_BALANCE_CODES.slice(10).reduce((sum,c)=>sum+balanceFields[c].kr,0);
 balanceFields.B10.kr=balanceAssets-otherEquityLiabilities;
 const balanceEquityLiabilities=balanceFields.B10.kr+otherEquityLiabilities;
 return{scheme,fields,balanceFields,unmapped,excluded,balanceUnmapped,balanceExcluded,result,booked:Math.round(bookedOre/100),balanceAssets,balanceEquityLiabilities,balanceDifference:balanceAssets-balanceEquityLiabilities};
}
