# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # Install dependencies
npm start          # Run the interactive CLI
npm test           # Run the test suite (src/test.js)
node src/index.js  # Equivalent to npm start
```

There is no lint or typecheck script configured. The project uses ES modules (`"type": "module"` in package.json), so all files use `import`/`export` syntax.

## Architecture

This is a Node.js CLI tool that migrates Orbeon Forms **Simple Actions** (legacy) to **Action Syntax** (Orbeon 2025.1+). The pipeline is:

```
XML file → parser.js → generator.js → validator.js
```

**`src/parser.js`** — Parses raw Orbeon form XML (pre-processed by `fast-xml-parser`) into structured data. Key concepts:
- Looks for `<xf:action id="...-binding">` elements inside `<xf:model>` — these are Simple Action bindings.
- Each binding contains event handlers: `xforms-submit` (set request values), `xforms-submit-done` (handle response), `xforms-submit-error` (handle errors), and trigger events (`DOMActivate`, `xforms-value-changed`, etc.).
- Exports `parseOrbeonXml(parsedXml)` → `{ services[], actions[], warnings[] }`.
- `EVENT_MAP` maps old XForms events to new Action Syntax event names.

**`src/generator.js`** — Takes the parsed structure and generates Action Syntax XML. Core pattern:
- Every service call generates: `fr:service-call` → `fr:dataset-write` → `fr:dataset()` reads (instead of `fr:service-result()`).
- Each action gets an `<fr:listener>` and an `<fr:action>` block.
- XPath expressions referencing `context()` are rewritten to `fr:dataset('service-response')//...`.
- `saxon:serialize(., 'xml')` is rewritten to `saxon:serialize(fr:dataset('...'), 'xml')`.
- Conditional `xf:setvalue` with `if=""` attributes become `<fr:if condition="...">` wrappers.

**`src/validator.js`** — Post-generation validation. Checks:
- Every action has a matching `fr:listener`.
- No `fr:service-result()` in output (known incompatibility with 2025.1).
- Actions with response handling have `fr:dataset-write` present.
- Duplicate action names, unknown events, and missing trigger events.

**`src/index.js`** — Interactive CLI using `inquirer`. Orchestrates the pipeline with `ora` spinners and `chalk` colors. The "save full form" option uses regex to remove old `<xf:action id="...-binding">` blocks and inserts the new XML before `</xf:model>`.

**`src/test.js`** — Self-contained test suite (no test framework). Uses a `test(name, xml, assertions)` helper that runs the full parse → generate → validate pipeline on inline XML fixtures. Add new tests by calling `test()` with a `wrap(modelContent)` XML template.

## Key Data Shapes

**Parsed action** (from `parser.js`):
```js
{
  id: 'act-foo-binding',
  name: 'act-foo',
  triggers: [{ serviceName, controlName, resolvedEvents, isFormLoad, ifCondition, unknownEvent }],
  serviceValues: [{ serviceName, mappings: [{ controlName, path }] }],
  responseActions: [{ serviceName, actions: [...] }],
  errorActions: [...],
  inlineActions: [...],
  trigger: triggers[0]  // backward compat
}
```

**Response/inline action types**: `set-control-value`, `xf-setvalue`, `set-visibility`, `set-readonly`, `set-items`.

## Adding New Action Types

1. Detect and parse the new action class in `extractResponseActions()` in `parser.js`.
2. Add a `case` for the new type in `generateResponseActions()` / `generateInlineActions()` in `generator.js`.
3. Add a test case in `src/test.js` using `wrap()` + `test()`.
