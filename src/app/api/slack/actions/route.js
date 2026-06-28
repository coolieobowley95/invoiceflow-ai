import slack from "@/lib/slack";

export async function POST(req) {

  const body = await req.text();

  const params = new URLSearchParams(body);
  const payload = JSON.parse(params.get("payload"));

  const action = payload.actions[0].action_id;

  if(action === "approve_invoice") {

    console.log("✅ Invoice approved");

  }

  if(action === "reject_invoice") {

    console.log("❌ Invoice rejected");

  }

  return new Response(
    JSON.stringify({
      text: "InvoiceFlow processed successfully"
    }),
    {
      status: 200,
      headers:{
        "Content-Type":"application/json"
      }
    }
  );

}