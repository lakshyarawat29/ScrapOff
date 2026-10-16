#!/usr/bin/env node

/**
 * ScrapOff — ChatGPT Terminal Scraper
 * Automates chatgpt.com using Playwright and prints responses to the terminal.
 */

const { chromium } = require('playwright');
const readline = require('readline');
const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, 'session.json');

// ─── ANSI colours ────────────────────────────────────────────────────────────
const C = {
  reset:   '\x1b[0m',
  dim:     '\x1b[2m',
  cyan:    '\x1b[36m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  magenta: '\x1b[35m',
  red:     '\x1b[31m',
  gray:    '\x1b[90m',
  white:   '\x1b[97m',
};
const c = (color, text) => `${C[color]}${text}${C.reset}`;

// ─── Banner ───────────────────────────────────────────────────────────────────
function printBanner() {
  console.log('');
  console.log(c('cyan',    '  ███████╗ ██████╗██████╗  █████╗ ██████╗  ██████╗ ███████╗███████╗'));
  console.log(c('cyan',    '  ██╔════╝██╔════╝██╔══██╗██╔══██╗██╔══██╗██╔═══██╗██╔════╝██╔════╝'));
  console.log(c('magenta', '  ███████╗██║     ██████╔╝███████║██████╔╝██║   ██║█████╗  █████╗  '));
  console.log(c('magenta', '  ╚════██║██║     ██╔══██╗██╔══██║██╔═══╝ ██║   ██║██╔══╝  ██╔══╝  '));
  console.log(c('cyan',    '  ███████║╚██████╗██║  ██║██║  ██║██║     ╚██████╔╝██║     ██║     '));
  console.log(c('cyan',    '  ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝      ╚═════╝ ╚═╝     ╚═╝     '));
  console.log('');
  console.log(c('gray', '  ChatGPT Terminal Scraper  ·  powered by Playwright'));
  console.log('');
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

function startSpinner(text) {
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let i = 0;
  const iv = setInterval(() => {
    process.stdout.write(`\r${c('cyan', frames[i++ % frames.length])}  ${c('dim', text)}`);
  }, 100);
  return () => { clearInterval(iv); process.stdout.write('\r\x1b[K'); };
}

// ─── Safe evaluate — never throws, always returns fallback ────────────────────
async function safeEval(page, fn, fallback) {
  try { return await page.evaluate(fn); }
  catch { return fallback; }
}

// ─── Find the ChatGPT input with multiple selector fallbacks ──────────────────
// Returns { selector, element } or null. Tries real ID first, then broader ones.
async function findChatInput(page) {
  const selectors = [
    '#prompt-textarea',
    'div[contenteditable="true"]',
    '[data-testid="composer-input"]',
    'textarea[tabindex="0"]',
    'textarea',
  ];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      const count = await el.count();
      if (count > 0) return sel;
    } catch { /* keep trying */ }
  }
  return null;
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  printBanner();

  // ── Launch ────────────────────────────────────────────────────────────────
  const stopLaunch = startSpinner('Launching Chromium ...');
  const browser = await chromium.launch({ headless: false, slowMo: 20 });

  // Load saved session if it exists (skips login entirely)
  const hasSession = fs.existsSync(SESSION_FILE);
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    ...(hasSession ? { storageState: SESSION_FILE } : {}),
  });
  const page = await context.newPage();
  stopLaunch();

  if (hasSession) {
    console.log(c('green', '  Saved session found — skipping login.'));
  } else {
    console.log(c('yellow', '  No saved session. You will need to log in once.'));
  }

  // ── Navigate ─────────────────────────────────────────────────────────────
  const stopNav = startSpinner('Opening chatgpt.com ...');
  try {
    await page.goto('https://chatgpt.com', { waitUntil: 'commit', timeout: 30000 });
  } catch { /* redirect mid-load is fine */ }
  stopNav();

  // ── Wait for login + input — poll in a loop, show URL for debugging ────────
  if (!hasSession) {
    console.log(c('yellow', '\n  Log in to ChatGPT in the browser window that just opened.'));
    console.log(c('gray',   '  Polling every 3s. Waiting up to 5 minutes ...\n'));
  }

  let inputSel = null;
  const deadline = Date.now() + 5 * 60 * 1000;
  let lastUrl = '';

  while (Date.now() < deadline) {
    await sleep(3000);

    // Show current URL so user can see where the browser is
    const url = await safeEval(page, () => window.location.href, '');
    if (url && url !== lastUrl) {
      process.stdout.write('\r\x1b[K');
      console.log(c('gray', `  Browser: ${url}`));
      lastUrl = url;
    }

    inputSel = await findChatInput(page);
    if (inputSel) break;
  }

  if (!inputSel) {
    console.log(c('red', '\n  Timed out — could not find a chat input. Make sure you are logged in.\n'));
    await browser.close();
    process.exit(1);
  }

  // ── Save session for next run ─────────────────────────────────────────────
  await context.storageState({ path: SESSION_FILE });
  console.log(c('gray', `  Session saved to session.json (reused on next run).`));

  console.log(c('green', `\n  ChatGPT ready! (input selector: ${inputSel})\n`));
  console.log(c('gray',  '  Type a message and hit Enter. Type "exit" to quit.\n'));

  // ── Conversation loop ─────────────────────────────────────────────────────
  while (true) {
    const userInput = await ask(c('cyan', '  You > '));
    if (!userInput || ['exit', 'quit', 'q'].includes(userInput.toLowerCase())) {
      console.log(c('gray', '\n  Goodbye!\n'));
      break;
    }

    // Snapshot current page text length so we know when NEW content arrives
    const prevTextLen = await safeEval(
      page,
      () => document.body?.innerText?.length ?? 0,
      0
    );

    // ── Type and submit ───────────────────────────────────────────────────────
    try {
      // Re-find in case the page navigated (new chat, etc.)
      inputSel = (await findChatInput(page)) ?? inputSel;

      const el = page.locator(inputSel).first();
      await el.click();
      await sleep(150);

      // Clear existing text
      await page.keyboard.press('Meta+a');
      await page.keyboard.press('Backspace');
      await sleep(100);

      // Type message (keyboard events work with React/contenteditable)
      await page.keyboard.type(userInput, { delay: 20 });
      await sleep(400);
      await page.keyboard.press('Enter');
    } catch (err) {
      console.log(c('red', `  Could not type message: ${err.message}\n`));
      continue;
    }

    // ── Phase 1: wait for ChatGPT to START generating (stop-btn appears) ──────
    const stopWaitReply = startSpinner('Waiting for ChatGPT to start replying ...');
    let replyStarted = false;
    const replyDeadline = Date.now() + 90_000;

    while (Date.now() < replyDeadline) {
      await sleep(600);

      // Method A: stop button appeared → ChatGPT is generating
      const hasStopBtn = await safeEval(page, () => !!(
        document.querySelector('button[data-testid="stop-button"]')    ||
        document.querySelector('button[aria-label="Stop generating"]')  ||
        document.querySelector('[aria-label="Stop streaming"]')
      ), false);
      if (hasStopBtn) { replyStarted = true; break; }

      // Method B: page text grew — new content arrived even if stop-btn wasn't caught
      const curLen = await safeEval(page, () => document.body?.innerText?.length ?? 0, 0);
      if (curLen > prevTextLen + 30) { replyStarted = true; break; }
    }
    stopWaitReply();

    if (!replyStarted) {
      console.log(c('red', '  No reply detected — the message may not have been sent. Try again.\n'));
      continue;
    }

    // ── Phase 2: wait for ChatGPT to FINISH (stop-btn disappears) ────────────
    const stopWaitStream = startSpinner('ChatGPT is writing ...');
    const streamDeadline = Date.now() + 180_000;

    while (Date.now() < streamDeadline) {
      await sleep(800);
      const stillStreaming = await safeEval(page, () => !!(
        document.querySelector('button[data-testid="stop-button"]')    ||
        document.querySelector('button[aria-label="Stop generating"]')  ||
        document.querySelector('[aria-label="Stop streaming"]')
      ), false); // default false = assume done on error
      if (!stillStreaming) break;
    }
    stopWaitStream();

    await sleep(1000); // buffer for final tokens

    // ── Scrape last assistant message — try multiple selector strategies ────────
    const response = await safeEval(page, () => {
      const getText = (sel) => {
        const els = document.querySelectorAll(sel);
        return els.length ? els[els.length - 1].innerText.trim() : null;
      };
      return (
        getText('[data-message-author-role="assistant"]') ||
        getText('article')                               ||
        getText('[class*="markdown"]')                   ||
        getText('.prose')                                ||
        getText('[class*="prose"]')                      ||
        getText('[class*="message"]')                    ||
        ''
      );
    }, '');

    if (!response) {
      console.log(c('yellow', '  (Empty response — check the browser window)\n'));
      continue;
    }

    console.log('');
    console.log(c('magenta', '  ── ChatGPT ──────────────────────────────────────────────────────────'));
    console.log('');
    response.split('\n').forEach(line => console.log(c('white', `  ${line}`)));
    console.log('');
    console.log(c('magenta', '  ──────────────────────────────────────────────────────────────────────'));
    console.log('');
  }

  await browser.close();
}

main().catch(err => {
  console.error(c('red', `\n  Fatal error: ${err.message}\n`));
  process.exit(1);
});
