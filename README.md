# ScrapOff — ChatGPT Terminal Scraper

> Type a prompt in your terminal → it gets typed into **chatgpt.com** → the response is scraped and printed back.

## How it works

1. Launches a **real Chromium browser** window (via Playwright).
2. Opens `chatgpt.com` — you log in if you haven't already.
3. Enters an **interactive loop** in your terminal:
   - You type a prompt → hit Enter.
   - The scraper types it into ChatGPT and submits.
   - It waits for the response to finish streaming.
   - Prints the full response back to your terminal.
4. Type `exit` to quit.

## Prerequisites

- Node.js ≥ 18
- A ChatGPT account (free or Plus)

## Setup

```bash
npm install
npx playwright install chromium   # already done if you ran the setup
```

## Run

```bash
npm start
# or
node scraper.js
```

## Project structure

```
ScrapOff/
├── scraper.js      # Main script
├── package.json
└── README.md
```
