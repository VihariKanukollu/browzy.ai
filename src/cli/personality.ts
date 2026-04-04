/**
 * browzy.ai — Personality engine.
 *
 * Every string the user sees should make them feel something.
 * Progress, delight, curiosity, momentum.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ── Streak & Milestone Tracker ──────────────────────────────────

const STREAK_FILE = join(homedir(), '.browzy', 'streak.json');

interface StreakData {
  currentStreak: number;
  longestStreak: number;
  lastActiveDate: string; // YYYY-MM-DD
  totalSessions: number;
  totalSourcesAdded: number;
  totalQueriesAsked: number;
  milestonesSeen: string[];
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function loadStreak(): StreakData {
  try {
    if (existsSync(STREAK_FILE)) {
      return JSON.parse(readFileSync(STREAK_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }
  return {
    currentStreak: 0,
    longestStreak: 0,
    lastActiveDate: '',
    totalSessions: 0,
    totalSourcesAdded: 0,
    totalQueriesAsked: 0,
    milestonesSeen: [],
  };
}

function saveStreak(data: StreakData): void {
  mkdirSync(join(homedir(), '.browzy'), { recursive: true });
  writeFileSync(STREAK_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export function updateStreak(): StreakData {
  const data = loadStreak();
  const t = today();

  if (data.lastActiveDate === t) {
    // Already active today
    return data;
  }

  data.totalSessions++;

  if (data.lastActiveDate === yesterday()) {
    data.currentStreak++;
  } else if (data.lastActiveDate !== t) {
    data.currentStreak = 1;
  }

  if (data.currentStreak > data.longestStreak) {
    data.longestStreak = data.currentStreak;
  }

  data.lastActiveDate = t;
  saveStreak(data);
  return data;
}

export function recordSourceAdded(count = 1): void {
  const data = loadStreak();
  data.totalSourcesAdded += count;
  saveStreak(data);
}

export function recordQuery(): void {
  const data = loadStreak();
  data.totalQueriesAsked++;
  saveStreak(data);
}

// ── Milestones ──────────────────────────────────────────────────

interface Milestone {
  id: string;
  check: (stats: { sources: number; articles: number; concepts: number }, streak: StreakData) => boolean;
  message: string;
}

const MILESTONES: Milestone[] = [
  { id: 'first-source', check: (s) => s.sources >= 1, message: "Your first source is in. The journey begins." },
  { id: 'five-sources', check: (s) => s.sources >= 5, message: "5 sources ingested. Your browzy is starting to take shape." },
  { id: 'ten-articles', check: (s) => s.articles >= 10, message: "10 articles compiled. Your browzy knows things now." },
  { id: 'twenty-five-articles', check: (s) => s.articles >= 25, message: "25 articles. Your browzy is becoming a real knowledge base." },
  { id: 'fifty-articles', check: (s) => s.articles >= 50, message: "50 articles. You know more about this topic than most people alive." },
  { id: 'hundred-articles', check: (s) => s.articles >= 100, message: "100 articles. This is a serious research corpus. Respect." },
  { id: 'three-day-streak', check: (_s, d) => d.currentStreak >= 3, message: "3-day research streak. Don't break the chain." },
  { id: 'seven-day-streak', check: (_s, d) => d.currentStreak >= 7, message: "7-day streak. You're building a habit. This is how breakthroughs happen." },
  { id: 'thirty-day-streak', check: (_s, d) => d.currentStreak >= 30, message: "30-day streak. You're not just researching — you're compounding knowledge." },
  { id: 'ten-queries', check: (_s, d) => d.totalQueriesAsked >= 10, message: "10 questions asked. Your browzy is earning its keep." },
  { id: 'fifty-queries', check: (_s, d) => d.totalQueriesAsked >= 50, message: "50 questions deep. You and your browzy are in a groove." },
  { id: 'hundred-concepts', check: (s) => s.concepts >= 100, message: "100 concepts mapped. Your browzy has a real knowledge graph now." },
];

export function checkMilestones(
  stats: { sources: number; articles: number; concepts: number }
): string | null {
  const streak = loadStreak();
  const seen = new Set(streak.milestonesSeen);

  for (const m of MILESTONES) {
    if (!seen.has(m.id) && m.check(stats, streak)) {
      streak.milestonesSeen.push(m.id);
      saveStreak(streak);
      return m.message;
    }
  }

  return null;
}

// ── Playful Loading Messages ────────────────────────────────────

const THINKING_MESSAGES = [
  'Digging through your notes...',
  'Following the thread...',
  'Connecting dots...',
  'Searching your knowledge...',
  'Reading between the lines...',
  'Pulling it all together...',
  'Tracing the connections...',
  'Going down the rabbit hole...',
];

const INGESTING_MESSAGES = [
  'Absorbing new knowledge...',
  'Feeding your browzy...',
  'Adding to the collection...',
  'Digesting this one...',
  'Learning something new...',
];

const COMPILING_MESSAGES = [
  'Weaving new knowledge in...',
  'Connecting the new with the old...',
  'Building bridges between ideas...',
  'Making sense of it all...',
  'Your browzy is growing...',
];

const HEALTH_MESSAGES = [
  'Running a checkup...',
  'Inspecting the knowledge graph...',
  'Looking for loose threads...',
  'Checking the foundations...',
];

export function getThinkingMessage(): string {
  return THINKING_MESSAGES[Math.floor(Math.random() * THINKING_MESSAGES.length)];
}

export function getIngestingMessage(): string {
  return INGESTING_MESSAGES[Math.floor(Math.random() * INGESTING_MESSAGES.length)];
}

export function getCompilingMessage(): string {
  return COMPILING_MESSAGES[Math.floor(Math.random() * COMPILING_MESSAGES.length)];
}

export function getHealthMessage(): string {
  return HEALTH_MESSAGES[Math.floor(Math.random() * HEALTH_MESSAGES.length)];
}

// ── Post-Action Rewards ─────────────────────────────────────────

export function getAddReward(
  title: string,
  articlesCreated: number,
  articlesUpdated: number,
  totalArticles: number
): string {
  const parts: string[] = [];

  if (articlesCreated > 0 && articlesUpdated > 0) {
    parts.push(`Your browzy just learned about ${title}. ${articlesCreated} new articles, ${articlesUpdated} enriched.`);
  } else if (articlesCreated > 0) {
    parts.push(`Your browzy just learned about ${title}. ${articlesCreated} new article${articlesCreated > 1 ? 's' : ''} created.`);
  } else if (articlesUpdated > 0) {
    parts.push(`${title} deepened ${articlesUpdated} existing article${articlesUpdated > 1 ? 's' : ''}.`);
  }

  if (totalArticles > 0) {
    parts.push(`Total: ${totalArticles} articles and growing.`);
  }

  return parts.join(' ');
}

export function getQueryReward(sourcesUsed: number): string {
  if (sourcesUsed === 0) return '';
  if (sourcesUsed === 1) return 'Pulled from 1 article.';
  if (sourcesUsed <= 3) return `Pulled from ${sourcesUsed} articles.`;
  return `Synthesized across ${sourcesUsed} articles. Your browzy is earning its keep.`;
}

// ── Exit Messages ───────────────────────────────────────────────

const EXIT_MESSAGES = [
  "See you tomorrow. Your browzy will be here.",
  "Good session. The knowledge compounds.",
  "Until next time. Your research isn't going anywhere.",
  "Saved. Your future self will thank you.",
  "Closing up. Every session makes your browzy smarter.",
  "Later. Don't forget — consistency beats intensity.",
];

export function getExitMessage(streak: StreakData): string {
  if (streak.currentStreak >= 3) {
    return `${streak.currentStreak}-day streak. See you tomorrow — don't break the chain.`;
  }
  return EXIT_MESSAGES[Math.floor(Math.random() * EXIT_MESSAGES.length)];
}

// ── Empty State Messages ────────────────────────────────────────

export function getEmptyStateMessage(): string {
  return "A blank canvas. Add your first source with /add and watch the magic happen.";
}

// ── Health Reward ───────────────────────────────────────────────

export function getHealthReward(errors: number, warnings: number, suggestions: number): string {
  const total = errors + warnings + suggestions;
  if (total === 0) return "Clean bill of health. Your browzy is in great shape.";
  if (errors > 0) return `Found ${errors} issue${errors > 1 ? 's' : ''} that need attention. Your browzy will be better for it.`;
  if (warnings > 0) return `Mostly healthy. ${warnings} small thing${warnings > 1 ? 's' : ''} to tighten up.`;
  return `Looking good. ${suggestions} idea${suggestions > 1 ? 's' : ''} to make your browzy even better.`;
}
