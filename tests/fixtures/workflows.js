/**
 * Workflow definitions and step configurations for E2E testing
 */

export const invoiceProcessingWorkflow = {
  name: 'Enterprise Invoice Processing Pipeline',
  description: 'Extracts invoice line items, classifies expense category, and synthesizes CFO brief',
  trigger_type: 'manual',
  trigger_config: {
    allowed_mime_types: ['application/pdf', 'text/plain', 'application/json']
  },
  steps: [
    {
      id: 'step_extract',
      name: 'Extract Invoice Entities',
      type: 'doc_extraction',
      order: 1,
      config: {
        fields: ['invoice_number', 'vendor_name', 'total_amount', 'due_date', 'line_items'],
        source: '{{trigger.document_text}}'
      }
    },
    {
      id: 'step_classify',
      name: 'Classify Expense Level',
      type: 'classification',
      order: 2,
      config: {
        input: '{{steps.step_extract.output.fields.total_amount}}',
        categories: ['Low Expense (<$500)', 'Standard Expense ($500-$5k)', 'High-Value Enterprise Expense (>$5k)'],
        fallback_category: 'Standard Expense ($500-$5k)'
      }
    },
    {
      id: 'step_synthesize',
      name: 'Synthesize CFO Approval Brief',
      type: 'synthesis',
      order: 3,
      config: {
        template: 'Prepare CFO summary for {{steps.step_extract.output.fields.vendor_name}} with category {{steps.step_classify.output.category}}',
        format: 'json'
      }
    }
  ]
};

export const webhookLeadWorkflow = {
  name: 'Inbound Lead Qualification & Routing',
  description: 'Ingests inbound webhook, scores lead size, and routes to appropriate sales pod',
  trigger_type: 'webhook',
  trigger_config: {
    webhook_token: 'whk_lead_qual_demo_secret_2026'
  },
  steps: [
    {
      id: 'step_extract_lead',
      name: 'Extract Lead Profile',
      type: 'doc_extraction',
      order: 1,
      config: {
        fields: ['company', 'title', 'employee_count', 'budget', 'timeline'],
        source: '{{trigger.payload}}'
      }
    },
    {
      id: 'step_score_lead',
      name: 'Classify Lead Priority',
      type: 'classification',
      order: 2,
      config: {
        input: '{{steps.step_extract_lead.output.fields.employee_count}}',
        categories: ['Enterprise Tier-1 (Urgent)', 'Mid-Market Growth', 'SMB / Self-Serve', 'Spam / Disqualified'],
        fallback_category: 'SMB / Self-Serve'
      }
    },
    {
      id: 'step_synthesis_brief',
      name: 'Generate SDR Outreach Action Plan',
      type: 'synthesis',
      order: 3,
      config: {
        template: 'Create executive SDR outreach plan for {{steps.step_extract_lead.output.fields.company}} with priority {{steps.step_score_lead.output.category}}',
        format: 'json'
      }
    }
  ]
};

export const invalidEmptyStepsWorkflow = {
  name: 'Invalid Workflow With Zero Steps',
  description: 'Should fail validation',
  trigger_type: 'manual',
  trigger_config: {},
  steps: []
};

export const invalidStepTypeWorkflow = {
  name: 'Invalid Step Type Workflow',
  description: 'Uses unsupported step type',
  trigger_type: 'manual',
  trigger_config: {},
  steps: [
    {
      id: 'bad_step',
      name: 'Unsupported Custom Step',
      type: 'quantum_neural_telepathy',
      order: 1,
      config: {}
    }
  ]
};

export const missingVariableRefWorkflow = {
  name: 'Missing Variable Dependency Workflow',
  description: 'References nonexistent upstream step output',
  trigger_type: 'manual',
  trigger_config: {},
  steps: [
    {
      id: 'step_1',
      name: 'Synthesize Nonexistent Step',
      type: 'synthesis',
      order: 1,
      config: {
        template: 'Summary: {{steps.non_existent_step_99.output.summary}}'
      }
    }
  ]
};
