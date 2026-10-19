import { mockExtractEntities } from './mock_ai.js';

/**
 * Document Extraction AI Step Processor
 * Extracts clean text, structured key-value entities, and document metadata.
 */
export class DocExtractionStep {
  constructor() {
    this.type = 'doc_extraction';
  }

  async execute({ step, config = {}, context = {} }) {
    try {
      // Determine source input:
      // 1. config.source (may be an interpolated string or object)
      // 2. context.trigger.document_text
      // 3. context.trigger.payload
      // 4. context.trigger
      let source = config.source;
      if (source === undefined || source === null) {
        if (context.trigger?.document_text !== undefined) {
          source = context.trigger.document_text;
        } else if (context.trigger?.payload !== undefined) {
          source = context.trigger.payload;
        } else {
          source = context.trigger;
        }
      }

      const targetFields = config.fields || config.fieldsToExtract || [];
      const options = {
        fail_intent: config.fail_intent === true,
        ...config
      };

      const result = await mockExtractEntities(source, targetFields, options);

      const outputData = {
        text: result.text,
        fields: result.fields || {},
        char_count: result.char_count,
        metadata: result.metadata || {}
      };

      if (result.warning) {
        outputData.warning = result.warning;
      }

      return {
        status: 'success',
        outputData
      };
    } catch (err) {
      return {
        status: 'failed',
        error: {
          code: err.code || 'DOC_EXTRACTION_FAILED',
          message: err.message,
          stack: err.stack
        }
      };
    }
  }
}
