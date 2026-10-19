import { DocExtractionStep } from '../steps/doc_extraction.js';
import { ClassificationStep } from '../steps/classification.js';
import { SynthesisStep } from '../steps/synthesis.js';

/**
 * Step Registry for AI and transformation processors
 */
export class StepRegistry {
  constructor() {
    this.steps = new Map();
    this.register('doc_extraction', new DocExtractionStep());
    this.register('classification', new ClassificationStep());
    this.register('synthesis', new SynthesisStep());
  }

  register(type, processor) {
    if (!type || typeof type !== 'string') {
      throw new Error('Step processor type must be a non-empty string');
    }
    this.steps.set(type, processor);
  }

  getStep(type) {
    return this.steps.get(type);
  }

  hasStep(type) {
    return this.steps.has(type);
  }

  listStepTypes() {
    return Array.from(this.steps.keys());
  }
}

export const stepRegistry = new StepRegistry();
