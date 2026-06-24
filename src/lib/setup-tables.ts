/**
 * Run this ONCE to create DynamoDB tables:
 *   npx ts-node src/lib/setup-tables.ts
 * 
 * Or use AWS Console to create:
 *   Table: invoiceflow-invoices     | PK: id (String)
 *   Table: invoiceflow-purchase-orders | PK: id (String)
 */

import {
  DynamoDBClient,
  CreateTableCommand,
  BillingMode,
} from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import { v4 as uuidv4 } from 'uuid'

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
})
const docClient = DynamoDBDocumentClient.from(client)

async function createTables() {
  console.log('Creating DynamoDB tables...')

  // Invoices table
  try {
    await client.send(new CreateTableCommand({
      TableName: 'invoiceflow-invoices',
      AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      BillingMode: BillingMode.PAY_PER_REQUEST,
    }))
    console.log('✅ Created invoiceflow-invoices table')
  } catch (e: any) {
    if (e.name === 'ResourceInUseException') {
      console.log('ℹ️  invoiceflow-invoices already exists')
    } else throw e
  }

  // Purchase Orders table
  try {
    await client.send(new CreateTableCommand({
      TableName: 'invoiceflow-purchase-orders',
      AttributeDefinitions: [{ AttributeName: 'id', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'id', KeyType: 'HASH' }],
      BillingMode: BillingMode.PAY_PER_REQUEST,
    }))
    console.log('✅ Created invoiceflow-purchase-orders table')
  } catch (e: any) {
    if (e.name === 'ResourceInUseException') {
      console.log('ℹ️  invoiceflow-purchase-orders already exists')
    } else throw e
  }

  // Seed sample Purchase Orders
  const samplePOs = [
    {
      id: uuidv4(),
      poNumber: 'PO-2026-001',
      vendorName: 'Acme Software Solutions',
      createdAt: new Date().toISOString(),
      totalAmount: 12500.00,
      currency: 'USD',
      status: 'OPEN',
      lineItems: [
        { description: 'Enterprise License Q3 2026', quantity: 1, unitPrice: 10000, total: 10000 },
        { description: 'Implementation Support (20hrs)', quantity: 20, unitPrice: 125, total: 2500 },
      ],
    },
    {
      id: uuidv4(),
      poNumber: 'PO-2026-002',
      vendorName: 'CloudHost Pro',
      createdAt: new Date().toISOString(),
      totalAmount: 3600.00,
      currency: 'USD',
      status: 'OPEN',
      lineItems: [
        { description: 'Cloud Hosting - June 2026', quantity: 1, unitPrice: 3600, total: 3600 },
      ],
    },
    {
      id: uuidv4(),
      poNumber: 'PO-2026-003',
      vendorName: 'Office Supplies Direct',
      createdAt: new Date().toISOString(),
      totalAmount: 847.50,
      currency: 'USD',
      status: 'OPEN',
      lineItems: [
        { description: 'Printer Paper (10 reams)', quantity: 10, unitPrice: 25, total: 250 },
        { description: 'Ink Cartridges', quantity: 5, unitPrice: 119.50, total: 597.50 },
      ],
    },
  ]

  for (const po of samplePOs) {
    await docClient.send(new PutCommand({
      TableName: 'invoiceflow-purchase-orders',
      Item: po,
    }))
  }
  console.log('✅ Seeded 3 sample Purchase Orders')
  console.log('\n🚀 Setup complete! Run: npm run dev')
}

createTables().catch(console.error)
