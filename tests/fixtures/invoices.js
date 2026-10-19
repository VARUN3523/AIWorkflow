/**
 * Invoice test fixtures for E2E testing
 */

export const sampleValidInvoiceText = `
INVOICE #INV-2026-9921
Date: October 15, 2026
Due Date: November 14, 2026
Vendor: ACME Global Technologies Ltd.
Vendor Tax ID: US-EIN-992817201
Client: Apex Enterprise Solutions Inc.

Line Items:
1. Enterprise Cloud Architecture Consultation - Q3: $8,500.00
2. AI Workflow Pipeline Infrastructure Deployment: $4,500.00
3. Security Hardening & Penetration Testing Audit: $1,250.00

Subtotal: $14,250.00
Tax (0% - Service Exempt): $0.00
Total Amount Due: $14,250.00
Payment Terms: Net 30
Remit to: payments@acmeglobal.com / Bank Wire Route 021000021
`;

export const expectedInvoiceExtraction = {
  invoice_number: 'INV-2026-9921',
  vendor_name: 'ACME Global Technologies Ltd.',
  total_amount: 14250.00,
  currency: 'USD',
  due_date: '2026-11-14',
  payment_terms: 'Net 30',
  line_item_count: 3
};

export const sampleSMBInvoiceText = `
INVOICE #SMB-402
Date: 2026-10-18
Vendor: QuickPrint Office Supplies
Total: $149.50
Items: 5x Premium Paper Reams ($50.00), 2x Ink Cartridges ($99.50)
`;

export const emptyInvoiceText = '';

export const whitespaceOnlyInvoiceText = '   \n\n\t   \n  ';

export const malformedInvoiceText = `
[CORRUPTED OCR STREAM]
??? ### !!! ERROR_UNREADABLE_BLOCK
%PDF-1.4 %%EOF %%%%%
`;

export const massiveInvoiceText = `
INVOICE #BULK-9999
Vendor: Massive Supply Corporation
Total: $250,000.00
` + Array.from({ length: 500 }, (_, i) => `Item ${i + 1}: Bulk Component SKU-${1000 + i} x 10 - $500.00`).join('\n');
