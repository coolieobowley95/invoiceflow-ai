# InvoiceFlow AI 🧾⚡

**AI-powered invoice processing and accounts payable automation**  
Built for the H0 Hackathon — Vercel + AWS DynamoDB stack

> Upload any invoice → AI extracts all fields → auto-matched to POs → human approves or rejects → full audit trail in DynamoDB

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/YOUR_USERNAME/invoiceflow-ai)

---

## 🏗 Architecture

```
User uploads PDF/Image
        ↓
Next.js API Route (/api/upload)
        ↓
AWS DynamoDB (invoiceflow-invoices) ← status: PROCESSING
        ↓
OpenAI GPT-4o-mini (field extraction)
        ↓
PO Matching Engine (against DynamoDB invoiceflow-purchase-orders)
        ↓
DynamoDB update → MATCHED | DISCREPANCY | PENDING
        ↓
Dashboard (human review) → APPROVED | REJECTED
        ↓
DynamoDB update + audit trail
```

**AWS Database:** Amazon DynamoDB (on-demand, pay-per-request)  
**Frontend:** Next.js 14 + Tailwind, deployed on Vercel  
**AI:** OpenAI GPT-4o-mini for invoice extraction  
**Track:** B2B App (Track 2)

---

## 🚀 Quick Start

### 1. Clone and install
```bash
git clone https://github.com/YOUR_USERNAME/invoiceflow-ai
cd invoiceflow-ai
npm install
```

### 2. Set up AWS DynamoDB
In AWS Console, create two tables (or run the setup script):
- **`invoiceflow-invoices`** — Partition key: `id` (String)
- **`invoiceflow-purchase-orders`** — Partition key: `id` (String)

Both should use **Pay-per-request** billing mode.

Or run the automated setup:
```bash
cp .env.local.example .env.local
# Fill in your AWS credentials
npx ts-node src/lib/setup-tables.ts
```

### 3. Configure environment
```bash
cp .env.local.example .env.local
```
Edit `.env.local`:
```
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
DYNAMODB_TABLE_NAME=invoiceflow-invoices
DYNAMODB_PO_TABLE_NAME=invoiceflow-purchase-orders
OPENAI_API_KEY=your_openai_key
```

### 4. Run locally
```bash
npm run dev
# Open http://localhost:3000
```

### 5. Deploy to Vercel
```bash
npx vercel
# Set environment variables in Vercel dashboard
```

---

## 📁 Project Structure

```
src/
├── app/
│   ├── page.tsx              # Landing page
│   ├── upload/page.tsx       # Invoice upload flow
│   ├── dashboard/page.tsx    # AP manager dashboard
│   └── api/
│       ├── upload/route.ts   # File upload + async processing
│       ├── invoices/route.ts # List invoices
│       ├── invoices/[id]/    # Get/approve/reject single invoice
│       └── stats/route.ts    # Dashboard metrics
└── lib/
    ├── dynamodb.ts           # DynamoDB client + type definitions
    ├── ai.ts                 # OpenAI extraction + PO matching
    └── setup-tables.ts       # One-time table creation script
```

---

## 🎯 Features

- **AI Extraction** — GPT-4o-mini extracts vendor, amounts, dates, line items from any invoice format
- **PO Matching** — Automatic matching against purchase orders with configurable tolerance
- **Discrepancy Detection** — Flags amount mismatches with LOW/MEDIUM/HIGH severity
- **Human-in-the-Loop** — Approve or reject with one click, reasons recorded
- **Full Audit Trail** — Every state transition stored in DynamoDB with timestamps
- **Real-time Dashboard** — Polls every 5 seconds, live status updates
- **AWS DynamoDB** — Serverless, scales to millions of invoices globally

---

## 📊 DynamoDB Schema

### invoiceflow-invoices
| Field | Type | Description |
|-------|------|-------------|
| id | String (PK) | UUID |
| status | String | PENDING → PROCESSING → MATCHED/DISCREPANCY → APPROVED/REJECTED → PAID |
| vendorName | String | Extracted vendor name |
| invoiceNumber | String | Extracted invoice number |
| totalAmount | Number | Invoice total |
| lineItems | List | Array of line items |
| matchedPOId | String | ID of matched purchase order |
| discrepancies | List | Array of flagged discrepancies |
| aiConfidence | Number | 0-1 confidence score |
| approvedBy | String | Who approved |
| approvedAt | String | ISO timestamp |

### invoiceflow-purchase-orders  
| Field | Type | Description |
|-------|------|-------------|
| id | String (PK) | UUID |
| poNumber | String | PO reference number |
| vendorName | String | Vendor name |
| totalAmount | Number | PO total |
| lineItems | List | Expected line items |
| status | String | OPEN/PARTIALLY_INVOICED/FULLY_INVOICED/CLOSED |

---

## 🔌 Adapters for Other Hackathons

This core app is also submitted to:
- **UiPath AgentHack** — Maestro BPMN orchestrates the approval workflow
- **Qwen Cloud** — Autopilot Agent track, Qwen models replace OpenAI
- **Slack AgentHack** — Approval notifications and actions in Slack

---

## License
MIT
