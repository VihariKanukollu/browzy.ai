import * as readline from 'readline';
import { mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import chalk from 'chalk';
import ora from 'ora';

const p = chalk.hex('#6C3BAA');
const pb = chalk.hex('#6C3BAA').bold;
const accent = chalk.hex('#C084FC');
const dim = chalk.hex('#7A7A8C');

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

function askSecret(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    const output = (rl as any).output as NodeJS.WritableStream;
    let muted = false;
    const origWrite = output.write.bind(output);
    // Suppress echo by intercepting output.write while readline reads input
    output.write = ((chunk: any, ...args: any[]) => {
      if (muted) return true;
      return origWrite(chunk, ...args);
    }) as typeof output.write;
    rl.question(question, (answer) => {
      muted = false;
      output.write = origWrite;
      output.write('\n');
      resolve(answer.trim());
    });
    muted = true;
  });
}

// ── User Profile ────────────────────────────────────────────────

export interface UserProfile {
  name: string;
  createdAt: string;
  lastSeen: string;
  sessionCount: number;
}

function getProfilePath(): string {
  return join(homedir(), '.browzy', 'profile.json');
}

export function loadProfile(): UserProfile | null {
  const path = getProfilePath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

export function saveProfile(profile: UserProfile): void {
  mkdirSync(join(homedir(), '.browzy'), { recursive: true });
  writeFileSync(getProfilePath(), JSON.stringify(profile, null, 2), 'utf-8');
}

export function touchProfile(): UserProfile | null {
  const profile = loadProfile();
  if (!profile) return null;
  profile.lastSeen = new Date().toISOString();
  profile.sessionCount++;
  saveProfile(profile);
  return profile;
}

// ── Welcome Back Messages ───────────────────────────────────────

export function getWelcomeMessage(profile: UserProfile, stats?: { sources: number; articles: number }): string {
  const hour = new Date().getHours();
  const name = profile.name;
  const count = profile.sessionCount;

  const vibe =
    hour < 6 ? 'late-night' :
    hour < 12 ? 'morning' :
    hour < 17 ? 'afternoon' :
    hour < 21 ? 'evening' :
    'late-night';

  // First time — excitement
  if (count <= 1) {
    return `Hey ${name}! Welcome to browzy. Let's build something you'll keep coming back to.`;
  }

  // Second and third — reinforcement
  if (count <= 3) {
    const early = [
      `${name}! You're back. That's how it starts.`,
      `Welcome back, ${name}. Your browzy remembered everything.`,
    ];
    return early[(count - 2) % early.length];
  }

  // Regular user (4-15) — build the relationship
  const regular = [
    `Hey ${name}. What caught your curiosity today?`,
    `${name}! Your browzy has ${stats?.articles || 'some'} articles waiting for you.`,
    `Welcome back. Every session makes your browzy a little smarter.`,
    `${name}. Ready to go deeper?`,
    vibe === 'morning' ? `Morning, ${name}. Fresh brain, fresh research.` :
    vibe === 'late-night' ? `Late night, ${name}? The best ideas come after midnight.` :
    `${name}. Let's make today's research count.`,
  ];
  if (count <= 15) return regular[count % regular.length];

  // Power user (15+) — they're hooked, be their research partner
  const power = [
    `${name}. The knowledge compounds.`,
    `Another day, another rabbit hole. Let's go, ${name}.`,
    `${name}. Your browzy has been thinking about you.`,
    `Back at it. What are we chasing today, ${name}?`,
    vibe === 'morning' ? `Morning, ${name}. Your browzy is warmed up and ready.` :
    vibe === 'late-night' ? `Midnight research mode. Respect, ${name}.` :
    `${name}. Your future self is going to love this session.`,
    `${name}. ${stats?.articles || 0} articles deep and counting. What's next?`,
  ];
  return power[count % power.length];
}

function getTimeSince(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'a few minutes';
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '1 day';
  return `${days} days`;
}

// ── Model Fetching ──────────────────────────────────────────────

interface ModelOption {
  id: string;
  name: string;
}

async function fetchClaudeModels(apiKey: string): Promise<ModelOption[]> {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });
    const page = await client.models.list({ limit: 50 });

    return page.data
      .filter((m: { id: string }) =>
        m.id.startsWith('claude') && !m.id.includes('instant')
      )
      .sort((a: { created_at: string }, b: { created_at: string }) =>
        b.created_at.localeCompare(a.created_at)
      )
      .map((m: { id: string; display_name: string }) => ({
        id: m.id,
        name: m.display_name,
      }));
  } catch {
    // Fallback if API call fails
    return [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
      { id: 'claude-haiku-4-20250414', name: 'Claude Haiku 4' },
    ];
  }
}

async function fetchOpenAIModels(apiKey: string): Promise<ModelOption[]> {
  try {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey });
    const list = await client.models.list();

    return Array.from(list.data)
      .filter((m: { id: string }) => m.id.startsWith('gpt-'))
      .sort((a: { id: string }, b: { id: string }) => b.id.localeCompare(a.id))
      .slice(0, 10)
      .map((m: { id: string }) => ({
        id: m.id,
        name: m.id,
      }));
  } catch {
    return [
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    ];
  }
}

// ── Onboarding Flow ─────────────────────────────────────────────

export async function runOnboarding(): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log();
  console.log(pb('  Welcome to browzy.ai'));
  console.log(dim('  Your personal, LLM-powered knowledge base.\n'));

  // Step 1: Name
  console.log(p('  1/3 ') + chalk.white('What\'s your name?'));
  const userName = await ask(rl, p('  › '));
  if (!userName) {
    console.log(dim('\n  Setup cancelled.'));
    rl.close();
    return false;
  }

  console.log();
  console.log(accent(`  Hey ${userName}! Let's get you set up.`));

  // Step 2: API key
  console.log();
  console.log(p('  2/3 ') + chalk.white('Connect your Claude API key'));
  console.log(dim('       Get one at console.anthropic.com/settings/keys'));

  const existingKey = process.env.ANTHROPIC_API_KEY;
  let apiKey = existingKey || '';

  if (existingKey) {
    console.log(chalk.green('  ✓ ') + 'Found ANTHROPIC_API_KEY in environment');
  } else {
    console.log(dim('       (input will be hidden)'));
    apiKey = await askSecret(rl, p('  › '));
    if (!apiKey) {
      console.log(dim('  Skipped — you can set ANTHROPIC_API_KEY later in .env'));
    } else if (!apiKey.startsWith('sk-ant-')) {
      console.log(chalk.yellow('  ⚠ ') + 'Key doesn\'t look like an Anthropic key (expected sk-ant-... prefix)');
      console.log(dim('    Saving anyway — update in .env if this was a mistake'));
    }
  }

  // Step 3: Pick model (fetch live from API)
  let selectedModel = 'claude-sonnet-4-20250514';

  if (apiKey) {
    console.log();
    console.log(p('  3/3 ') + chalk.white('Choose your model'));

    const spin = ora({ text: dim('fetching available models...'), color: 'white', spinner: 'dots' });
    spin.start();

    const models = await fetchClaudeModels(apiKey);

    spin.stop();

    if (models.length > 0) {
      console.log();
      models.forEach((m, i) => {
        const marker = m.id === selectedModel ? chalk.green(' (recommended)') : '';
        console.log(dim(`       [${i + 1}] `) + chalk.white(m.name) + dim(` — ${m.id}`) + marker);
      });

      const modelChoice = await ask(rl, p('  › '));
      const idx = parseInt(modelChoice, 10) - 1;
      if (idx >= 0 && idx < models.length) {
        selectedModel = models[idx].id;
      }
      console.log(chalk.green('  ✓ ') + `Using ${selectedModel}`);
    } else {
      console.log(dim('  Could not fetch models. Using default: ') + chalk.white(selectedModel));
    }
  } else {
    console.log();
    console.log(p('  3/3 ') + chalk.white('Model'));
    console.log(dim(`       Defaulting to ${selectedModel} (change later in config)`));
  }

  rl.close();

  // ── Create everything ───────────────────────────────────────

  const dataDir = join(homedir(), '.browzy', 'default');

  const spin = ora({ text: dim('setting up...'), color: 'white', spinner: 'dots' });
  spin.start();

  // Create data dirs
  for (const dir of [
    dataDir,
    join(dataDir, 'raw'),
    join(dataDir, 'raw', 'images'),
    join(dataDir, 'wiki'),
    join(dataDir, 'output'),
    join(dataDir, '.browzy'),
  ]) {
    mkdirSync(dir, { recursive: true });
  }

  // Save user profile
  const profile: UserProfile = {
    name: userName,
    createdAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    sessionCount: 1,
  };
  saveProfile(profile);

  // Write config to ~/.browzy/config.json
  const browzyDir = join(homedir(), '.browzy');
  mkdirSync(browzyDir, { recursive: true });
  const configPath = join(browzyDir, 'config.json');
  if (!existsSync(configPath)) {
    const config = {
      dataDir,
      llm: {
        provider: 'claude',
        model: selectedModel,
      },
      compile: {
        batchSize: 20,
        extractConcepts: true,
      },
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  // Write .env to ~/.browzy/.env if key was provided and not in env
  if (apiKey && !existingKey) {
    const envPath = join(browzyDir, '.env');
    if (existsSync(envPath)) {
      appendFileSync(envPath, `\nANTHROPIC_API_KEY=${apiKey}\n`);
    } else {
      writeFileSync(envPath, `ANTHROPIC_API_KEY=${apiKey}\n`, { mode: 0o600 });
    }
    chmodSync(envPath, 0o600);
  }

  spin.stop();

  // ── Done! ─────────────────────────────────────────────────────

  console.log();
  console.log(p('  ─────────────────────────────────────────────────────'));
  console.log();
  console.log(chalk.green('  ✓ ') + chalk.white.bold(`You're all set, ${userName}!`));
  console.log(dim(`    data: ${dataDir}`));
  console.log(dim(`    model: ${selectedModel}`));
  console.log();
  console.log(dim('  Get started:'));
  console.log(`  ${accent('/add')}  ${dim('paste a URL or drag a file to add your first source')}`);
  console.log(`  ${dim('then just type a question to start exploring')}`);
  console.log();

  return true;
}

/**
 * Check if onboarding is needed (no profile exists).
 */
export function needsOnboarding(): boolean {
  return loadProfile() === null;
}
