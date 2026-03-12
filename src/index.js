#!/usr/bin/env node

/**
 * orbeon-migrator CLI
 *
 * Interactive CLI tool to migrate Orbeon Forms Simple Actions
 * to the new Action Syntax (2025.1+)
 *
 * Uses the proven pattern:
 *   fr:service-call → fr:dataset-write → fr:dataset()
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, basename, dirname, join } from 'path';
import { XMLParser } from 'fast-xml-parser';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import { parseOrbeonXml } from './parser.js';
import { generateActionSyntax } from './generator.js';
import { validateMigration } from './validator.js';

// ─── Banner ──────────────────────────────────────────────────
function showBanner() {
  console.log('');
  console.log(chalk.cyan.bold('  ╔══════════════════════════════════════════════╗'));
  console.log(chalk.cyan.bold('  ║') + chalk.white.bold('   Orbeon Forms - Action Syntax Migrator  ') + chalk.cyan.bold('     ║'));
  console.log(chalk.cyan.bold('  ║') + chalk.gray('   Simple Actions → Action Syntax (2025.1+)') + chalk.cyan.bold('  ║'));
  console.log(chalk.cyan.bold('  ║') + chalk.gray('   Pattern: service-call → dataset → read  ') + chalk.cyan.bold('  ║'));
  console.log(chalk.cyan.bold('  ╚══════════════════════════════════════════════╝'));
  console.log('');
}

// ─── XML Parser Config ───────────────────────────────────────
const xmlParserOptions = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  preserveOrder: false,
  ignoreDeclaration: true,
  removeNSPrefix: false,
  parseAttributeValue: false,
  trimValues: true
};

// ─── Main Flow ───────────────────────────────────────────────
async function main() {
  showBanner();

  // Step 1: Get input file
  const { inputPath } = await inquirer.prompt([
    {
      type: 'input',
      name: 'inputPath',
      message: chalk.yellow('Path to Orbeon form XML file:'),
      validate: (val) => {
        const resolved = resolve(val.trim());
        if (!existsSync(resolved)) return `File not found: ${resolved}`;
        if (!resolved.endsWith('.xml') && !resolved.endsWith('.xhtml'))
          return 'File must be .xml or .xhtml';
        return true;
      }
    }
  ]);

  const resolvedPath = resolve(inputPath.trim());
  const spinner = ora('Reading and parsing XML...').start();

  let xmlContent, parsedXml;
  try {
    xmlContent = readFileSync(resolvedPath, 'utf-8');
    const parser = new XMLParser(xmlParserOptions);
    parsedXml = parser.parse(xmlContent);
    spinner.succeed('XML parsed successfully');
  } catch (err) {
    spinner.fail(`Failed to parse XML: ${err.message}`);
    process.exit(1);
  }

  // Step 2: Parse Simple Actions
  spinner.start('Extracting Simple Actions...');
  let parsed;
  try {
    parsed = parseOrbeonXml(parsedXml);
    spinner.succeed(
      `Found ${chalk.green(parsed.actions.length)} action(s) and ${chalk.green(parsed.services.length)} service(s)`
    );
  } catch (err) {
    spinner.fail(`Failed to extract actions: ${err.message}`);
    process.exit(1);
  }

  if (parsed.actions.length === 0) {
    console.log(chalk.yellow('\n⚠ No Simple Action bindings found in this file.'));
    console.log(chalk.gray('  Expected: <xf:action id="...-binding"> elements'));
    process.exit(0);
  }

  // Show discovered items
  console.log('');
  console.log(chalk.cyan.bold('  Discovered Services:'));
  for (const svc of parsed.services) {
    console.log(chalk.white(`    • ${svc.name} → ${svc.method.toUpperCase()} ${svc.resource}`));
  }

  console.log('');
  console.log(chalk.cyan.bold('  Discovered Actions:'));
  for (const action of parsed.actions) {
    const triggerInfo = action.trigger
      ? `triggered by "${action.trigger.controlName}"`
      : 'no trigger detected';
    const responseCount = action.responseActions.reduce(
      (sum, ra) => sum + ra.actions.length, 0
    );
    console.log(chalk.white(`    • ${action.name} (${triggerInfo}, ${responseCount} response mapping(s))`));
  }
  console.log('');

  // Step 3: Ask which actions to migrate
  const { selectedActions } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'selectedActions',
      message: chalk.yellow('Select actions to migrate:'),
      choices: parsed.actions.map(a => ({
        name: `${a.name} ${chalk.gray(`(${a.trigger?.controlName || 'no trigger'})`)}`,
        value: a.name,
        checked: true
      }))
    }
  ]);

  if (selectedActions.length === 0) {
    console.log(chalk.yellow('\nNo actions selected. Exiting.'));
    process.exit(0);
  }

  // Filter to selected actions
  const filteredParsed = {
    ...parsed,
    actions: parsed.actions.filter(a => selectedActions.includes(a.name))
  };

  // Step 4: Choose response access mode
  const { useDataset } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'useDataset',
      message: chalk.yellow('¿Usar patrón fr:dataset-write + fr:dataset() para acceder a la respuesta?') +
        chalk.gray('\n  (No = acceso directo con fr:service-result(), recomendado)'),
      default: false
    }
  ]);

  const migrationOptions = { useDataset };

  // Step 5: Generate Action Syntax
  spinner.start('Generating Action Syntax...');
  const generated = generateActionSyntax(filteredParsed, migrationOptions);
  spinner.succeed('Action Syntax generated');

  // Step 6: Validate
  spinner.start('Validating migration...');
  const validation = validateMigration(filteredParsed, generated, migrationOptions);
  if (validation.valid) {
    spinner.succeed('Validation passed');
  } else {
    spinner.warn('Validation completed with issues');
  }

  // Show validation results
  if (validation.issues.length > 0) {
    console.log('');
    console.log(chalk.cyan.bold('  Validation Results:'));
    for (const issue of validation.issues) {
      const icon = issue.level === 'error' ? chalk.red('✗')
        : issue.level === 'warning' ? chalk.yellow('⚠')
          : chalk.blue('ℹ');
      console.log(`    ${icon} ${issue.message}`);
      if (issue.suggestion) {
        console.log(chalk.gray(`      → ${issue.suggestion}`));
      }
    }
  }

  // Step 6: Show generated XML
  console.log('');
  console.log(chalk.cyan.bold('  ═══ Generated Action Syntax XML ═══'));
  console.log('');
  console.log(chalk.green(generated.fullXml));
  console.log('');

  // Step 7: Show migration report
  console.log(chalk.cyan.bold('  ═══ Migration Report ═══'));
  console.log('');
  for (const entry of generated.report) {
    console.log(chalk.white.bold(`  📋 ${entry.name}`));
    for (const change of entry.changes) {
      console.log(chalk.gray(`     ${change}`));
    }
    console.log('');
  }

  // Step 8: Save options
  const { saveOption } = await inquirer.prompt([
    {
      type: 'rawlist',
      name: 'saveOption',
      message: chalk.yellow('What would you like to save?'),
      choices: [
        { name: 'Save migrated XML snippet', value: 'snippet' },
        { name: 'Save full form with replacements', value: 'full' },
        { name: 'Save migration report', value: 'report' },
        { name: 'Save all (snippet + report)', value: 'all' },
        { name: 'Don\'t save, just copy from above', value: 'none' }
      ]
    }
  ]);

  const dir = dirname(resolvedPath);
  const base = basename(resolvedPath, '.xml').replace('.xhtml', '');
  const timestamp = new Date().toISOString().slice(0, 10);

  if (saveOption === 'snippet' || saveOption === 'all') {
    const snippetPath = join(dir, `${base}_action-syntax_${timestamp}.xml`);
    writeFileSync(snippetPath, generated.fullXml, 'utf-8');
    console.log(chalk.green(`  ✓ Snippet saved: ${snippetPath}`));
  }

  if (saveOption === 'full') {
    // Replace old bindings with new syntax in the original XML
    let modifiedXml = xmlContent;

    // Remove migrated action bindings
    for (const action of filteredParsed.actions) {
      modifiedXml = removeActionBinding(modifiedXml, action.id);
    }

    // Insert new syntax before </xf:model>
    const insertionPoint = '</xf:model>';
    modifiedXml = modifiedXml.replace(
      insertionPoint,
      `\n${generated.fullXml}\n\n${insertionPoint}`
    );

    const fullPath = join(dir, `${base}_migrated_${timestamp}.xml`);
    writeFileSync(fullPath, modifiedXml, 'utf-8');
    console.log(chalk.green(`  ✓ Full migrated form saved: ${fullPath}`));
  }

  if (saveOption === 'report' || saveOption === 'all') {
    const reportLines = [
      `Orbeon Migration Report - ${timestamp}`,
      `Source: ${resolvedPath}`,
      `Actions migrated: ${filteredParsed.actions.length}`,
      '',
      '═══ Changes ═══',
      ''
    ];

    for (const entry of generated.report) {
      reportLines.push(`📋 ${entry.name}`);
      for (const change of entry.changes) {
        reportLines.push(`   ${change}`);
      }
      reportLines.push('');
    }

    if (validation.issues.length > 0) {
      reportLines.push('═══ Validation Issues ═══');
      reportLines.push('');
      for (const issue of validation.issues) {
        reportLines.push(`[${issue.level.toUpperCase()}] ${issue.message}`);
        if (issue.suggestion) reportLines.push(`  → ${issue.suggestion}`);
      }
    }

    const reportPath = join(dir, `${base}_migration-report_${timestamp}.txt`);
    writeFileSync(reportPath, reportLines.join('\n'), 'utf-8');
    console.log(chalk.green(`  ✓ Report saved: ${reportPath}`));
  }

  console.log('');
  console.log(chalk.cyan.bold('  ✨ Migration complete!'));
  console.log(chalk.gray('  Remember to:'));
  console.log(chalk.gray('    1. Remove the old <xf:action id="...-binding"> blocks'));
  console.log(chalk.gray('    2. Keep the <xf:instance> and <xf:submission> for each service'));
  console.log(chalk.gray('    3. Place the new XML inside <xf:model id="fr-form-model">'));
  console.log(chalk.gray('    4. Test in Form Builder → Test'));
  console.log('');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Removes a <xf:action id="bindingId">...</xf:action> block from xml.
 * Handles nested <xf:action> elements by counting open/close depth.
 */
function removeActionBinding(xml, bindingId) {
  const OPEN = '<xf:action';
  const CLOSE = '</xf:action>';
  const idAttr = `id="${bindingId}"`;

  let pos = 0;
  while (pos < xml.length) {
    const start = xml.indexOf(OPEN, pos);
    if (start === -1) break;

    const tagEnd = xml.indexOf('>', start);
    if (tagEnd === -1) break;

    const openTag = xml.slice(start, tagEnd + 1);

    if (openTag.includes(idAttr)) {
      if (openTag.endsWith('/>')) {
        return xml.slice(0, start) + xml.slice(tagEnd + 1);
      }

      let depth = 1;
      let search = tagEnd + 1;

      while (depth > 0 && search < xml.length) {
        const nextOpen = xml.indexOf(OPEN, search);
        const nextClose = xml.indexOf(CLOSE, search);

        if (nextClose === -1) break;

        if (nextOpen !== -1 && nextOpen < nextClose) {
          const nestedTagEnd = xml.indexOf('>', nextOpen);
          const nestedTag = xml.slice(nextOpen, nestedTagEnd + 1);
          if (!nestedTag.endsWith('/>')) depth++;
          search = nextOpen + OPEN.length;
        } else {
          depth--;
          if (depth === 0) {
            return xml.slice(0, start) + xml.slice(nextClose + CLOSE.length);
          }
          search = nextClose + CLOSE.length;
        }
      }
      break;
    }

    pos = start + 1;
  }

  return xml;
}

main().catch(err => {
  console.error(chalk.red(`\nFatal error: ${err.message}`));
  process.exit(1);
});
