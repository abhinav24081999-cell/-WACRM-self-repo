import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';

const app = 'http://127.0.0.1:3000';
const supabaseUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
assert.equal(supabaseUrl.origin, 'http://127.0.0.1:54321', 'Use the disposable local Supabase stack');
const admin = createClient(supabaseUrl.origin, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function result(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

const fixtures = [];
for (const [index, name] of ['Preview contact A', 'Preview contact B'].entries()) {
  const email = `preview-${randomUUID()}@example.test`;
  const password = randomUUID();
  const { user } = await result(admin.auth.admin.createUser({ email, password, email_confirm: true }));
  const { account_id } = await result(admin.from('profiles')
    .select('account_id').eq('user_id', user.id).single());
  const contact = await result(admin.from('contacts').insert({
    name, account_id, user_id: user.id, phone: `+1555010000${index}`,
  }).select('id').single());
  await result(admin.from('conversations').insert({
    account_id, user_id: user.id, contact_id: contact.id,
  }));
  fixtures.push({ email, password, name, account_id });
}
assert.notEqual(fixtures[0].account_id, fixtures[1].account_id);

const browser = await chromium.launch();
try {
  for (const [index, fixture] of fixtures.entries()) {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto(app + '/login');
      await page.locator('#email').fill(fixture.email);
      await page.locator('#password').fill(fixture.password);
      await page.locator('button[type=submit]').click();
      await page.waitForURL('**/dashboard', { timeout: 30_000 });
      await page.goto(app + '/inbox');
      await page.getByText(fixture.name, { exact: true }).first().waitFor();
      assert.equal(await page.getByText(fixtures[1 - index].name, { exact: true }).count(), 0);
      const ai = await context.request.get(app + '/api/ai/config');
      assert.equal(ai.status(), 200);
      assert.equal((await ai.json()).configured, false);
    } finally {
      await context.close();
    }
  }
  console.log('Both workspaces passed login, inbox isolation, and AI configuration loading.');
} finally {
  await browser.close();
}
