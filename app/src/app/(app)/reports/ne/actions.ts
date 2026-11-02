"use server";
import{redirect}from"next/navigation";
import{revalidatePath}from"next/cache";
import{db}from"@/lib/db";
import{requireWriter}from"@/lib/auth";
import{str,withParam}from"@/lib/action";
import{NE_BALANCE_CODES,NE_CODES,NE_MAPPING_CODES,NE_FROM,NE_NONE,NE_SCHEMES,NE_TO,isNeScheme}from"@/lib/ne";
export async function setNeMapping(fd:FormData){
 const{companyId}=await requireWriter(),account=Number(str(fd,"account")),field=str(fd,"field"),fy=str(fd,"fy");
 const back=(key:"ok"|"error",msg:string):never=>redirect(withParam(`/reports/ne${fy?`?fy=${encodeURIComponent(fy)}`:""}`,key,msg));
 if(!Number.isInteger(account)||account<1000||account>NE_TO)back("error","Kontot kan inte kopplas till NE-bilagan.");
 if(field==="default"){await db.neMapping.deleteMany({where:{companyId,account}});revalidatePath("/reports/ne");back("ok",`Konto ${account} använder standardkopplingen.`);}
 if(field!==NE_NONE&&!(NE_MAPPING_CODES as string[]).includes(field))back("error","Ogiltigt fält.");
 if(field!==NE_NONE&&account<3000&&(NE_CODES as string[]).includes(field))back("error","Balanskonton måste kopplas till B1–B16.");
 if(field!==NE_NONE&&account>=3000&&(NE_BALANCE_CODES as string[]).includes(field))back("error","Resultatkonton måste kopplas till R1–R10.");
 await db.neMapping.upsert({where:{companyId_account:{companyId,account}},create:{companyId,account,field},update:{field}});
 revalidatePath("/reports/ne");back("ok",field===NE_NONE?`Konto ${account} lämnas utanför NE-bilagan.`:`Konto ${account} räknas nu till ${field}.`);
}
export async function setNeScheme(fd:FormData){
 const{companyId}=await requireWriter(),scheme=str(fd,"scheme"),fy=str(fd,"fy"),to=`/reports/ne${fy?`?fy=${encodeURIComponent(fy)}`:""}`;
 if(!isNeScheme(scheme))redirect(withParam(to,"error","Ogiltigt val."));
 await db.company.update({where:{id:companyId},data:{neScheme:scheme}});
 revalidatePath("/reports/ne");
 redirect(withParam(to,"ok",`Kopplingen följer nu ${NE_SCHEMES[scheme].label.toLowerCase()} (${NE_SCHEMES[scheme].plan}).`));
}
