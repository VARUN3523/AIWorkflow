import { mockSynthesizeOutput } from './mock_ai.js';

/**
 * Synthesis AI Step Processor
 * Synthesizes upstream extracted data and classification into summaries, structured JSON, or action items.
 */
export class SynthesisStep {
  constructor() {
    this.type = 'synthesis';
  }

  async execute({ step, config = {}, context = {} }) {
    try {
      const template = config.template || config.synthesisPrompt || 'Executive Synthesis Summary';
      const result = await mockSynthesizeOutput(template, context, config);

      return {
        status: 'success',
        outputData: {
          summary: result.summary,
          action_items: result.action_items || [],
          synthesized_output: result.synthesized_output || {}
        }
      };
    } catch (err) {
      return {
        status: 'failed',
        error: {
          code: err.code || 'SYNTHESIS_FAILED',
          message: err.message,
          stack: err.stack
        }
      };
    }
  }
}
