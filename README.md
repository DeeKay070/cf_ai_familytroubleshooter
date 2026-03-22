# cf_ai_familytechsupport

An AI-powered support chatbot for household electronics built on Cloudflare.

It helps users troubleshoot devices the way a patient, tech-savvy family member would:
- asking simple questions
- remembering what has already been tried
- suggesting practical next steps

## Stack
- Cloudflare Workers
- Workers AI
- Durable Objects
- Static frontend assets

## Features
- Chat-based troubleshooting
- Friendly, family-style support tone
- Per-session memory with Durable Objects
- Helps with phones, TVs, Wi-Fi, laptops, printers, and other electronics

## Assignment criteria coverage
- LLM: Workers AI model in `src/session.ts` via `env.AI.run(...)`
- Workflow / coordination: Durable Object `ChatSession` handles session coordination
- User input: browser chat UI in `public/index.html` + `public/chat.js`
- Memory / state: per-session chat history in Durable Object storage (`this.ctx.storage`)

## Local development

`npm run dev` is an alias to `npm run dev:local`.

For remote preview checks, run `npm run dev:remote`.

```bash
npm install
npm run dev:local