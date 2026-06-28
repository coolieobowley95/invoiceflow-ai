export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const body = await req.text();

    const params = new URLSearchParams(body);

    const payloadString = params.get("payload");

    if (!payloadString) {
      return Response.json(
        {
          success: false,
          message: "No Slack payload received"
        },
        { status: 400 }
      );
    }

    const payload = JSON.parse(payloadString);

    const action = payload?.actions?.[0];

    if (!action) {
      return Response.json(
        {
          success: false,
          message: "No action found"
        },
        { status: 400 }
      );
    }


    console.log("Slack action received:", action.action_id);


    if (action.action_id === "approve_invoice") {

      console.log("✅ Invoice approved");


      return Response.json({
        success: true,
        message: "Invoice approved"
      });

    }


    if (action.action_id === "reject_invoice") {

      console.log("❌ Invoice rejected");


      return Response.json({
        success: true,
        message: "Invoice rejected"
      });

    }


    return Response.json({
      success: true,
      message: "Action received"
    });


  } catch (error) {

    console.error("Slack action error:", error);


    return Response.json(
      {
        success: false,
        error: error.message
      },
      { status: 500 }
    );

  }
}