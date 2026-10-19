/**
 * Variable Resolver for Workflow Pipelines
 * Interpolates expressions like {{steps.<id>.output.<field>}} and {{trigger.payload.<field>}}
 * safely with defensive property access and type preservation.
 */

/**
 * Safely resolves a dotted path on an object.
 * e.g. "steps.step_extract.output.fields.total_amount"
 */
export function resolvePath(obj, path) {
  if (obj == null || typeof obj !== 'object' || typeof path !== 'string') {
    return undefined;
  }

  const parts = path.trim().split('.');
  let current = obj;

  for (const part of parts) {
    if (current == null) {
      return undefined;
    }

    if (typeof current !== 'object') {
      return undefined;
    }

    current = current[part];
  }

  return current;
}

/**
 * Interpolates variables in a string template against context.
 * If the template is exactly a single variable expression (e.g. "{{trigger.payload}}"),
 * returns the exact resolved value (preserving object/array/number/boolean types).
 */
export function interpolateString(template, context) {
  if (typeof template !== 'string') {
    return template;
  }

  const trimmed = template.trim();
  const exactMatch = trimmed.match(/^\{\{\s*([^{}]+)\s*\}\}$/);

  // Exact single-variable match: preserve raw object/array/primitive type
  if (exactMatch) {
    const rawPath = exactMatch[1];
    const resolved = resolvePath(context, rawPath);
    return resolved !== undefined ? resolved : undefined;
  }

  // Composite string template: replace all occurrences
  return template.replace(/\{\{\s*([^{}]+)\s*\}\}/g, (match, rawPath) => {
    const resolved = resolvePath(context, rawPath);
    if (resolved === undefined || resolved === null) {
      return '';
    }
    if (typeof resolved === 'object') {
      return JSON.stringify(resolved);
    }
    return String(resolved);
  });
}

/**
 * Recursively resolves variables across arbitrary data structures
 * (strings, arrays, nested objects).
 */
export function resolveVariables(input, context) {
  if (input == null) {
    return input;
  }

  if (typeof input === 'string') {
    const interpolated = interpolateString(input, context);
    return interpolated;
  }

  if (Array.isArray(input)) {
    return input.map((item) => resolveVariables(item, context));
  }

  if (typeof input === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(input)) {
      result[key] = resolveVariables(value, context);
    }
    return result;
  }

  return input;
}
