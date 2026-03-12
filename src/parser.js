/**
 * parser.js - Parses Orbeon Forms XML and extracts Simple Action bindings
 *
 * Supported trigger events:
 *   Control events:  DOMActivate, xforms-value-changed, xforms-enabled,
 *                    xforms-disabled, xforms-visible, xforms-hidden,
 *                    xforms-select, xforms-deselect
 *   Form load:       xforms-ready, xforms-model-construct-done,
 *                    fr-form-load-before-data, fr-form-load-after-data,
 *                    fr-form-load-after-controls
 *
 * Also extracts if="..." conditions from trigger blocks.
 */

// ─── Helpers ─────────────────────────────────────────────────

function toArray(val) {
  if (val == null) return [];
  return Array.isArray(val) ? val : [val];
}

function extractActionName(bindingId) {
  return bindingId?.replace(/-binding$/, '') || 'unknown-action';
}

function extractServiceName(submissionId) {
  return submissionId?.replace(/-submission$/, '') || 'unknown-service';
}

// ─── Event Mapping ───────────────────────────────────────────

/**
 * Maps old XForms / Orbeon events to Action Syntax event names.
 */
const EVENT_MAP = {
  // Control events
  'DOMActivate':                { event: 'activated',       isFormLoad: false },
  'xforms-value-changed':       { event: 'value-changed',   isFormLoad: false },
  'xforms-enabled':             { event: 'enabled',         isFormLoad: false },
  'xforms-disabled':            { event: 'disabled',        isFormLoad: false },
  'xforms-visible':             { event: 'visible',         isFormLoad: false },
  'xforms-hidden':              { event: 'hidden',          isFormLoad: false },
  'xforms-select':              { event: 'item-selected',   isFormLoad: false },
  'xforms-deselect':            { event: 'item-deselected', isFormLoad: false },
  // Form load events
  'xforms-ready':               { event: 'form-load-after-data',     isFormLoad: true },
  'xforms-model-construct-done':{ event: 'form-load-after-data',     isFormLoad: true },
  'fr-form-load-before-data':   { event: 'form-load-before-data',    isFormLoad: true },
  'fr-form-load-after-data':    { event: 'form-load-after-data',     isFormLoad: true },
  'fr-form-load-after-controls':{ event: 'form-load-after-controls', isFormLoad: true },
};

/**
 * Resolve an old event name to the new Action Syntax event name
 */
function resolveEvent(oldEvent) {
  const parts = oldEvent.trim().split(/\s+/);
  const mapped = parts.map(p => EVENT_MAP[p]).filter(Boolean);

  if (mapped.length === 0) {
    return { events: [oldEvent], isFormLoad: false, unknown: true };
  }

  const events = [...new Set(mapped.map(m => m.event))];
  const isFormLoad = mapped.some(m => m.isFormLoad);
  return { events, isFormLoad, unknown: false };
}

// ─── Parse Event Handlers ────────────────────────────────────

function parseEventHandler(actionBlock) {
  const event = actionBlock['@_event'] || actionBlock['@_ev:event'] || '';
  const observer = actionBlock['@_ev:observer'] || actionBlock['@_observer'] || '';
  const ifCondition = actionBlock['@_if'] || null;

  const result = {
    event,
    observer,
    ifCondition,
    type: 'unknown',
    data: {}
  };

  const resolved = resolveEvent(event);

  // --- Trigger events that call a service (have xf:send) ---
  const sends = findElements(actionBlock, 'xf:send');
  if (sends.length > 0 && !event.startsWith('xforms-submit')) {
    result.type = 'trigger';
    const submissionRef = sends[0]['@_submission'] || '';
    result.data.submission = submissionRef;
    result.data.serviceName = extractServiceName(submissionRef);
    result.data.controlName = observer.replace(/-control$/, '');
    result.data.originalEvent = event;
    result.data.resolvedEvents = resolved.events;
    result.data.isFormLoad = resolved.isFormLoad;
    result.data.unknownEvent = resolved.unknown || false;
    result.data.ifCondition = cleanIfCondition(ifCondition);
    return result;
  }

  // --- xforms-submit: set service values before sending ---
  if (event === 'xforms-submit') {
    result.type = 'set-service-values';
    result.data.serviceName = extractServiceName(observer);
    result.data.mappings = [];

    const nestedActions = findAllNestedActions(actionBlock);
    for (const nested of nestedActions) {
      const actionClass = nested['@_class'] || '';
      if (actionClass === 'fr-set-service-value-action') {
        const vars = extractVars(nested);
        result.data.mappings.push({
          type: 'set-service-value',
          controlName: vars['control-name'],
          path: vars['path']
        });
      }
    }
    return result;
  }

  // --- xforms-submit-done: handle response ---
  if (event === 'xforms-submit-done') {
    result.type = 'handle-response';
    result.data.serviceName = extractServiceName(observer);
    result.data.actions = extractResponseActions(actionBlock);
    return result;
  }

  // --- xforms-submit-error: handle service errors ---
  if (event === 'xforms-submit-error') {
    result.type = 'handle-error';
    result.data.serviceName = extractServiceName(observer);
    result.data.actions = extractResponseActions(actionBlock);
    return result;
  }

  // --- Non-service trigger (no xf:send, but recognized event) ---
  if (!resolved.unknown) {
    result.type = 'trigger-no-service';
    result.data.controlName = observer.replace(/-control$/, '');
    result.data.originalEvent = event;
    result.data.resolvedEvents = resolved.events;
    result.data.isFormLoad = resolved.isFormLoad;
    result.data.ifCondition = cleanIfCondition(ifCondition);
    result.data.inlineActions = extractResponseActions(actionBlock);
    return result;
  }

  return result;
}

/**
 * Extract response/inline actions from a block (shared between submit-done,
 * submit-error, and non-service triggers)
 */
function extractResponseActions(actionBlock) {
  const actions = [];
  const nestedActions = findAllNestedActions(actionBlock);

  for (const nested of nestedActions) {
    const actionClass = nested['@_class'] || '';

    if (actionClass === 'fr-set-control-value-action') {
      const vars = extractVars(nested);
      actions.push({
        type: 'set-control-value',
        controlName: vars['control-name'],
        controlValue: vars['control-value']
      });
    } else if (actionClass === 'fr-set-control-visibility-action' || actionClass === 'fr-set-control-visible-action') {
      const vars = extractVars(nested);
      actions.push({
        type: 'set-visibility',
        controlName: vars['control-name'],
        visible: vars['visible'] || vars['control-value']
      });
    } else if (actionClass === 'fr-set-control-readonly-action') {
      const vars = extractVars(nested);
      actions.push({
        type: 'set-readonly',
        controlName: vars['control-name'],
        readonly: vars['readonly'] || vars['control-value']
      });
    } else if (actionClass === 'fr-itemset-action') {
      const vars = extractVars(nested);
      actions.push({
        type: 'set-items',
        controlName: vars['control-name'],
        itemsExpr: vars['response-items'],
        labelExpr: vars['item-label'],
        valueExpr: vars['item-value'],
        hintExpr: vars['hint'] || null
      });
    }
  }

  // --- Also detect raw xf:setvalue elements (Orbeon 2016 pattern) ---
  const setvalues = findElements(actionBlock, 'xf:setvalue');
  for (const sv of setvalues) {
    const ref = sv['@_ref'] || '';
    const value = sv['@_value'] || '';
    const ifCond = sv['@_if'] || null;

    if (!ref) continue;

    // Extract control name from ref path
    // e.g., "instance('fr-form-instance')/section-1/username" → "username"
    // e.g., "instance('fr-form-instance')/section-1/grid-1/grid-1-iteration/field" → "field"
    const controlName = extractControlNameFromRef(ref);

    // Transform value: context()//xpath → the xpath part for dataset reference
    const cleanValue = value || "''";

    actions.push({
      type: 'xf-setvalue',
      controlName,
      ref,              // original ref (for report)
      controlValue: cleanValue,
      ifCondition: cleanIfCondition(ifCond)
    });
  }

  return actions;
}

/**
 * Extract the control name from an instance ref path.
 *
 * Patterns:
 *   instance('fr-form-instance')/section-1/username         → username
 *   instance('fr-form-instance')/section-1/grid/iter/field  → field
 *   xxf:instance('fr-form-instance')/section-1/name         → name
 *   /section-1/control-name                                 → control-name
 */
function extractControlNameFromRef(ref) {
  // Remove instance(...) prefix
  let path = ref.replace(/^(xxf:)?instance\([^)]+\)\/?/, '');
  // Get the last segment of the path
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0) return ref; // fallback to full ref
  return segments[segments.length - 1];
}

/**
 * Clean an if="" condition for Action Syntax
 */
function cleanIfCondition(ifCondition) {
  if (!ifCondition) return null;
  const trimmed = ifCondition.trim();
  if (trimmed === 'true()' || trimmed === '') return null;
  return trimmed;
}

// ─── XML Traversal Helpers ───────────────────────────────────

function findElements(obj, tagName) {
  const results = [];
  if (!obj || typeof obj !== 'object') return results;

  for (const [key, value] of Object.entries(obj)) {
    if (key === tagName) {
      results.push(...toArray(value));
    }
    if (typeof value === 'object' && value !== null) {
      for (const item of toArray(value)) {
        results.push(...findElements(item, tagName));
      }
    }
  }
  return results;
}

function findAllNestedActions(obj) {
  const results = [];
  if (!obj || typeof obj !== 'object') return results;

  const actions = toArray(obj['xf:action']);
  for (const action of actions) {
    results.push(action);
    results.push(...findAllNestedActions(action));
  }
  return results;
}

function extractVars(actionBlock) {
  const vars = {};
  const varElements = toArray(actionBlock['xf:var']);
  for (const v of varElements) {
    const name = v['@_name'] || '';
    let value = v['@_value'] || '';
    if (value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    }
    vars[name] = value;
  }
  return vars;
}

// ─── Action Binding Parser ───────────────────────────────────

function parseActionBinding(binding) {
  const bindingId = binding['@_id'] || '';
  const actionName = extractActionName(bindingId);

  const result = {
    id: bindingId,
    name: actionName,
    triggers: [],
    serviceValues: [],
    responseActions: [],
    errorActions: [],
    inlineActions: [],
    warnings: []
  };

  const eventHandlers = toArray(binding['xf:action']);

  for (const handler of eventHandlers) {
    const parsed = parseEventHandler(handler);

    switch (parsed.type) {
      case 'trigger':
        result.triggers.push(parsed.data);
        break;
      case 'trigger-no-service':
        result.triggers.push(parsed.data);
        if (parsed.data.inlineActions?.length > 0) {
          result.inlineActions.push(...parsed.data.inlineActions);
        }
        break;
      case 'set-service-values':
        result.serviceValues.push(parsed.data);
        break;
      case 'handle-response':
        result.responseActions.push(parsed.data);
        break;
      case 'handle-error':
        result.errorActions.push(parsed.data);
        break;
      default:
        result.warnings.push(`Unknown event handler: ${parsed.event} on ${parsed.observer}`);
    }
  }

  // Backward compat
  result.trigger = result.triggers[0] || null;

  return result;
}

// ─── Main Export ─────────────────────────────────────────────

export function parseOrbeonXml(parsedXml) {
  const results = {
    services: [],
    actions: [],
    warnings: []
  };

  const html = parsedXml['xh:html'] || parsedXml['html'] || {};
  const head = html['xh:head'] || html['head'] || {};
  const model = head['xf:model'] || head['model'] || {};

  // Extract services
  const instances = toArray(model['xf:instance']);
  const submissions = toArray(model['xf:submission']);

  const serviceInstances = instances.filter(
    inst => (inst['@_class'] || '').includes('fr-service')
  );
  const serviceSubmissions = submissions.filter(
    sub => (sub['@_class'] || '').includes('fr-service')
  );

  for (const sub of serviceSubmissions) {
    const subId = sub['@_id'] || '';
    const serviceName = extractServiceName(subId);
    const matchingInstance = serviceInstances.find(
      inst => (inst['@_id'] || '').startsWith(serviceName)
    );

    results.services.push({
      name: serviceName,
      submissionId: subId,
      resource: sub['@_resource'] || '',
      method: sub['@_method'] || 'get',
      serialization: sub['@_serialization'] || '',
      mediatype: sub['@_mediatype'] || '',
      instanceId: matchingInstance?.['@_id'] || null,
      hasRequestBody: !!matchingInstance
    });
  }

  // Extract action bindings
  const allActions = toArray(model['xf:action']);
  const actionBindings = allActions.filter(
    a => (a['@_id'] || '').endsWith('-binding')
  );

  for (const binding of actionBindings) {
    try {
      const parsed = parseActionBinding(binding);
      results.actions.push(parsed);
    } catch (err) {
      results.warnings.push(`Error parsing binding ${binding['@_id']}: ${err.message}`);
    }
  }

  if (results.actions.length === 0 && actionBindings.length === 0) {
    results.warnings.push('No Simple Action bindings found (expected xf:action elements with id ending in "-binding")');
  }

  return results;
}

export { EVENT_MAP };
