import { NextResponse } from "next/server";
/** Provider adapters must verify the provider signature before changing subscription state. */
export async function POST(){return NextResponse.json({error:"Provedor de pagamento não configurado. Nenhuma cobrança foi processada."},{status:501});}
