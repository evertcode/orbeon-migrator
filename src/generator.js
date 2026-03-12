/**
 * generator.js - Generates Orbeon Action Syntax XML from parsed Simple Actions
 *
 * Supports all control events, form load events, and if() conditions.
 * Uses the fr:dataset pattern (dataset-write + dataset()) for compatibility
 * with Orbeon 2025.1
 */

const INDENT = '    ';

// ─── XPath Transform ─────────────────────────────────────────

function usesSaxonSerialize(expr) {
  return expr && expr.includes('saxon:serialize');
}

function transformXPath(expr, datasetName) {
  if (!expr) return "''";

  if (usesSaxonSerialize(expr)) {
    return `saxon:serialize(fr:dataset('${datasetName}'), 'xml')`;
  }

  if (expr.startsWith('//') || expr.startsWith('/')) {
    return `fr:dataset('${datasetName}')${expr}`;
  }

  return `fr:dataset('${datasetName}')/${expr}`;
}

/**
 * Transform XPath expressions that use context() (Orbeon 2016 pattern)
 *
 * context()//username       → fr:dataset('name')//username
 * context()//success='true' → fr:dataset('name')//success='true'
 * //plain-xpath             → fr:dataset('name')//plain-xpath
 * 'literal string'          → 'literal string' (unchanged)
 */
function transformContextXPath(expr, datasetName) {
  if (!expr) return "''";

  // String literals - leave as-is
  if (expr.startsWith("'") && expr.endsWith("'")) {
    return expr;
  }

  // Replace context() with fr:dataset reference
  if (expr.includes('context()')) {
    return expr.replace(/context\(\)/g, `fr:dataset('${datasetName}')`);
  }

  // Same as regular transformXPath for non-context expressions
  if (usesSaxonSerialize(expr)) {
    return `saxon:serialize(fr:dataset('${datasetName}'), 'xml')`;
  }

  if (expr.startsWith('//') || expr.startsWith('/')) {
    return `fr:dataset('${datasetName}')${expr}`;
  }

  return `fr:dataset('${datasetName}')/${expr}`;
}

function escapeXmlAttr(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── Listener Generation ─────────────────────────────────────

function generateListener(action) {
  const listeners = [];

  for (const trigger of action.triggers) {
    const events = trigger.resolvedEvents?.join(' ') || 'activated';
    const isFormLoad = trigger.isFormLoad || false;

    const attrs = [`version="2018.2"`];
    attrs.push(`events="${events}"`);

    // Form load events don't have a controls attribute
    if (!isFormLoad && trigger.controlName) {
      attrs.push(`controls="${trigger.controlName}"`);
    }

    attrs.push(`actions="${action.name}"`);

    // Add if condition
    if (trigger.ifCondition) {
      attrs.push(`if="${escapeXmlAttr(trigger.ifCondition)}"`);
    }

    const formatted = attrs.map((a, i) =>
      i === 0
        ? `${INDENT}<fr:listener ${a}`
        : `${INDENT}    ${a}`
    ).join('\n');

    listeners.push(`${formatted}/>`);

    // Warn about unknown events
    if (trigger.unknownEvent) {
      listeners.push(`${INDENT}<!-- ⚠ WARNING: Unknown event "${trigger.originalEvent}" - verify manually -->`);
    }
  }

  return listeners;
}

// ─── Action Generation ───────────────────────────────────────

function generateAction(action) {
  const lines = [];
  const actionName = action.name;
  const hasService = action.triggers.some(t => t.serviceName);
  const serviceName = action.triggers.find(t => t.serviceName)?.serviceName
    || action.serviceValues[0]?.serviceName
    || null;
  const datasetName = serviceName ? `${serviceName}-response` : null;

  lines.push(`${INDENT}<fr:action name="${actionName}" version="2018.2">`);

  if (hasService && serviceName) {
    // --- Service call with request value mappings ---
    const serviceValueBlock = action.serviceValues[0];
    const hasMappings = serviceValueBlock?.mappings?.length > 0;

    if (hasMappings) {
      lines.push(`${INDENT}${INDENT}<!-- Set request values and call service -->`);
      lines.push(`${INDENT}${INDENT}<fr:service-call service="${serviceName}">`);
      for (const mapping of serviceValueBlock.mappings) {
        lines.push(`${INDENT}${INDENT}${INDENT}<fr:value control="${mapping.controlName}" ref="${mapping.path}"/>`);
      }
      lines.push(`${INDENT}${INDENT}</fr:service-call>`);
    } else {
      lines.push(`${INDENT}${INDENT}<!-- Call service -->`);
      lines.push(`${INDENT}${INDENT}<fr:service-call service="${serviceName}"/>`);
    }

    // --- Save response to dataset ---
    if (action.responseActions.length > 0 || action.errorActions.length > 0) {
      lines.push('');
      lines.push(`${INDENT}${INDENT}<!-- Save response to dataset -->`);
      lines.push(`${INDENT}${INDENT}<fr:dataset-write name="${datasetName}"/>`);
    }

    // --- Handle response actions ---
    for (const responseBlock of action.responseActions) {
      if (responseBlock.actions.length > 0) {
        lines.push('');
        lines.push(`${INDENT}${INDENT}<!-- Map response to form controls -->`);
      }
      generateResponseActions(lines, responseBlock.actions, datasetName);
    }

    // --- Handle error actions ---
    for (const errorBlock of action.errorActions) {
      if (errorBlock.actions.length > 0) {
        lines.push('');
        lines.push(`${INDENT}${INDENT}<!-- Handle service error -->`);
      }
      generateResponseActions(lines, errorBlock.actions, datasetName);
    }

  } else {
    // --- Non-service action (inline actions only) ---
    if (action.inlineActions.length > 0) {
      lines.push(`${INDENT}${INDENT}<!-- Inline actions -->`);
      generateInlineActions(lines, action.inlineActions);
    }
  }

  lines.push(`${INDENT}</fr:action>`);
  return lines.join('\n');
}

/**
 * Generate XML for response actions that read from a dataset
 */
function generateResponseActions(lines, actions, datasetName) {
  for (const responseAction of actions) {
    switch (responseAction.type) {
      case 'set-control-value': {
        const value = transformXPath(responseAction.controlValue, datasetName);
        lines.push(`${INDENT}${INDENT}<fr:control-setvalue`);
        lines.push(`${INDENT}${INDENT}    control="${responseAction.controlName}"`);
        lines.push(`${INDENT}${INDENT}    value="${escapeXmlAttr(value)}"/>`);
        break;
      }

      case 'xf-setvalue': {
        // xf:setvalue with ref to instance and value from context()
        // Optionally wrapped in fr:if when there's a condition
        const value = transformContextXPath(responseAction.controlValue, datasetName);
        const hasCondition = !!responseAction.ifCondition;

        if (hasCondition) {
          const condExpr = transformContextXPath(responseAction.ifCondition, datasetName);
          lines.push(`${INDENT}${INDENT}<fr:if condition="${escapeXmlAttr(condExpr)}">`);
          lines.push(`${INDENT}${INDENT}${INDENT}<fr:control-setvalue`);
          lines.push(`${INDENT}${INDENT}${INDENT}    control="${responseAction.controlName}"`);
          lines.push(`${INDENT}${INDENT}${INDENT}    value="${escapeXmlAttr(value)}"/>`);
          lines.push(`${INDENT}${INDENT}</fr:if>`);
        } else {
          lines.push(`${INDENT}${INDENT}<fr:control-setvalue`);
          lines.push(`${INDENT}${INDENT}    control="${responseAction.controlName}"`);
          lines.push(`${INDENT}${INDENT}    value="${escapeXmlAttr(value)}"/>`);
        }

        // Add comment with original ref for traceability
        lines.push(`${INDENT}${INDENT}<!-- original: xf:setvalue ref="${escapeXmlAttr(responseAction.ref)}" -->`);
        break;
      }

      case 'set-visibility': {
        const visible = responseAction.visible;
        const visibleValue = (visible === 'true' || visible === 'false')
          ? visible
          : transformXPath(visible, datasetName);
        lines.push(`${INDENT}${INDENT}<fr:control-setvisible`);
        lines.push(`${INDENT}${INDENT}    control="${responseAction.controlName}"`);
        lines.push(`${INDENT}${INDENT}    visible="${escapeXmlAttr(visibleValue)}"/>`);
        break;
      }

      case 'set-readonly': {
        const readonly = responseAction.readonly;
        const readonlyValue = (readonly === 'true' || readonly === 'false')
          ? readonly
          : transformXPath(readonly, datasetName);
        lines.push(`${INDENT}${INDENT}<fr:control-setreadonly`);
        lines.push(`${INDENT}${INDENT}    control="${responseAction.controlName}"`);
        lines.push(`${INDENT}${INDENT}    readonly="${escapeXmlAttr(readonlyValue)}"/>`);
        break;
      }

      case 'set-items': {
        const items = transformXPath(responseAction.itemsExpr, datasetName);
        lines.push(`${INDENT}${INDENT}<fr:control-setitems`);
        lines.push(`${INDENT}${INDENT}    items="${escapeXmlAttr(items)}"`);
        lines.push(`${INDENT}${INDENT}    label="${responseAction.labelExpr || 'label'}"`);
        lines.push(`${INDENT}${INDENT}    value="${responseAction.valueExpr || 'value'}"`);
        if (responseAction.hintExpr) {
          lines.push(`${INDENT}${INDENT}    hint="${responseAction.hintExpr}"`);
        }
        lines.push(`${INDENT}${INDENT}    control="${responseAction.controlName}"/>`);
        break;
      }

      default:
        lines.push(`${INDENT}${INDENT}<!-- TODO: Unsupported action type "${responseAction.type}" - migrate manually -->`);
    }
  }
}

/**
 * Generate XML for inline actions (non-service, e.g. set value on value-changed)
 */
function generateInlineActions(lines, actions) {
  for (const action of actions) {
    switch (action.type) {
      case 'set-control-value': {
        // For inline actions, controlValue is a direct expression (no dataset)
        const value = action.controlValue || "''";
        lines.push(`${INDENT}${INDENT}<fr:control-setvalue`);
        lines.push(`${INDENT}${INDENT}    control="${action.controlName}"`);
        lines.push(`${INDENT}${INDENT}    value="${escapeXmlAttr(value)}"/>`);
        break;
      }

      case 'set-visibility': {
        const visible = action.visible || 'true';
        lines.push(`${INDENT}${INDENT}<fr:control-setvisible`);
        lines.push(`${INDENT}${INDENT}    control="${action.controlName}"`);
        lines.push(`${INDENT}${INDENT}    visible="${escapeXmlAttr(visible)}"/>`);
        break;
      }

      case 'set-readonly': {
        const readonly = action.readonly || 'true';
        lines.push(`${INDENT}${INDENT}<fr:control-setreadonly`);
        lines.push(`${INDENT}${INDENT}    control="${action.controlName}"`);
        lines.push(`${INDENT}${INDENT}    readonly="${escapeXmlAttr(readonly)}"/>`);
        break;
      }

      case 'set-items': {
        lines.push(`${INDENT}${INDENT}<fr:control-setitems`);
        lines.push(`${INDENT}${INDENT}    items="${escapeXmlAttr(action.itemsExpr || '')}"`);
        lines.push(`${INDENT}${INDENT}    label="${action.labelExpr || 'label'}"`);
        lines.push(`${INDENT}${INDENT}    value="${action.valueExpr || 'value'}"`);
        if (action.hintExpr) {
          lines.push(`${INDENT}${INDENT}    hint="${action.hintExpr}"`);
        }
        lines.push(`${INDENT}${INDENT}    control="${action.controlName}"/>`);
        break;
      }

      default:
        lines.push(`${INDENT}${INDENT}<!-- TODO: Unsupported inline action type "${action.type}" -->`);
    }
  }
}

// ─── Main Export ─────────────────────────────────────────────

export function generateActionSyntax(parsed) {
  const output = {
    listeners: [],
    actions: [],
    fullXml: '',
    report: []
  };

  for (const action of parsed.actions) {
    // Generate listeners (may produce multiple per action)
    const listeners = generateListener(action);
    output.listeners.push(...listeners);

    // Generate action
    const actionXml = generateAction(action);
    output.actions.push(actionXml);

    // Build report entry
    const reportEntry = {
      name: action.name,
      changes: []
    };

    for (const trigger of action.triggers) {
      const eventDesc = trigger.resolvedEvents?.join(', ') || 'unknown';
      const fromEvent = trigger.originalEvent || 'unknown';
      const controlDesc = trigger.isFormLoad
        ? '(form load)'
        : `on "${trigger.controlName}"`;

      reportEntry.changes.push(
        `Event: ${fromEvent} ${controlDesc} → fr:listener events="${eventDesc}"`
      );

      if (trigger.ifCondition) {
        reportEntry.changes.push(
          `  Condition: if="${trigger.ifCondition}"`
        );
      }

      if (trigger.serviceName) {
        reportEntry.changes.push(
          `  Service call: xf:send → fr:service-call service="${trigger.serviceName}"`
        );
      }

      if (trigger.unknownEvent) {
        reportEntry.changes.push(
          `  ⚠ Unknown event "${fromEvent}" - verify manually`
        );
      }
    }

    for (const sv of action.serviceValues) {
      for (const mapping of sv.mappings) {
        reportEntry.changes.push(
          `Request mapping: fr-set-service-value-action (${mapping.controlName} → ${mapping.path}) → fr:value`
        );
      }
    }

    for (const ra of action.responseActions) {
      const dsName = `${ra.serviceName}-response`;
      reportEntry.changes.push(
        `Response handling: xforms-submit-done → fr:dataset-write name="${dsName}"`
      );
      for (const act of ra.actions) {
        const typeMap = {
          'set-control-value': 'fr:control-setvalue',
          'set-visibility': 'fr:control-setvisible',
          'set-readonly': 'fr:control-setreadonly',
          'set-items': 'fr:control-setitems',
          'xf-setvalue': 'fr:control-setvalue (from xf:setvalue)'
        };
        let desc = `  ${act.type} → ${typeMap[act.type] || 'unknown'} control="${act.controlName}"`;
        if (act.type === 'xf-setvalue') {
          desc += ` (ref: ${act.ref})`;
          if (act.ifCondition) {
            desc += ` [conditional: if="${act.ifCondition}"]`;
          }
        }
        reportEntry.changes.push(desc);
      }
    }

    for (const ea of action.errorActions) {
      reportEntry.changes.push(
        `Error handling: xforms-submit-error for "${ea.serviceName}"`
      );
      for (const act of ea.actions) {
        reportEntry.changes.push(`  ${act.type} → control="${act.controlName}"`);
      }
    }

    if (action.inlineActions.length > 0) {
      reportEntry.changes.push(`Inline actions (no service call):`);
      for (const act of action.inlineActions) {
        reportEntry.changes.push(`  ${act.type} → control="${act.controlName}"`);
      }
    }

    if (action.warnings.length > 0) {
      reportEntry.changes.push(`⚠ Warnings: ${action.warnings.join(', ')}`);
    }

    output.report.push(reportEntry);
  }

  // Assemble full XML
  const xmlParts = [
    '<!-- ═══════════════════════════════════════════════════════════ -->',
    '<!-- Orbeon Action Syntax (migrated from Simple Actions)       -->',
    '<!-- Pattern: fr:service-call → fr:dataset-write → fr:dataset() -->',
    '<!-- ═══════════════════════════════════════════════════════════ -->',
    '',
    '<!-- Listeners -->',
    ...output.listeners,
    '',
    '<!-- Actions -->',
    ...output.actions
  ];

  output.fullXml = xmlParts.join('\n');

  if (parsed.warnings.length > 0) {
    output.report.push({
      name: '⚠ General Warnings',
      changes: parsed.warnings
    });
  }

  return output;
}
