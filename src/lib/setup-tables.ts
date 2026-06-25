import { createClient } from "@supabase/supabase-js"
import { v4 as uuid } from "uuid"


const supabase = createClient(
process.env.NEXT_PUBLIC_SUPABASE_URL!,
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)


async function seed(){

console.log("Adding sample purchase orders...")


const orders = [

{
id:uuid(),
poNumber:"PO-2026-001",
vendorName:"Acme Software Solutions",
createdAt:new Date().toISOString(),
totalAmount:12500,
currency:"USD",
status:"OPEN",
lineItems:[
{
description:"Enterprise License",
quantity:1,
unitPrice:10000,
total:10000
}
]
},


{
id:uuid(),
poNumber:"PO-2026-002",
vendorName:"CloudHost Pro",
createdAt:new Date().toISOString(),
totalAmount:3600,
currency:"USD",
status:"OPEN",
lineItems:[
{
description:"Cloud Hosting",
quantity:1,
unitPrice:3600,
total:3600
}
]
}

]


const {error}=await supabase
.from("purchase_orders")
.insert(orders)


if(error){

console.error(error)

return

}


console.log("Seed complete")

}


seed()