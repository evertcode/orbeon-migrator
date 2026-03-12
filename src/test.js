/**
 * Test suite - validates all event types, conditions, and action types
 */

import { XMLParser } from 'fast-xml-parser';
import chalk from 'chalk';
import { parseOrbeonXml } from './parser.js';
import { generateActionSyntax } from './generator.js';
import { validateMigration } from './validator.js';

const parserOpts = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  preserveOrder: false,
  ignoreDeclaration: true,
  removeNSPrefix: false,
  parseAttributeValue: false,
  trimValues: true
};

const parser = new XMLParser(parserOpts);
let passed = 0;
let failed = 0;

function test(name, xml, assertions) {
  try {
    const parsedXml = parser.parse(xml);
    const parsed = parseOrbeonXml(parsedXml);
    const generated = generateActionSyntax(parsed);
    const validation = validateMigration(parsed, generated);

    const results = assertions({ parsed, generated, validation });
    if (results === false) throw new Error('Assertion returned false');

    console.log(chalk.green(`  ✓ ${name}`));
    passed++;
  } catch (err) {
    console.log(chalk.red(`  ✗ ${name}: ${err.message}`));
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

// ─── Test XML Templates ──────────────────────────────────────

function wrap(modelContent) {
  return `<?xml version="1.0"?>
<xh:html xmlns:xh="http://www.w3.org/1999/xhtml"
         xmlns:xf="http://www.w3.org/2002/xforms"
         xmlns:xxf="http://orbeon.org/oxf/xml/xforms"
         xmlns:ev="http://www.w3.org/2001/xml-events"
         xmlns:fr="http://orbeon.org/oxf/xml/form-runner">
  <xh:head>
    <xf:model id="fr-form-model">
      ${modelContent}
    </xf:model>
  </xh:head>
  <xh:body/>
</xh:html>`;
}

// ─── Tests ───────────────────────────────────────────────────

console.log(chalk.cyan.bold('\n═══ Orbeon Migrator - Full Test Suite ═══\n'));

// Test 1: DOMActivate (button click)
test('DOMActivate → activated', wrap(`
  <xf:instance id="srv-api-instance" class="fr-service"><body/></xf:instance>
  <xf:submission id="srv-api-submission" class="fr-service" resource="https://api.test.com" method="get"/>
  <xf:action id="act-load-data-binding">
    <xf:action event="DOMActivate" ev:observer="btn-load-control" if="true()">
      <xf:send submission="srv-api-submission"/>
    </xf:action>
    <xf:action event="xforms-submit-done" ev:observer="srv-api-submission">
      <xf:action class="fr-set-control-value-action">
        <xf:var name="control-name" value="'result'"/>
        <xf:var name="control-value" value="//data"/>
      </xf:action>
    </xf:action>
  </xf:action>
`), ({ parsed, generated }) => {
  assert(parsed.actions[0].triggers[0].resolvedEvents[0] === 'activated', 'Should resolve to activated');
  assert(generated.fullXml.includes('events="activated"'), 'Should have activated event');
  assert(generated.fullXml.includes('controls="btn-load"'), 'Should strip -control suffix');
  assert(!generated.fullXml.includes('if='), 'Should strip if="true()"');
});

// Test 2: xforms-value-changed
test('xforms-value-changed → value-changed', wrap(`
  <xf:instance id="srv-lookup-instance" class="fr-service"><body/></xf:instance>
  <xf:submission id="srv-lookup-submission" class="fr-service" resource="https://api.test.com" method="get"/>
  <xf:action id="act-on-change-binding">
    <xf:action event="xforms-value-changed" ev:observer="dropdown-estado-control">
      <xf:send submission="srv-lookup-submission"/>
    </xf:action>
    <xf:action event="xforms-submit-done" ev:observer="srv-lookup-submission">
      <xf:action class="fr-set-control-value-action">
        <xf:var name="control-name" value="'city'"/>
        <xf:var name="control-value" value="//city"/>
      </xf:action>
    </xf:action>
  </xf:action>
`), ({ generated }) => {
  assert(generated.fullXml.includes('events="value-changed"'), 'Should have value-changed event');
  assert(generated.fullXml.includes('controls="dropdown-estado"'), 'Should have correct control');
});

// Test 3: Form load event
test('xforms-ready → form-load-after-data', wrap(`
  <xf:instance id="srv-init-instance" class="fr-service"><body/></xf:instance>
  <xf:submission id="srv-init-submission" class="fr-service" resource="https://api.test.com/init" method="get"/>
  <xf:action id="act-form-init-binding">
    <xf:action event="xforms-ready" ev:observer="fr-form-model">
      <xf:send submission="srv-init-submission"/>
    </xf:action>
    <xf:action event="xforms-submit-done" ev:observer="srv-init-submission">
      <xf:action class="fr-set-control-value-action">
        <xf:var name="control-name" value="'welcome-msg'"/>
        <xf:var name="control-value" value="//message"/>
      </xf:action>
    </xf:action>
  </xf:action>
`), ({ parsed, generated }) => {
  assert(parsed.actions[0].triggers[0].isFormLoad === true, 'Should be form load');
  assert(generated.fullXml.includes('events="form-load-after-data"'), 'Should map to form-load-after-data');
  assert(!generated.fullXml.includes('controls='), 'Form load should not have controls attr');
});

// Test 4: Custom if condition
test('if condition preserved', wrap(`
  <xf:instance id="srv-cond-instance" class="fr-service"><body/></xf:instance>
  <xf:submission id="srv-cond-submission" class="fr-service" resource="https://api.test.com" method="get"/>
  <xf:action id="act-conditional-binding">
    <xf:action event="xforms-value-changed" ev:observer="tipo-control" if="xxf:get-request-parameter('mode') = 'edit'">
      <xf:send submission="srv-cond-submission"/>
    </xf:action>
    <xf:action event="xforms-submit-done" ev:observer="srv-cond-submission">
      <xf:action class="fr-set-control-value-action">
        <xf:var name="control-name" value="'output'"/>
        <xf:var name="control-value" value="//result"/>
      </xf:action>
    </xf:action>
  </xf:action>
`), ({ parsed, generated }) => {
  const cond = parsed.actions[0].triggers[0].ifCondition;
  assert(cond === "xxf:get-request-parameter('mode') = 'edit'", `Condition should be preserved, got: ${cond}`);
  assert(generated.fullXml.includes('if='), 'Generated XML should include if attribute');
});

// Test 5: Visibility action
test('set-visibility → fr:control-setvisible', wrap(`
  <xf:action id="act-toggle-binding">
    <xf:action event="xforms-value-changed" ev:observer="show-details-control">
      <xf:action class="fr-set-control-visible-action">
        <xf:var name="control-name" value="'details-section'"/>
        <xf:var name="control-value" value="'true'"/>
      </xf:action>
    </xf:action>
  </xf:action>
`), ({ parsed, generated }) => {
  assert(parsed.actions[0].triggers[0].resolvedEvents[0] === 'value-changed', 'Should be value-changed');
  assert(parsed.actions[0].inlineActions[0].type === 'set-visibility', 'Should detect visibility action');
  assert(generated.fullXml.includes('fr:control-setvisible'), 'Should generate setvisible');
});

// Test 6: Itemset (dropdown population)
test('fr-itemset-action → fr:control-setitems', wrap(`
  <xf:instance id="srv-items-instance" class="fr-service"><body/></xf:instance>
  <xf:submission id="srv-items-submission" class="fr-service" resource="https://api.test.com/items" method="get"/>
  <xf:action id="act-load-items-binding">
    <xf:action event="xforms-value-changed" ev:observer="country-control">
      <xf:send submission="srv-items-submission"/>
    </xf:action>
    <xf:action event="xforms-submit" ev:observer="srv-items-submission">
      <xf:var name="request-instance-name" value="'srv-items-instance'"/>
      <xf:action>
        <xf:action class="fr-set-service-value-action">
          <xf:var name="control-name" value="'country'"/>
          <xf:var name="path" value="//country-code"/>
        </xf:action>
      </xf:action>
    </xf:action>
    <xf:action event="xforms-submit-done" ev:observer="srv-items-submission">
      <xf:action class="fr-itemset-action">
        <xf:var name="control-name" value="'city-dropdown'"/>
        <xf:var name="items" value="//cities/city"/>
        <xf:var name="label" value="name"/>
        <xf:var name="value" value="code"/>
      </xf:action>
    </xf:action>
  </xf:action>
`), ({ generated }) => {
  assert(generated.fullXml.includes('fr:control-setitems'), 'Should generate setitems');
  assert(generated.fullXml.includes('fr:dataset-write'), 'Should use dataset pattern');
  assert(generated.fullXml.includes('label="name"'), 'Should have label attr');
  assert(generated.fullXml.includes('value="code"'), 'Should have value attr');
});

// Test 7: Enabled/disabled events
test('xforms-enabled → enabled', wrap(`
  <xf:action id="act-on-enable-binding">
    <xf:action event="xforms-enabled" ev:observer="conditional-field-control">
      <xf:action class="fr-set-control-value-action">
        <xf:var name="control-name" value="'status-label'"/>
        <xf:var name="control-value" value="'Field is now active'"/>
      </xf:action>
    </xf:action>
  </xf:action>
`), ({ parsed, generated }) => {
  assert(parsed.actions[0].triggers[0].resolvedEvents[0] === 'enabled', 'Should be enabled');
  assert(generated.fullXml.includes('events="enabled"'), 'Should have enabled event');
});

// Test 8: xforms-select / xforms-deselect
test('xforms-select → item-selected', wrap(`
  <xf:action id="act-on-select-binding">
    <xf:action event="xforms-select" ev:observer="checkbox-control">
      <xf:action class="fr-set-control-value-action">
        <xf:var name="control-name" value="'selected-label'"/>
        <xf:var name="control-value" value="'Item selected'"/>
      </xf:action>
    </xf:action>
  </xf:action>
`), ({ parsed, generated }) => {
  assert(parsed.actions[0].triggers[0].resolvedEvents[0] === 'item-selected', 'Should be item-selected');
  assert(generated.fullXml.includes('events="item-selected"'), 'Should have item-selected');
});

// Test 9: Original conversation XML (regression)
test('Original XML from conversation (regression)', wrap(`
  <xf:instance id="srv-get-todos-instance" class="fr-service" xxf:exclude-result-prefixes="#all">
    <body>&lt;data&gt;&lt;user/&gt;&lt;/data&gt;</body>
  </xf:instance>
  <xf:submission id="srv-get-todos-submission" class="fr-service"
    resource="https://evertcode-srv-api.free.beeceptor.com/api/dummy-data"
    method="post" serialization="application/xml" mediatype="application/xml"/>
  <xf:action id="act-get-todos-binding">
    <xf:action event="DOMActivate" ev:observer="btn-get-user-control" if="true()">
      <xf:send submission="srv-get-todos-submission"/>
    </xf:action>
    <xf:action event="xforms-submit" ev:observer="srv-get-todos-submission">
      <xf:var name="request-instance-name" value="'srv-get-todos-instance'"/>
      <xf:action>
        <xf:action class="fr-set-service-value-action">
          <xf:var name="control-name" value="'username'"/>
          <xf:var name="path" value="//user"/>
        </xf:action>
      </xf:action>
    </xf:action>
    <xf:action event="xforms-submit-done" ev:observer="srv-get-todos-submission">
      <xf:action class="fr-set-control-value-action">
        <xf:var name="control-name" value="'control-1'"/>
        <xf:var name="control-value" value="//token"/>
      </xf:action>
      <xf:action class="fr-set-control-value-action">
        <xf:var name="control-name" value="'avatar-url'"/>
        <xf:var name="control-value" value="//avatar"/>
      </xf:action>
      <xf:action class="fr-set-control-value-action">
        <xf:var name="control-name" value="'responde-data'"/>
        <xf:var name="control-value" value="saxon:serialize(., 'xml')"/>
      </xf:action>
    </xf:action>
  </xf:action>
`), ({ parsed, generated, validation }) => {
  assert(parsed.actions.length === 1, 'Should find 1 action');
  assert(parsed.services.length === 1, 'Should find 1 service');
  assert(validation.valid, 'Should pass validation');
  assert(generated.fullXml.includes('fr:dataset-write'), 'Should use dataset pattern');
  assert(generated.fullXml.includes('saxon:serialize'), 'Should preserve saxon:serialize');
  assert(!generated.fullXml.includes('fr:service-result'), 'Should NOT use service-result');
  assert(generated.fullXml.includes('events="activated"'), 'Should map DOMActivate');
  assert(generated.fullXml.includes('controls="btn-get-user"'), 'Should strip -control');
});

// Test 10: Multiple form load events
test('fr-form-load-after-controls', wrap(`
  <xf:instance id="srv-load-instance" class="fr-service"><body/></xf:instance>
  <xf:submission id="srv-load-submission" class="fr-service" resource="https://api.test.com" method="get"/>
  <xf:action id="act-after-controls-binding">
    <xf:action event="fr-form-load-after-controls" ev:observer="fr-form-model">
      <xf:send submission="srv-load-submission"/>
    </xf:action>
    <xf:action event="xforms-submit-done" ev:observer="srv-load-submission">
      <xf:action class="fr-set-control-value-action">
        <xf:var name="control-name" value="'info'"/>
        <xf:var name="control-value" value="//status"/>
      </xf:action>
    </xf:action>
  </xf:action>
`), ({ generated }) => {
  assert(generated.fullXml.includes('events="form-load-after-controls"'), 'Should map correctly');
  assert(!generated.fullXml.includes('controls='), 'No controls for form load');
});

// Test 11: xf:setvalue without condition (Orbeon 2016 pattern)
test('xf:setvalue without condition → fr:control-setvalue', wrap(`
  <xf:instance id="srv-user-instance" class="fr-service"><body/></xf:instance>
  <xf:submission id="srv-user-submission" class="fr-service" resource="https://api.test.com/user" method="get"/>
  <xf:action id="act-load-user-binding">
    <xf:action event="DOMActivate" ev:observer="btn-fetch-control">
      <xf:send submission="srv-user-submission"/>
    </xf:action>
    <xf:action event="xforms-submit-done" ev:observer="srv-user-submission">
      <xf:setvalue ref="instance('fr-form-instance')/section-1/username" value="context()//username"/>
      <xf:setvalue ref="instance('fr-form-instance')/section-1/email" value="context()//email"/>
    </xf:action>
  </xf:action>
`), ({ parsed, generated }) => {
  const responseActions = parsed.actions[0].responseActions[0].actions;
  assert(responseActions.length === 2, `Should find 2 xf:setvalue, got ${responseActions.length}`);
  assert(responseActions[0].type === 'xf-setvalue', 'Should be xf-setvalue type');
  assert(responseActions[0].controlName === 'username', `Should extract "username", got "${responseActions[0].controlName}"`);
  assert(responseActions[1].controlName === 'email', 'Should extract "email"');
  assert(generated.fullXml.includes('control="username"'), 'Should have username control');
  assert(generated.fullXml.includes('control="email"'), 'Should have email control');
  assert(generated.fullXml.includes("fr:dataset('srv-user-response')//username"), 'Should transform context() to dataset');
  assert(!generated.fullXml.includes('fr:if'), 'Should NOT have fr:if without condition');
});

// Test 12: xf:setvalue WITH if condition
test('xf:setvalue with if condition → fr:if + fr:control-setvalue', wrap(`
  <xf:instance id="srv-auth-instance" class="fr-service"><body/></xf:instance>
  <xf:submission id="srv-auth-submission" class="fr-service" resource="https://api.test.com/auth" method="post"/>
  <xf:action id="act-auth-binding">
    <xf:action event="DOMActivate" ev:observer="btn-login-control">
      <xf:send submission="srv-auth-submission"/>
    </xf:action>
    <xf:action event="xforms-submit" ev:observer="srv-auth-submission">
      <xf:var name="request-instance-name" value="'srv-auth-instance'"/>
      <xf:action>
        <xf:action class="fr-set-service-value-action">
          <xf:var name="control-name" value="'username'"/>
          <xf:var name="path" value="//user"/>
        </xf:action>
      </xf:action>
    </xf:action>
    <xf:action event="xforms-submit-done" ev:observer="srv-auth-submission">
      <xf:setvalue ref="instance('fr-form-instance')/section-1/token" value="context()//token" if="context()//success='true'"/>
      <xf:setvalue ref="instance('fr-form-instance')/section-1/error-msg" value="context()//message" if="context()//success='false'"/>
      <xf:setvalue ref="instance('fr-form-instance')/section-1/full-response" value="context()//data"/>
    </xf:action>
  </xf:action>
`), ({ parsed, generated }) => {
  const responseActions = parsed.actions[0].responseActions[0].actions;
  assert(responseActions.length === 3, `Should find 3 xf:setvalue, got ${responseActions.length}`);

  // First: with condition
  assert(responseActions[0].ifCondition === "context()//success='true'", `Should preserve if condition, got: ${responseActions[0].ifCondition}`);
  assert(responseActions[0].controlName === 'token', 'Should extract "token"');

  // Second: with different condition
  assert(responseActions[1].ifCondition === "context()//success='false'", 'Should preserve second condition');
  assert(responseActions[1].controlName === 'error-msg', 'Should extract "error-msg"');

  // Third: no condition
  assert(responseActions[2].ifCondition === null, 'Third should have no condition');

  // Check generated XML
  assert(generated.fullXml.includes('fr:if condition='), 'Should have fr:if for conditional setvalue');
  assert(generated.fullXml.includes("fr:dataset('srv-auth-response')//success"), 'Should transform context() in condition');
  assert(generated.fullXml.includes('control="token"'), 'Should have token control');
  assert(generated.fullXml.includes('control="error-msg"'), 'Should have error-msg control');
  assert(generated.fullXml.includes('control="full-response"'), 'Should have full-response control');

  // The third one should NOT be wrapped in fr:if
  const xmlLines = generated.fullXml.split('\n');
  const fullResponseLine = xmlLines.findIndex(l => l.includes('control="full-response"'));
  const prevLine = xmlLines[fullResponseLine - 1] || '';
  assert(!prevLine.includes('fr:if'), 'full-response should NOT be inside fr:if');
});

// Test 13: xf:setvalue with deep nested ref path
test('xf:setvalue with deep nested ref path', wrap(`
  <xf:instance id="srv-deep-instance" class="fr-service"><body/></xf:instance>
  <xf:submission id="srv-deep-submission" class="fr-service" resource="https://api.test.com" method="get"/>
  <xf:action id="act-deep-binding">
    <xf:action event="DOMActivate" ev:observer="btn-deep-control">
      <xf:send submission="srv-deep-submission"/>
    </xf:action>
    <xf:action event="xforms-submit-done" ev:observer="srv-deep-submission">
      <xf:setvalue ref="instance('fr-form-instance')/section-1/grid-1/grid-1-iteration/nested-field" value="context()//result"/>
    </xf:action>
  </xf:action>
`), ({ parsed, generated }) => {
  const action = parsed.actions[0].responseActions[0].actions[0];
  assert(action.controlName === 'nested-field', `Should extract last segment, got "${action.controlName}"`);
  assert(generated.fullXml.includes('control="nested-field"'), 'Should use last segment as control name');
});

// ─── Summary ─────────────────────────────────────────────────

console.log('');
console.log(chalk.cyan('─────────────────────────────────────────'));
console.log(chalk.white(`  Total: ${passed + failed}  `) +
  chalk.green(`Passed: ${passed}  `) +
  (failed > 0 ? chalk.red(`Failed: ${failed}`) : chalk.green(`Failed: ${failed}`)));
console.log(chalk.cyan('─────────────────────────────────────────'));

if (failed > 0) {
  console.log(chalk.red.bold('\n  ❌ Some tests failed\n'));
  process.exit(1);
} else {
  console.log(chalk.green.bold('\n  ✅ All tests passed!\n'));
}
