import * as readline from 'readline';
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
import ora from 'ora';

const p = chalk.hex('#6C3BAA');
const pb = chalk.hex('#6C3BAA').bold;
const pl = chalk.hex('#9B6ED8');
const accent = chalk.hex('#C084FC');
const dim = chalk.hex('#7A7A8C');

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

export async function runOnboarding(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log();
  console.log(pb('  Welcome to browzy.ai'));
  console.log(dim('  Let\'s set up your first knowledge base.\n'));

  // Step 1: Name
  console.log(p('  1/3 ') + chalk.white('What\'s this knowledge base about?'));
  console.log(dim('       e.g. "ml-research", "startup-notes", "cooking"'));
  const name = await prompt(rl, p('  › '));
  if (!name) {
    console.log(dim('\n  Setup cancelled.'));
    rl.close();
    return false;
  }

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const dataDir = join(homedir(), '.browzy', slug);

  // Step 2: LLM provider
  console.log();
  console.log(p('  2/3 ') + chalk.white('Which LLM provider?'));
  console.log(dim('       [1] Claude (recommended)'));
  console.log(dim('       [2] OpenAI'));
  const providerChoice = await prompt(rl, p('  › '));
  const provider = providerChoice === '2' ? 'openai' : 'claude';
  const envVar = provider === 'claude' ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY';

  // Step 3: API key
  console.log();
  const existingKey = process.env[envVar];
  let apiKey = existingKey || '';

  if (existingKey) {
    console.log(p('  3/3 ') + chalk.white('API key'));
    console.log(chalk.green('  ✓ ') + `Found ${envVar} in environment`);
  } else {
    console.log(p('  3/3 ') + chalk.white(`Enter your ${provider === 'claude' ? 'Anthropic' : 'OpenAI'} API key`));
    console.log(dim(`       Get one at ${provider === 'claude' ? 'console.anthropic.com' : 'platform.openai.com'}`));
    apiKey = await prompt(rl, p('  › '));
    if (!apiKey) {
      console.log(dim('\n  No API key provided. You can set it later in .env'));
    }
  }

  rl.close();

  // Create everything
  const spin = ora({ text: dim('setting up...'), color: 'white', spinner: 'dots' });
  spin.start();

  // Create data dirs
  const dirs = [
    dataDir,
    join(dataDir, 'raw'),
    join(dataDir, 'raw', 'images'),
    join(dataDir, 'wiki'),
    join(dataDir, 'output'),
    join(dataDir, '.browzy'),
  ];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }

  // Write config
  const configPath = join(process.cwd(), 'browzy.config.json');
  if (!existsSync(configPath)) {
    const config = {
      dataDir,
      llm: {
        provider,
        model: provider === 'claude' ? 'claude-sonnet-4-20250514' : 'gpt-4o',
      },
      compile: {
        batchSize: 20,
        extractConcepts: true,
      },
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  // Write .env if key was provided and not already in env
  if (apiKey && !existingKey) {
    const envPath = join(process.cwd(), '.env');
    const envContent = existsSync(envPath)
      ? '\n' + `${envVar}=${apiKey}\n`
      : `${envVar}=${apiKey}\n`;

    if (existsSync(envPath)) {
      const { appendFileSync } = await import('fs');
      appendFileSync(envPath, envContent);
    } else {
      writeFileSync(envPath, envContent);
    }
  }

  spin.stop();

  // Done!
  console.log();
  console.log(p('  ─────────────────────────────────────────────────────'));
  console.log();
  console.log(chalk.green('  ✓ ') + chalk.white.bold(`"${name}" knowledge base is ready`));
  console.log(dim(`    data: ${dataDir}`));
  console.log(dim(`    provider: ${provider}`));
  console.log();
  console.log(dim('  Get started:'));
  console.log(`  ${accent('/add')} ${dim('paste a URL or drag a file to add your first source')}`);
  console.log(`  ${dim('then just type a question to ask your knowledge base')}`);
  console.log();

  return true;
}

/**
 * Check if onboarding is needed (no config file found).
 */
export function needsOnboarding(): boolean {
  const candidates = [
    join(process.cwd(), 'browzy.config.json'),
    join(homedir(), '.browzy', 'config.json'),
  ];
  return !candidates.some(p => existsSync(p));
}
