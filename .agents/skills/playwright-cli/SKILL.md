---
name: playwright-cli
description: Run local browser smoke tests for WACRM and other web apps using Microsoft's Playwright CLI and synthetic fixtures. Use to verify navigation, inbox rendering, pipeline behavior, and responsive layout in a local development session.
---

# Local browser smoke tests

Use Playwright CLI to check the app on localhost with a test workspace and synthetic fixtures. Use the project's documented test setup. Use a fresh browser session dedicated to the task.

Check `node --version` (WACRM requires Node.js 22.12 or newer) and `playwright-cli --version`. If the CLI is missing, install `@playwright/cli@0.1.25` in the development environment. Start WACRM with `npm ci` and `npm run dev -- --hostname 127.0.0.1` after configuring a separate test Supabase instance. Use test credentials supplied through the test environment.

1. Confirm the local app URL and the expected outcome before starting.
2. Use Playwright CLI to open the local page and inspect its accessibility snapshot. Use visible controls to exercise the requested flow. Take a fresh snapshot after navigation or changes to the page.
3. For WACRM, verify that the seeded workspace opens, the inbox displays seeded conversations, and the requested pipeline state persists after reload. For layout checks, repeat the relevant steps at desktop and mobile viewport sizes.
4. Report the flow tested, expected result, and observed result. Include a screenshot of synthetic data if it helps illustrate a layout issue. Close the session when finished.

See [Microsoft Playwright CLI](https://github.com/microsoft/playwright-cli) for command syntax. If the CLI or the local fixtures are unavailable, report which checks are blocked.
