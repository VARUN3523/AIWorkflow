import { mockClassifyContent } from './mock_ai.js';

/**
 * Text & Entity Classification AI Step Processor
 * Categorizes inputs into candidate classes with confidence score and reasoning.
 */
export class ClassificationStep {
  constructor() {
    this.type = 'classification';
  }

  async execute({ step, config = {}, context = {} }) {
    try {
      // Determine input content to classify:
      // 1. config.input (e.g. {{steps.step_extract.output.fields.total_amount}})
      // 2. context.trigger.document_text
      // 3. context.trigger.payload
      // 4. context.trigger
      let input = config.input;
      if (input === undefined || input === null) {
        if (context.trigger?.document_text !== undefined) {
          input = context.trigger.document_text;
        } else if (context.trigger?.payload !== undefined) {
          input = context.trigger.payload;
        } else {
          input = context.trigger;
        }
      }

      const categories = config.categories || [];
      const options = {
        fallback_category: config.fallback_category,
        simulate_timeout: config.simulate_timeout === true,
        ...config
      };

      const result = await mockClassifyContent(input, categories, options);

      return {
        status: 'success',
        outputData: {
          category: result.category,
          confidence: result.confidence,
          reasoning: result.reasoning,
          tags: result.tags || []
        }
      };
    } catch (err) {
      return {
        status: 'failed',
        error: {
          code: err.code || 'CLASSIFICATION_FAILED',
          message: err.message,
          stack: err.stack
        }
      };
    }
  }
}
