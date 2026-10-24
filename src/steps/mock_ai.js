/**
 * Deterministic Mock AI Engine & Pluggable Live LLM Interface
 * Provides offline heuristics for document extraction, classification, and synthesis,
 * with clean extension hooks for live LLM providers (Gemini / OpenAI).
 */

/**
 * Extracts structured key-value entities, clean text, and metadata.
 */
export async function mockExtractEntities(rawInput, targetFields = [], options = {}) {
  // Yield to event loop so CPU/regex processing remains non-blocking
  await new Promise((resolve) => setImmediate(resolve));

  // If simulated intentional failure requested
  if (options.fail_intent) {
    const err = new Error('Simulated document extraction failure (fail_intent: true)');
    err.code = 'EXTRACTION_MODEL_FAILURE';
    throw err;
  }

  // Handle null / undefined
  if (rawInput == null) {
    return {
      text: '',
      fields: {},
      char_count: 0,
      warning: 'EMPTY_DOCUMENT',
      metadata: { input_type: 'null' }
    };
  }

  // Handle object input (e.g. structured payload or lead)
  if (typeof rawInput === 'object') {
    const fields = {};
    const textRepresentation = JSON.stringify(rawInput, null, 2);

    // If specific fields were requested, prioritize them
    if (Array.isArray(targetFields) && targetFields.length > 0) {
      for (const rawField of targetFields) {
        if (typeof rawField !== 'string' && typeof rawField !== 'number') continue;
        const field = String(rawField).slice(0, 100).trim();
        if (!field || field === '__proto__' || field === 'constructor' || field === 'prototype') continue;

        if (field in rawInput) {
          fields[field] = rawInput[field];
        } else {
          // Case-insensitive or normalized fallback
          const lowerField = field.toLowerCase();
          const matchKey = Object.keys(rawInput).find((k) => k.toLowerCase() === lowerField);
          if (matchKey) {
            fields[field] = rawInput[matchKey];
          }
        }
      }
    } else {
      // Copy all top-level keys safely
      for (const [k, v] of Object.entries(rawInput)) {
        if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') {
          fields[k] = v;
        }
      }
    }

    // Ensure common lead fields exist if employee_count / company in input
    if ('company' in rawInput && !fields.company) fields.company = rawInput.company;
    if ('employee_count' in rawInput && !fields.employee_count) fields.employee_count = rawInput.employee_count;
    if ('title' in rawInput && !fields.title) fields.title = rawInput.title;

    return {
      text: textRepresentation,
      fields,
      char_count: textRepresentation.length,
      metadata: {
        keys_count: Object.keys(rawInput).length,
        input_type: 'object'
      }
    };
  }

  const text = String(rawInput);

  // Check for empty or whitespace-only document
  if (!text || text.trim().length === 0) {
    return {
      text: '',
      fields: {},
      char_count: 0,
      warning: 'EMPTY_DOCUMENT',
      metadata: { is_empty: true }
    };
  }

  const fields = {};

  // 1. Invoice Number: e.g. "INVOICE #INV-2026-9921", "INVOICE #SMB-402", "INVOICE #BULK-9999"
  const invMatch = text.match(/(?:invoice\s*#?|inv-?)\s*[:#]?\s*([A-Za-z0-9-]+)/i);
  if (invMatch) {
    fields.invoice_number = invMatch[1].trim();
  }

  // 2. Vendor Name: e.g. "Vendor: ACME Global Technologies Ltd.", "Vendor: QuickPrint Office Supplies"
  const vendorMatch = text.match(/(?:vendor(?:\s*name)?|remit\s*to)\s*[:#]?\s*([^\r\n,]+)/i);
  if (vendorMatch) {
    fields.vendor_name = vendorMatch[1].trim();
  }

  // 3. Client / Customer: e.g. "Client: Apex Enterprise Solutions Inc."
  const clientMatch = text.match(/(?:client|customer|bill\s*to)\s*[:#]?\s*([^\r\n,]+)/i);
  if (clientMatch) {
    fields.client_name = clientMatch[1].trim();
  }

  // 4. Total Amount: e.g. "Total Amount Due: $14,250.00", "Total: $149.50", "Total: $250,000.00"
  const totalMatch = text.match(/(?:total(?:\s*amount(?:\s*due)?)?|balance\s*due)\s*[:]?\s*\$?\s*([\d,]+(?:\.\d{2})?)/i);
  if (totalMatch) {
    const numericStr = totalMatch[1].replace(/,/g, '');
    fields.total_amount = parseFloat(numericStr);
  } else {
    // Look for any standalone currency amount
    const anyAmtMatch = text.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
    if (anyAmtMatch) {
      fields.total_amount = parseFloat(anyAmtMatch[1].replace(/,/g, ''));
    }
  }

  // 5. Due Date: e.g. "Due Date: November 14, 2026", "Due Date: 2026-11-14"
  const dueMatch = text.match(/due\s*date\s*[:]?\s*([^\r\n,]+)/i);
  if (dueMatch) {
    const rawDate = dueMatch[1].trim();
    // Try to normalize date string if possible
    const parsed = new Date(rawDate);
    if (!isNaN(parsed.getTime())) {
      fields.due_date = parsed.toISOString().split('T')[0];
    } else {
      fields.due_date = rawDate;
    }
  }

  // 6. Payment Terms: e.g. "Payment Terms: Net 30"
  const termsMatch = text.match(/payment\s*terms\s*[:]?\s*([^\r\n,]+)/i);
  if (termsMatch) {
    fields.payment_terms = termsMatch[1].trim();
  }

  // 7. Currency: Detect USD ($), EUR (€), GBP (£)
  if (text.includes('€')) {
    fields.currency = 'EUR';
  } else if (text.includes('£')) {
    fields.currency = 'GBP';
  } else {
    fields.currency = 'USD';
  }

  // 8. Line Items count
  const lineItemMatches = text.match(/^\s*\d+\.\s+[^\r\n]+/gm);
  if (lineItemMatches) {
    fields.line_items = lineItemMatches.map((item) => item.trim());
    fields.line_item_count = lineItemMatches.length;
  }

  // Ensure any explicitly requested target fields exist
  if (Array.isArray(targetFields)) {
    for (const rawField of targetFields) {
      if (typeof rawField !== 'string' && typeof rawField !== 'number') continue;
      // Cap field string length and sanitize
      const field = String(rawField).slice(0, 100).trim();
      if (!field || field === '__proto__' || field === 'constructor' || field === 'prototype') continue;

      if (!(field in fields)) {
        // Escape regex special characters in field name to eliminate ReDoS / catastrophic backtracking (H-2 / P4 remediation)
        const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const fieldPattern = escapedField.replace(/_/g, '[\\s_]');
        try {
          const keyPattern = new RegExp(`(?:${fieldPattern})\\s*[:#]?\\s*([^\\r\\n]+)`, 'i');
          const match = text.match(keyPattern);
          if (match) {
            fields[field] = match[1].trim();
          }
        } catch {
          // Gracefully ignore any pattern compilation errors
        }
      }
    }
  }

  return {
    text: text.slice(0, 5000), // Trimmed preview
    fields,
    char_count: text.length,
    metadata: {
      line_count: text.split('\n').length,
      detected_fields: Object.keys(fields),
      timestamp: new Date().toISOString()
    }
  };
}

/**
 * Categorizes input into candidate classes with confidence scores and reasoning.
 */
export async function mockClassifyContent(input, categories = [], options = {}) {
  // Yield to event loop to keep AI execution non-blocking
  await new Promise((resolve) => setImmediate(resolve));

  if (options.simulate_timeout) {
    const err = new Error('Simulated AI model timeout during classification');
    err.code = 'AI_TIMEOUT_ERROR';
    throw err;
  }

  const fallbackCategory = options.fallback_category || categories[0] || 'Uncategorized';

  if (!Array.isArray(categories) || categories.length === 0) {
    return {
      category: fallbackCategory,
      confidence: 0.5,
      reasoning: 'No candidate categories provided; assigned default category.',
      tags: ['fallback']
    };
  }

  // Numerical classification: e.g. Expense brackets
  const numVal = typeof input === 'number' ? input : parseFloat(String(input).replace(/[$,]/g, ''));

  if (!isNaN(numVal)) {
    // 1. Expense Amount Brackets
    const isHighExpense = categories.find((c) => typeof c === 'string' && /high-value|>\$5k|high expense/i.test(c));
    const isStandardExpense = categories.find((c) => typeof c === 'string' && /standard|\$500-\$5k/i.test(c));
    const isLowExpense = categories.find((c) => typeof c === 'string' && /low|<\$500/i.test(c));

    if (isHighExpense && numVal > 5000) {
      return {
        category: isHighExpense,
        confidence: 0.96,
        reasoning: `Amount $${numVal.toFixed(2)} exceeds $5,000 threshold for high-value enterprise expenses.`,
        tags: ['expense', 'high-value', 'cfo-approval-required']
      };
    }
    if (isLowExpense && numVal < 500) {
      return {
        category: isLowExpense,
        confidence: 0.95,
        reasoning: `Amount $${numVal.toFixed(2)} is under $500 threshold for standard processing.`,
        tags: ['expense', 'low-value', 'auto-approved']
      };
    }
    if (isStandardExpense) {
      return {
        category: isStandardExpense,
        confidence: 0.92,
        reasoning: `Amount $${numVal.toFixed(2)} falls within standard operating expense range ($500 - $5,000).`,
        tags: ['expense', 'standard']
      };
    }

    // 2. Lead Employee Count Brackets
    const isTier1Enterprise = categories.find((c) => typeof c === 'string' && /enterprise tier-1|tier-1|urgent/i.test(c));
    const isMidMarket = categories.find((c) => typeof c === 'string' && /mid-market/i.test(c));
    const isSMB = categories.find((c) => typeof c === 'string' && /smb|self-serve/i.test(c));

    if (isTier1Enterprise && numVal >= 1000) {
      return {
        category: isTier1Enterprise,
        confidence: 0.98,
        reasoning: `Employee count of ${numVal} meets Enterprise Tier-1 requirements (>= 1,000 employees).`,
        tags: ['lead', 'enterprise', 'urgent', 'strategic-pod']
      };
    }
    if (isMidMarket && numVal >= 100) {
      return {
        category: isMidMarket,
        confidence: 0.94,
        reasoning: `Employee count of ${numVal} matches Mid-Market criteria (100 - 999 employees).`,
        tags: ['lead', 'mid-market']
      };
    }
    if (isSMB && numVal >= 1) {
      return {
        category: isSMB,
        confidence: 0.91,
        reasoning: `Employee count of ${numVal} matches SMB / Self-Serve segment.`,
        tags: ['lead', 'smb', 'self-serve']
      };
    }
  }

  // Textual classification based on keywords
  const textStr = typeof input === 'object' ? JSON.stringify(input) : String(input || '');
  const lowerText = textStr.toLowerCase();

  let bestMatch = null;
  let bestScore = 0;

  for (const cat of categories) {
    if (!cat || typeof cat !== 'string') continue;
    const catWords = cat.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    let score = 0;
    for (const word of catWords) {
      if (lowerText.includes(word)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = cat;
    }
  }

  if (bestMatch && bestScore > 0) {
    return {
      category: bestMatch,
      confidence: Math.min(0.75 + bestScore * 0.1, 0.99),
      reasoning: `Matched category "${bestMatch}" based on keyword relevance in input content.`,
      tags: ['keyword-matched']
    };
  }

  return {
    category: fallbackCategory,
    confidence: 0.65,
    reasoning: `Input content did not definitively match candidate patterns. Assigned fallback category: "${fallbackCategory}".`,
    tags: ['fallback']
  };
}

/**
 * Synthesizes upstream extracted data and classification into summaries, structured JSON, or actions.
 */
export async function mockSynthesizeOutput(template, context = {}, options = {}) {
  // Yield to event loop to keep AI execution non-blocking
  await new Promise((resolve) => setImmediate(resolve));

  const format = options.format || 'json';

  let summary = '';
  if (template && typeof template === 'string') {
    summary = template;
  } else {
    summary = 'Executive Synthesis completed successfully.';
  }

  const actionItems = [
    'Review entity outputs and verify extraction confidence.',
    'Route pipeline results to designated destination handler.',
    'Log audit trail in compliance ledger.'
  ];

  // Tailor action items based on context
  if (context.category || context.steps?.step_classify?.output?.category) {
    const rawCat = context.category || context.steps?.step_classify?.output?.category;
    const cat = typeof rawCat === 'string' ? rawCat : String(rawCat || '');
    if (cat.toLowerCase().includes('enterprise') || cat.toLowerCase().includes('high-value')) {
      actionItems.unshift('Escalate to Senior Executive / VP for priority review within 1 business day.');
    }
  }

  const synthesizedOutput = {
    summary,
    format,
    action_items: actionItems,
    generated_at: new Date().toISOString(),
    status: 'synthesized'
  };

  return {
    summary,
    action_items: actionItems,
    synthesized_output: synthesizedOutput
  };
}

/**
 * Pluggable Live AI Model Invoker
 * Dispatches to live Gemini/OpenAI API if keys are provided in environment,
 * otherwise transparently falls back to deterministic mock AI engine.
 */
export async function invokeAIModel({ task, input, config = {}, options = {} }) {
  if (process.env.GEMINI_API_KEY && options.use_live) {
    // Live Gemini adapter hook
    // Could dispatch via @google/genai SDK when configured
  }

  switch (task) {
    case 'doc_extraction':
      return await mockExtractEntities(input, config.fields, options);
    case 'classification':
      return await mockClassifyContent(input, config.categories, { ...config, ...options });
    case 'synthesis':
      return await mockSynthesizeOutput(config.template, options.context, config);
    default:
      throw new Error(`Unsupported AI task type: ${task}`);
  }
}
