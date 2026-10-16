#!/usr/bin/env node

/**
 * ScrapOff — ChatGPT Terminal Scraper
 * Opens chatgpt.com, types your prompt, waits for the response to stabilize,
 * then prints everything (including code) to the terminal.
 */

const { chromium } = require('playwright');
const readline = require('readline');

// ─── ANSI colours ────────────────────────────────────────────────────────────
const C = {
  reset:   '\x1b[0m',
  dim:     '\x1b[2m',
  cyan:    '\x1b[36m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  magenta: '\x1b[35m',
  blue:    '\x1b[34m',
  red:     '\x1b[31m',
  gray:    '\x1b[90m',
  white:   '\x1b[97m',
};
const c = (color, txt) => `${C[color]}${txt}${C.reset}`;

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

function ask(ques) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(ques, ans => { rl.close(); res(ans.trim()); }));
}

function startSpinner(text) {
  const f = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let i = 0;
  const iv = setInterval(() =>
    process.stdout.write(`\r${c('cyan', f[i++ % f.length])}  ${c('dim', text)}`), 100);
  return () => { clearInterval(iv); process.stdout.write('\r\x1b[K'); };
}

// ─── Safe page.evaluate — never throws ───────────────────────────────────────
async function se(page, fn, fallback) {
  try { return await page.evaluate(fn); }
  catch { return fallback; }
}

// ─── Get page's full visible text ─────────────────────────────────────────────
const pageText = page => se(page, () => document.body?.innerText ?? '', '');

// ─── Wait for the response text to stabilize ─────────────────────────────────
// Poll every 1 s; if text hasn't changed for 4 consecutive polls → done.
async function waitForStable(page, growDeadlineMs = 90_000, stableMs = 120_000) {
  // Phase 1 — wait for new text to START appearing
  const initialLen = (await pageText(page)).length;
  const growDeadline = Date.now() + growDeadlineMs;
  let grew = false;

  while (Date.now() < growDeadline) {
    await sleep(700);
    const len = (await pageText(page)).length;
    if (len > initialLen + 80) { grew = true; break; }
  }

  if (!grew) return null; // nothing appeared

  // Phase 2 — wait for text to STOP changing (stable for 4 s)
  let prev = '';
  let stableCount = 0;
  const stableDeadline = Date.now() + stableMs;

  while (Date.now() < stableDeadline) {
    await sleep(1000);
    const cur = await pageText(page);
    if (cur && cur === prev) {
      stableCount++;
      if (stableCount >= 4) return cur;
    } else {
      stableCount = 0;
      prev = cur;
    }
  }
  return prev; // return whatever we have
}

// ─── Extract just the assistant reply from the full page text ─────────────────
// Strategy: find the last occurrence of the user's message and take everything after.
function extractReply(fullText, userMsg) {
  // Match the first 40 chars of the user message to locate it
  const probe = userMsg.substring(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = [...fullText.matchAll(new RegExp(probe, 'g'))];
  if (matches.length === 0) return fullText.slice(-3000).trim();

  const lastMatch = matches[matches.length - 1];
  const after = fullText.slice(lastMatch.index + userMsg.length).trim();

  // Remove trailing UI boilerplate (like "ChatGPT can make mistakes...")
  return after
    .replace(/\nChatGPT can make mistakes\..*$/s, '')
    .replace(/\nThis content may violate.*$/s, '')
    .trim();
}

// ─── Find and click the chat input ───────────────────────────────────────────
async function clickInput(page) {
  const SELS = [
    '#prompt-textarea',
    'div[contenteditable="true"]',
    'textarea[tabindex="0"]',
    'textarea[placeholder]',
    'textarea',
  ];
  for (const sel of SELS) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        await el.click({ timeout: 3000 });
        return sel;
      }
    } catch { /* try next */ }
  }
  return null;
}

// ─── Submit the message ───────────────────────────────────────────────────────
async function sendMessage(page, text) {
  // Find and click the input
  const sel = await clickInput(page);
  if (!sel) throw new Error('Could not find a chat input on the page.');

  await sleep(200);

  // Clear any existing text
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Backspace');
  await sleep(100);

  // Type naturally (works with React + contenteditable)
  await page.keyboard.type(text, { delay: 18 });
  await sleep(350);

  // Try clicking the send button first; fall back to Enter key
  try {
    const sendBtn = page.locator(
      'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send message"]'
    ).first();
    if (await sendBtn.count() > 0) {
      await sendBtn.click({ timeout: 3000 });
      return;
    }
  } catch { /* fall through to Enter */ }

  await page.keyboard.press('Enter');
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  printBanner();

  // Launch
  const stopLaunch = startSpinner('Launching Chromium ...');
  const browser = await chromium.launch({ headless: false, slowMo: 20 });
  const context  = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();
  stopLaunch();

  // Navigate
  const stopNav = startSpinner('Opening chatgpt.com ...');
  try { await page.goto('https://chatgpt.com', { waitUntil: 'commit', timeout: 30000 }); }
  catch { /* redirect is fine */ }
  stopNav();

  // Wait for a chat input to appear (up to 5 min — covers login if needed)
  console.log(c('gray', '  Waiting for the chat input to appear ...\n'));
  const stopWait = startSpinner('Loading ChatGPT ...');
  let inputSel = null;
  const deadline = Date.now() + 5 * 60 * 1000;

  while (Date.now() < deadline) {
    await sleep(2000);
    // Show URL changes
    const url = await se(page, () => location.href, '');
    if (url && url !== (inputSel ?? '')) {
      process.stdout.write('\r\x1b[K');
      console.log(c('gray', `  → ${url}`));
    }
    inputSel = await clickInput(page).catch(() => null);
    if (inputSel) break;
  }
  stopWait();

  if (!inputSel) {
    console.log(c('red', '\n  Timed out — no chat input found.\n'));
    await browser.close();
    process.exit(1);
  }

  console.log(c('green', `  Ready! Type a message below. Type "exit" to quit.\n`));

  // ── Conversation loop ─────────────────────────────────────────────────────
  while (true) {
    const userInput = await ask(c('cyan', '  You > '));
    if (!userInput || ['exit', 'quit', 'q'].includes(userInput.toLowerCase())) {
      console.log(c('gray', '\n  Goodbye!\n'));
      break;
    }

    // Send
    try {
      await sendMessage(page, userInput);
    } catch (err) {
      console.log(c('red', `  Send failed: ${err.message}\n`));
      continue;
    }

    // Wait for the response to appear and stabilize
    const stopSpin = startSpinner('ChatGPT is thinking ...');
    const fullText = await waitForStable(page);
    stopSpin();

    if (!fullText) {
      console.log(c('yellow', '  (No response detected — check the browser)\n'));
      continue;
    }

    const response = extractReply(fullText, userInput);

    if (!response) {
      console.log(c('yellow', '  (Could not extract reply — check the browser)\n'));
      continue;
    }

    // ── Print ────────────────────────────────────────────────────────────────
    console.log('');
    console.log(c('magenta', '  ── ChatGPT ──────────────────────────────────────────────────────────'));
    console.log('');
    response.split('\n').forEach(line => console.log(c('white', `  ${line}`)));
    console.log('');
    console.log(c('magenta', '  ──────────────────────────────────────────────────────────────────────'));

    // ── Stats ────────────────────────────────────────────────────────────────
    const clean = response
      .replace(/\[image[^\]]*\]/gi, '')
      .replace(/!\[.*?\]\(.*?\)/g, '')
      .trim();
    const words    = clean.split(/\s+/).filter(Boolean).length;
    const chars    = clean.replace(/\s/g, '').length;
    const readMins = Math.max(1, Math.round(words / 200));

    console.log(
      c('gray', '\n  📊  ') +
      c('cyan',    `${words.toLocaleString()} words`) +
      c('gray',    '  ·  ') +
      c('blue',    `${chars.toLocaleString()} chars`) +
      c('gray',    '  ·  ') +
      c('magenta', `~${readMins} min read`)
    );
    console.log('');
  }

  await browser.close();
}

main().catch(err => {
  console.error(c('red', `\n  Fatal error: ${err.message}\n`));
  process.exit(1);
});
