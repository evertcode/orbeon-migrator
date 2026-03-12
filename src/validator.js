/**
 * validator.js - Validates generated Action Syntax XML
 */

import { EVENT_MAP } from './parser.js';

const VALID_ACTION_EVENTS = new Set(Object.values(EVENT_MAP).map(e => e.event));

export function validateMigration(parsed, generated, options = {}) {
  const useDataset = options.useDataset ?? false;
  const issues = [];

  // 1. Listener ↔ Action matching
  const listenerActionRefs = new Set();
  const actionNames = new Set();

  for (const listener of generated.listeners) {
    const match = listener.match(/actions="([^"]+)"/);
    if (match) listenerActionRefs.add(match[1]);
  }

  for (const action of parsed.actions) {
    actionNames.add(action.name);
  }

  for (const name of actionNames) {
    if (!listenerActionRefs.has(name)) {
      issues.push({
        level: 'error',
        message: `Action "${name}" has no matching fr:listener`,
        suggestion: 'Add a fr:listener element that references this action'
      });
    }
  }

  // 2. Per-action checks
  for (const action of parsed.actions) {
    if (action.triggers.length === 0) {
      issues.push({
        level: 'warning',
        message: `Action "${action.name}" has no trigger event detected`,
        suggestion: 'Verify the event type and add a listener manually if needed'
      });
    }

    // Check for unknown events
    for (const trigger of action.triggers) {
      if (trigger.unknownEvent) {
        issues.push({
          level: 'warning',
          message: `Action "${action.name}" uses unknown event "${trigger.originalEvent}"`,
          suggestion: 'Check Orbeon docs for the correct Action Syntax event name'
        });
      }

      // Validate if conditions
      if (trigger.ifCondition) {
        issues.push({
          level: 'info',
          message: `Action "${action.name}" has condition: if="${trigger.ifCondition}"`,
          suggestion: 'Verify the XPath condition works in the new Action Syntax context'
        });
      }

      // Form load without control is expected
      if (trigger.isFormLoad && trigger.controlName) {
        // Form load events shouldn't reference a control (unless it's the model)
        if (trigger.controlName !== 'fr-form-model' && !trigger.controlName.includes('model')) {
          issues.push({
            level: 'info',
            message: `Action "${action.name}" is a form-load event but references control "${trigger.controlName}"`,
            suggestion: 'Form load listeners typically don\'t need a controls attribute'
          });
        }
      }
    }

    // Check saxon:serialize
    for (const ra of action.responseActions) {
      for (const act of ra.actions) {
        if (act.type === 'set-control-value' && act.controlValue?.includes('saxon:serialize')) {
          issues.push({
            level: 'info',
            message: `Action "${action.name}" uses saxon:serialize for "${act.controlName}"`,
            suggestion: 'Verify saxon:serialize works with fr:dataset() in your Orbeon version'
          });
        }
      }
    }

    // Check service value paths
    for (const sv of action.serviceValues) {
      for (const mapping of sv.mappings) {
        if (!mapping.path.startsWith('/') && !mapping.path.startsWith('.')) {
          issues.push({
            level: 'warning',
            message: `Service value path "${mapping.path}" in "${action.name}" may need adjustment`,
            suggestion: 'Ensure the path starts with / or // for XML body mapping'
          });
        }
      }
    }

    // Check error handlers
    if (action.errorActions.length > 0) {
      issues.push({
        level: 'info',
        message: `Action "${action.name}" has error handling (xforms-submit-error)`,
        suggestion: 'Error handling in Action Syntax may need manual adjustment - verify behavior'
      });
    }
  }

  // 3. Dataset pattern present when needed (only when useDataset is enabled)
  if (useDataset && !generated.fullXml.includes('fr:dataset-write') && parsed.actions.some(a => a.responseActions.length > 0)) {
    issues.push({
      level: 'error',
      message: 'Response handling found but no fr:dataset-write generated',
      suggestion: 'Ensure the generator uses the dataset pattern'
    });
  }

  // 5. Duplicate action names
  const names = parsed.actions.map(a => a.name);
  const dupes = names.filter((n, i) => names.indexOf(n) !== i);
  if (dupes.length > 0) {
    issues.push({
      level: 'error',
      message: `Duplicate action names: ${[...new Set(dupes)].join(', ')}`,
      suggestion: 'Each action must have a unique name'
    });
  }

  return {
    valid: issues.filter(i => i.level === 'error').length === 0,
    issues
  };
}
