import { expect, test, type Page } from '@playwright/test';

const modelId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const model = {
  id: modelId,
  provider: 'OPENAI',
  displayName: 'Configured model',
  description: 'A model configured by an administrator.',
  capabilities: ['text'],
  enabled: true,
};
const usage = {
  plan: 'Test plan',
  credits: { remaining: 100, limit: 100 },
  allowances: [
    {
      bucket: 'AUTO',
      modelName: 'Auto',
      provider: null,
      dailyLimit: 20,
      dailyRemaining: 20,
      monthlyLimit: 100,
      monthlyRemaining: 100,
      maxFiles: 0,
      maxFileBytes: 0,
      allowedFeatures: ['chat'],
    },
    {
      bucket: modelId,
      modelName: model.displayName,
      provider: model.provider,
      dailyLimit: 20,
      dailyRemaining: 20,
      monthlyLimit: 100,
      monthlyRemaining: 100,
      maxFiles: 0,
      maxFileBytes: 0,
      allowedFeatures: ['chat'],
    },
  ],
  resets: { daily: '2026-09-06T00:00:00Z', monthly: '2026-10-01T00:00:00Z' },
};
const plans = {
  checkoutAvailable: true,
  paymentMode: 'test',
  plans: [
    {
      id: 'FREE',
      name: 'Free',
      description: 'Start with Auto.',
      priceCentavos: 0,
      currency: 'USD',
      billingPeriod: 'to get started',
      monthlyCredits: 100,
      manualModelCount: 0,
      allowances: [{ bucket: 'Auto', dailyLimit: 20, monthlyLimit: 100 }],
      features: [],
    },
    {
      id: 'PRO',
      name: 'Nextfi Pro',
      description: 'More room for your work.',
      priceCentavos: 599,
      currency: 'USD',
      billingPeriod: 'every month',
      monthlyCredits: 1000,
      manualModelCount: 1,
      allowances: [{ bucket: 'Auto', dailyLimit: 200, monthlyLimit: 1000 }],
      features: [],
    },
  ],
};

test('four subscription plans and only the four requested provider brands are shown', async ({
  page,
}) => {
  await mockApi(page);
  const fourPlans = ['Free', 'Starter', 'Pro', 'Max'].map((name, index) => ({
    ...plans.plans[0],
    id: name.toUpperCase(),
    name,
    priceCentavos: [0, 599, 1199, 2499][index],
    monthlyCredits: [30, 100, 250, 600][index],
    manualModelCount: [0, 3, 5, 5][index],
  }));
  await page.route('**/billing/plans', (route) =>
    route.fulfill({ json: { ...plans, plans: fourPlans } }),
  );
  await page.goto('/');
  await expect(
    page.locator('.hero-hub').getByRole('heading', { level: 2 }),
  ).toHaveText('Good ideas.More ways forward.');
  await expect(page.locator('.hero-hub .brand-symbol')).toHaveCount(0);
  await expect(page.locator('.hero-hub')).not.toContainText('4 providers');
  await expect(page.locator('.hub-auto')).toHaveAttribute(
    'href',
    '#how-auto-works',
  );
  await expect(page.locator('.hub-providers')).toContainText('ChatGPT');
  await expect(page.locator('.hub-providers')).toContainText('Gemini');
  await expect(page.locator('.hub-providers')).toContainText('Claude');
  await expect(page.locator('.hub-providers')).toContainText('Mistral');
  await expect(page.locator('.hub-providers')).not.toContainText(/Groq|Grok/);
  await expect(page.locator('.pricing-card h3')).toHaveText([
    'Free',
    'Starter',
    'Pro',
    'Max',
  ]);
  await page.goto('/billing');
  await expect(page.locator('.pricing-card h3')).toHaveText([
    'Free',
    'Starter',
    'Pro',
    'Max',
  ]);
  const submitted: string[] = [];
  await page.route('**/billing/checkout', (route) => {
    submitted.push(route.request().postDataJSON().planCode);
    return route.fulfill({
      status: 503,
      json: { message: 'Test checkout unavailable' },
    });
  });
  for (const name of ['Starter', 'Max']) {
    await page
      .getByRole('button', { name: `Get ${name}`, exact: true })
      .click();
    await expect(
      page.getByRole('button', { name: `Get ${name}`, exact: true }),
    ).toBeEnabled();
  }
  expect(submitted).toEqual(['STARTER', 'MAX']);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/four-plans-mobile.png',
    fullPage: true,
  });
});

type TestRole = 'USER' | 'ADMIN' | 'guest';
test('file selection respects per-message limits and model capabilities before sending', async ({
  page,
}) => {
  await mockApi(page);
  await page.route('**/workspace/usage', (route) =>
    route.fulfill({
      json: {
        ...usage,
        allowances: usage.allowances.map((item) => ({
          ...item,
          maxFiles: 1,
          maxFileBytes: 5_000_000,
        })),
      },
    }),
  );
  await page.route(`**/workspace/conversations/${conversationId}`, (route) =>
    route.fulfill({
      json: {
        id: conversationId,
        title: 'Files',
        messages: [],
        attachments: [
          { id: 'photo', name: 'photo.png', mimeType: 'image/png', size: 100 },
          { id: 'notes', name: 'notes.txt', mimeType: 'text/plain', size: 100 },
        ],
      },
    }),
  );
  await page.goto(`/chat?id=${conversationId}`);
  await page
    .getByRole('textbox', { name: 'Message' })
    .fill('Describe this file');
  await page.getByRole('checkbox', { name: 'Include photo.png' }).check();
  await expect(
    page.getByRole('checkbox', { name: 'Include notes.txt' }),
  ).toBeDisabled();
  await page.locator('.composer select').selectOption(modelId);
  await expect(page.locator('input[type="file"]')).toHaveAttribute(
    'accept',
    '.txt,.md,.csv',
  );
  await expect(
    page.getByRole('button', { name: 'Send', exact: true }),
  ).toBeDisabled();
  await expect(page.locator('.composer-wrap [role="alert"]')).toContainText(
    'Deselect incompatible',
  );
  await page.getByRole('checkbox', { name: 'Include photo.png' }).uncheck();
  await page.getByRole('checkbox', { name: 'Include notes.txt' }).check();
  await expect(
    page.getByRole('button', { name: 'Send', exact: true }),
  ).toBeEnabled();
});
async function mockApi(
  page: Page,
  session: TestRole | (() => TestRole) = 'USER',
) {
  await page.route('**/api/v1/**', async (route) => {
    const role = typeof session === 'function' ? session() : session;
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    let body: unknown = [];
    if (path === '/auth/refresh') {
      if (role === 'guest') {
        await route.fulfill({ status: 401, json: { message: 'Signed out' } });
        return;
      }
      body = {
        accessToken: 'test-token',
        user: {
          id: 'test-user',
          username: 'alex',
          email: 'alex@example.com',
          role,
          onboardingCompleted: true,
        },
      };
    } else if (path === '/settings/public')
      body = {
        'branding.siteName': 'Nextfi Software',
        'workspace.writePrompt': 'A configured writing starter.',
      };
    else if (path === '/catalog/models' || path === '/workspace/models')
      body = [model];
    else if (path === '/workspace/usage') body = usage;
    else if (path === '/billing/plans') body = plans;
    else if (path === '/billing/me')
      body = { plan: 'FREE', subscription: null, latestPayment: null };
    else if (path === '/workspace/preferences')
      body = { displayName: 'Alex', defaultModelId: null, sendOnEnter: false };
    else if (
      path === '/workspace/conversations' &&
      route.request().method() === 'POST'
    )
      body = { id: conversationId, title: 'New test conversation' };
    else if (path === `/workspace/conversations/${conversationId}`)
      body = {
        id: conversationId,
        title: 'New test conversation',
        messages: [],
        attachments: [],
      };
    else if (path === '/admin/workspace/configuration')
      body = { models: [model], plans: [], policies: [] };
    else if (path === '/admin/billing/configuration')
      body = { plans: [], promotions: [] };
    else if (path === '/admin/dashboard')
      body = {
        users: 12,
        generations: 42,
        models: 1,
        conversations: 6,
        savedPrompts: 2,
        staff: 1,
      };
    else if (path === '/admin/system')
      body = {
        environment: 'test',
        checkedAt: '2026-09-07T00:00:00Z',
        dependencies: { database: { status: 'up', latencyMs: 2 } },
        integrations: { aiProvider: true },
      };
    else if (path === '/admin/users')
      body = {
        items: [
          {
            id: 'member',
            username: 'alex',
            email: 'alex@example.com',
            role: 'USER',
            status: 'ACTIVE',
            createdAt: '2026-09-01T00:00:00Z',
            staffCredential: null,
          },
        ],
        total: 1,
        page: 1,
        hasNextPage: false,
      };
    else if (path === '/admin/audit')
      body = { items: [], total: 0, hasNextPage: false };
    else if (path === '/admin/workspace/analytics')
      body = { costs: [], contribution: [], activeSubscriptions: 0, note: '' };
    else if (path === '/admin/billing/overview')
      body = { activeSubscriptions: 0, failedWebhooks: 0, payments: {} };
    await route.fulfill({ json: body });
  });
}

test('landing reflects the catalog and carries an authenticated draft into chat', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/');
  await expect(
    page.getByText('Configured model', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Your message' })
    .fill('Help me plan a launch');
  await page
    .getByRole('button', { name: 'Open chat with your message' })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Message', exact: true }),
  ).toHaveValue('Help me plan a launch');
  await expect(page.getByText('Open administration')).toHaveCount(0);
});

test('chat honors send-button preference and preserves the chosen model on first send', async ({
  page,
}) => {
  await mockApi(page);
  let submitted: Record<string, unknown> | undefined;
  await page.route(
    `**/conversations/${conversationId}/messages`,
    async (route) => {
      submitted = route.request().postDataJSON();
      await route.fulfill({
        contentType: 'text/event-stream',
        body: `data: ${JSON.stringify({ type: 'delta', text: 'Test response' })}\n\ndata: ${JSON.stringify({ type: 'done', status: 'SUCCEEDED', messageId: 'response', usage })}\n\n`,
      });
    },
  );
  await page.goto('/chat');
  await expect(
    page.getByRole('heading', { name: 'Hello, Alex.' }),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Choose AI model' })
    .selectOption(modelId);
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('A test prompt');
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .press('Enter');
  expect(submitted).toBeUndefined();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect.poll(() => submitted?.modelId).toBe(modelId);
  await expect(
    page.getByRole('combobox', { name: 'Choose AI model' }),
  ).toHaveValue(modelId);
});

test('admin settings save and refresh the visible brand', async ({ page }) => {
  await mockApi(page, 'ADMIN');
  let name = 'Nextfi Software';
  await page.route('**/settings/public', (route) =>
    route.fulfill({ json: { 'branding.siteName': name } }),
  );
  await page.route('**/api/v1/admin/settings', (route) =>
    route.fulfill({
      json: [
        {
          key: 'branding.siteName',
          group: 'Branding',
          label: 'Site name',
          description: 'Public workspace name',
          type: 'string',
          value: name,
          defaultValue: 'Nextfi Software',
          maxLength: 40,
          updatedAt: name,
        },
      ],
    }),
  );
  await page.route('**/admin/settings/branding.siteName', async (route) => {
    name = route.request().postDataJSON().value;
    await route.fulfill({ json: { value: name } });
  });
  await page.goto('/admin/settings');
  await page.getByLabel('Site name', { exact: true }).fill('Studio AI');
  await page.getByRole('button', { name: 'Save change', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Setting saved' }),
  ).toBeVisible();
  await expect(page.locator('.workspace-brand')).toContainText('Studio AI');
  await page.reload();
  await expect(page.getByLabel('Site name', { exact: true })).toHaveValue(
    'Studio AI',
  );
});

test('user accounts cannot open admin management views', async ({ page }) => {
  await mockApi(page);
  await page.goto('/admin/users');
  await expect(page.getByText('Administrator access required.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add admin' })).toHaveCount(0);
});

test('mobile layout fits and navigation supports Escape and focus return', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto('/chat');
  await expect(
    page.getByRole('heading', { name: 'Hello, Alex.' }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const menu = page.getByRole('button', { name: 'Toggle navigation' });
  await menu.click();
  await expect(
    page.getByRole('navigation', { name: 'Workspace', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await page.screenshot({
    path: 'test-results/chat-mobile.png',
    fullPage: true,
  });
});

test('sign-in opens as a modal, traps focus, and restores the trigger on Escape', async ({
  page,
}) => {
  await mockApi(page, 'guest');
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const trigger = page.getByRole('button', { name: 'Sign in', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Welcome to Nextfi Software.' });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL('/');
  await expect(
    dialog.getByRole('button', { name: 'Continue with Google' }),
  ).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: 'Continue with GitHub' }),
  ).toBeVisible();
  for (let i = 0; i < 10; i++) await page.keyboard.press('Tab');
  expect(
    await page.evaluate(() =>
      document.querySelector('dialog')?.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/login-modal-desktop.png' });
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(errors).toEqual([]);
});

test('direct login displays a responsive modal and a useful OAuth error', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, 'guest');
  await page.goto('/login?error=google_not_configured');
  const dialog = page.getByRole('dialog', { name: 'Welcome to Nextfi Software.' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText('not configured');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: 'test-results/login-modal-mobile.png' });
  await dialog.getByRole('button', { name: 'Close sign-in' }).click();
  await expect(page).toHaveURL('/');
  await expect(dialog).not.toBeVisible();
});

test('sign-in remembers the originating workspace before OAuth redirect', async ({
  page,
}) => {
  await mockApi(page, 'guest');
  let origin = '';
  await page.route('**/api/v1/auth/google', async (route) => {
    await route.fulfill({
      status: 302,
      headers: { location: `${origin}/#handoff` },
    });
  });
  await page.goto('/projects');
  origin = new URL(page.url()).origin;
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page).toHaveURL('/#handoff');
  expect(
    await page.evaluate(() => sessionStorage.getItem('vrompt-oauth-return-to')),
  ).toBe('/projects');
});

test('signed-out visitors can read public pages but cannot use any workspace tool', async ({
  page,
}) => {
  await mockApi(page, 'guest');
  const privateRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/v1\/(workspace|guest)\//.test(request.url()))
      privateRequests.push(request.url());
  });
  for (const path of [
    '/chat',
    '/projects',
    '/workflows',
    '/conversations',
    '/saved-prompts',
    '/usage',
    '/billing',
    '/settings',
  ]) {
    await page.goto(path);
    await expect(
      page.getByRole('button', { name: 'Sign in', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Message', exact: true }),
    ).toHaveCount(0);
    await expect(page.locator('.workspace-sidebar')).toHaveCount(0);
  }
  expect(privateRequests).toEqual([]);
  for (const path of ['/', '/docs', '/privacy', '/terms']) {
    await page.goto(path);
    await expect(page.locator('main h1')).toBeVisible();
  }
  await page.goto('/chat');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Explore a temporary chat' }),
  ).toHaveCount(0);
});

for (const name of ['Free', 'Starter', 'Pro', 'Max']) {
  test(`the ${name} subscription badge uses the actual tier and usage labels distinguish credits from messages`, async ({
    page,
  }) => {
    await mockApi(page);
    const code = name.toUpperCase();
    await page.route('**/billing/me', (route) =>
      route.fulfill({
        json: {
          plan: code === 'FREE' ? 'FREE' : 'PRO',
          planCode: code,
          planName: name,
          subscription:
            code === 'FREE'
              ? null
              : {
                  id: 'sub',
                  status: 'ACTIVE',
                  currentPeriodEnd: '2099-10-01T00:00:00Z',
                },
          latestPayment: null,
        },
      }),
    );
    await page.route('**/workspace/usage', (route) =>
      route.fulfill({
        json: {
          ...usage,
          credits: { remaining: 12, limit: 100 },
          allowances: usage.allowances.map((allowance) => ({
            ...allowance,
            dailyRemaining: 1,
            creditCosts: { chat: 1, image_generation: null },
          })),
        },
      }),
    );
    await page.goto('/chat');
    await expect(page.locator('.workspace-topbar .plan-badge')).toHaveText(
      name,
    );
    await expect(page.locator('.sidebar-plan .plan-badge')).toHaveText(name);
    await expect(page.locator('#composer-status')).toContainText(
      '1 credit per response · 1 message left today',
    );
    await expect(page.locator('#composer-status')).toContainText(
      '12 credits left this month',
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('.workspace-topbar .plan-badge')).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (name === 'Max')
      await page.screenshot({
        path: 'test-results/plan-badge-mobile.png',
        fullPage: true,
      });
    await page.goto('/');
    await expect(page.locator('.nav-actions .plan-badge')).toHaveText(name);
  });
}

test('visitor signs in, sends with Auto, switches models, views usage, and opens test checkout', async ({
  page,
}) => {
  // OAuth, AI, and payment responses are explicit browser-test fixtures.
  let signedIn = false;
  await mockApi(page, () => (signedIn ? 'USER' : 'guest'));
  let origin = '';
  await page.route('**/api/v1/auth/google', async (route) => {
    signedIn = true;
    await route.fulfill({
      status: 302,
      headers: { location: `${origin}/auth/callback` },
    });
  });
  const submissions: Record<string, unknown>[] = [];
  const messages: {
    id: string;
    role: string;
    content: string;
    status: string;
  }[] = [];
  const trackedUsage = structuredClone(usage);
  await page.route('**/workspace/usage', (route) =>
    route.fulfill({ json: trackedUsage }),
  );
  await page.route(`**/conversations/${conversationId}`, (route) =>
    route.fulfill({
      json: {
        id: conversationId,
        title: 'Launch plan',
        messages,
        attachments: [],
      },
    }),
  );
  await page.route(
    `**/conversations/${conversationId}/messages`,
    async (route) => {
      const body = route.request().postDataJSON();
      submissions.push(body);
      messages.push({
        id: `user-${submissions.length}`,
        role: 'user',
        content: body.content,
        status: 'SUCCEEDED',
      });
      const response = {
        id: `reply-${submissions.length}`,
        role: 'assistant',
        content: `Fixture response ${submissions.length}`,
        status: 'SUCCEEDED',
      };
      messages.push(response);
      trackedUsage.credits.remaining--;
      const bucket = trackedUsage.allowances.find(
        (item) => item.bucket === (body.modelId ?? 'AUTO'),
      )!;
      bucket.dailyRemaining--;
      bucket.monthlyRemaining--;
      await route.fulfill({
        contentType: 'text/event-stream',
        body: [
          { type: 'model', model: model.displayName, mode: body.mode },
          { type: 'delta', text: response.content },
          {
            type: 'done',
            status: 'SUCCEEDED',
            messageId: response.id,
            usage: trackedUsage,
          },
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(''),
      });
    },
  );
  let checkout: Record<string, unknown> | undefined;
  await page.route('**/api/v1/billing/checkout', async (route) => {
    checkout = route.request().postDataJSON();
    expect(route.request().headers()['idempotency-key']).toBeTruthy();
    await route.fulfill({
      json: { checkoutUrl: 'https://checkout.paymongo.com/browser-fixture' },
    });
  });
  await page.route('https://checkout.paymongo.com/browser-fixture', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<h1>Test checkout fixture</h1>',
    }),
  );
  await page.goto('/');
  origin = new URL(page.url()).origin;
  await page
    .getByRole('textbox', { name: 'Your message' })
    .fill('Help me plan a launch');
  await page
    .getByRole('button', { name: 'Open chat with your message' })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await expect(page).toHaveURL('/chat');
  const input = page.getByRole('textbox', { name: 'Message', exact: true });
  const selector = page.getByRole('combobox', { name: 'Choose AI model' });
  await expect(input).toHaveValue('Help me plan a launch');
  await expect(selector).toHaveValue('AUTO');
  await page.getByRole('button', { name: /^Send/ }).click();
  await expect(
    page.getByText('Fixture response 1', { exact: true }),
  ).toBeVisible();
  expect(submissions[0]?.mode).toBe('AUTO');
  expect(submissions[0]?.modelId).toBeUndefined();
  await selector.selectOption(modelId);
  await input.fill('Expand the plan');
  await page.getByRole('button', { name: /^Send/ }).click();
  await expect(
    page.getByText('Fixture response 2', { exact: true }),
  ).toBeVisible();
  expect(submissions[1]?.modelId).toBe(modelId);
  await page
    .getByRole('navigation', { name: 'Workspace', exact: true })
    .getByRole('link', { name: 'Usage' })
    .click();
  await expect(
    page.getByText('98 / 100 monthly credits remaining'),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Nextfi Software home', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Pricing' })
    .click();
  await page.getByRole('button', { name: 'Get Nextfi Pro' }).click();
  await expect(page).toHaveURL('/billing?plan=PRO');
  await expect(
    page.getByText('Test payment mode. Checkout will not make a real charge.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Get Nextfi Pro' }).click();
  await expect(page).toHaveURL('https://checkout.paymongo.com/browser-fixture');
  expect(checkout?.planCode).toBe('PRO');
});

test('missing provider and payment credentials have useful states and cannot submit', async ({
  page,
}) => {
  await mockApi(page);
  await page.route('**/catalog/models', (route) =>
    route.fulfill({ json: [{ ...model, available: false }] }),
  );
  await page.route('**/workspace/models', (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route('**/billing/plans', (route) =>
    route.fulfill({ json: { ...plans, checkoutAvailable: false } }),
  );
  await page.goto('/chat');
  await expect(
    page.getByText('AI chat is temporarily unavailable.', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Keep my draft');
  await expect(page.getByRole('button', { name: /^Send/ })).toBeDisabled();
  await page.getByRole('button', { name: 'Check availability' }).click();
  await expect(
    page.getByRole('textbox', { name: 'Message', exact: true }),
  ).toHaveValue('Keep my draft');
  await page.goto('/billing?plan=PRO');
  await expect(
    page.getByText('Paid checkout is temporarily unavailable.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Checkout unavailable' }),
  ).toBeDisabled();
  await page.getByRole('link', { name: 'Continue to chat' }).click();
  await expect(page).toHaveURL('/chat');
});

test('landing sections, model handoff, and responsive navigation are complete', async ({
  page,
}) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.locator('#hero-title')).toHaveText(
    'One account.One subscription.Multiple AI models.',
  );
  await expect(page.locator('main > section')).toHaveCount(7);
  const ids = await page
    .locator('main > section')
    .evaluateAll((sections) => sections.map((section) => section.id));
  expect(ids.slice(2, 6)).toEqual([
    'why-vrompt',
    'how-auto-works',
    'models',
    'pricing',
  ]);
  await page.screenshot({
    path: 'test-results/landing-desktop.png',
    fullPage: true,
  });
  for (const width of [390, 320, 768]) {
    await page.setViewportSize({ width, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    for (const name of ['Why Nextfi Software', 'Models', 'Pricing']) {
      await nav.getByRole('link', { name, exact: true }).click();
      await expect(page).toHaveURL(
        new RegExp(
          `#${name === 'Why Nextfi Software' ? 'why-vrompt' : name.toLowerCase()}$`,
        ),
      );
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'test-results/landing-mobile.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Explore in chat' }).click();
  await expect(page).toHaveURL(`/chat?model=${modelId}`);
  await expect(
    page.getByRole('combobox', { name: 'Choose AI model' }),
  ).toHaveValue(modelId);
});

test('legacy public URLs redirect to the matching section', async ({
  page,
}) => {
  await mockApi(page, 'guest');
  for (const [path, hash] of [
    ['/features', 'why-vrompt'],
    ['/auto', 'how-auto-works'],
    ['/models', 'models'],
    ['/pricing', 'pricing'],
  ]) {
    await page.goto(path!);
    await expect(page).toHaveURL(`/#${hash}`);
    await expect(page.locator(`#${hash}`)).toBeVisible();
  }
});

test('a saved session cookie does not hide landing pricing or legal pages', async ({
  page,
  context,
}) => {
  await mockApi(page, 'guest');
  await page.goto('/');
  await context.addCookies([
    {
      name: 'vrompt_refresh_token',
      value: 'expired-cookie-fixture',
      url: new URL(page.url()).origin,
      httpOnly: true,
    },
  ]);
  await page.goto('/#pricing');
  await expect(page).toHaveURL('/#pricing');
  await expect(page.locator('#pricing-title')).toBeVisible();
  for (const path of ['/privacy', '/terms', '/docs']) {
    await page.goto(path);
    await expect(page.locator('main h1')).toBeVisible();
    await expect(page.locator('main section').first()).toBeVisible();
  }
});

test('every New Chat starts with Auto and clears drafts despite a legacy default', async ({
  page,
}) => {
  await mockApi(page);
  await page.route('**/workspace/preferences', (route) =>
    route.fulfill({
      json: { displayName: 'Alex', defaultModelId: modelId, sendOnEnter: true },
    }),
  );
  await page.goto('/chat');
  const picker = page.getByRole('combobox', { name: 'Choose AI model' });
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(picker).toHaveValue('AUTO');
  await expect(
    page.getByRole('heading', { name: 'Hello, Alex.' }),
  ).toBeVisible();
  await picker.selectOption(modelId);
  await composer.fill('Draft to discard');
  await page.getByRole('link', { name: 'New Chat', exact: true }).click();
  await expect(picker).toHaveValue('AUTO');
  await expect(composer).toHaveValue('');
  await composer.fill('Another draft');
  await page.getByRole('link', { name: 'New Chat', exact: true }).click();
  await expect(composer).toHaveValue('');
  await page.getByRole('button', { name: 'Account menu' }).click();
  await expect(
    page.getByRole('button', { name: 'Change theme' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Change theme' })).toBeHidden();
  await expect(page.locator('.workspace-brand')).toHaveAttribute('href', '/');
  await page.screenshot({
    path: 'test-results/chat-desktop.png',
    fullPage: true,
  });
});

test('chat options preserve drafts, insert prompts, and keep the active task visible', async ({
  page,
}) => {
  await mockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/workspace/projects', (route) =>
    route.fulfill({
      json: [{ id: 'project-one', name: 'Research', archived: false }],
    }),
  );
  await page.route('**/workspace/saved-prompts', (route) =>
    route.fulfill({
      json: [
        {
          id: 'prompt-one',
          title: 'Summarize',
          content: 'Summarize the key points.',
        },
      ],
    }),
  );
  await page.route('**/workspace/usage', (route) =>
    route.fulfill({
      json: {
        ...usage,
        allowances: usage.allowances.map((allowance) => ({
          ...allowance,
          maxFiles: 1,
          allowedFeatures: ['chat', 'image_generation'],
        })),
      },
    }),
  );
  await page.goto('/chat');
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  const picker = page.getByRole('combobox', { name: 'Choose AI model' });
  await expect(picker).toHaveCount(1);
  await page.getByRole('button', { name: 'Write', exact: true }).click();
  await expect(composer).toHaveValue('A configured writing starter.');
  await expect(composer).toBeFocused();
  await page.getByRole('button', { name: 'Chat options', exact: true }).click();
  const dialog = page.getByRole('dialog', {
    name: 'Chat options',
    exact: true,
  });
  await dialog
    .getByRole('combobox', { name: 'Choose task' })
    .selectOption('image_generation');
  await dialog
    .getByRole('combobox', { name: /Project/ })
    .selectOption('project-one');
  await dialog
    .getByRole('combobox', { name: 'Insert saved prompt' })
    .selectOption('prompt-one');
  await expect(dialog).toBeHidden();
  await expect(composer).toHaveValue(
    'A configured writing starter.\nSummarize the key points.',
  );
  await expect(composer).toBeFocused();
  await expect(composer).toHaveAttribute('placeholder', /Describe the image/);
  await expect(page.locator('.composer-context')).toContainText('Research');
  await expect(page.locator('.composer-context')).toContainText(
    'Generate image',
  );
  await expect(
    page.getByRole('button', { name: 'Attach a file' }),
  ).toBeEnabled();
  await picker.selectOption(modelId);
  await expect(composer).toHaveAttribute('placeholder', 'Message Nextfi Software…');
  await expect(page.locator('.composer-context')).not.toContainText(
    'Generate image',
  );
  await page.getByRole('button', { name: 'Chat options', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', { name: 'Chat options', exact: true }),
  ).toBeFocused();
});

test('the chat usage limit applies to both Send and Enter without losing the draft', async ({
  page,
}) => {
  await mockApi(page);
  await page.route('**/workspace/preferences', (route) =>
    route.fulfill({ json: { displayName: 'Alex', sendOnEnter: true } }),
  );
  await page.route('**/workspace/usage', (route) =>
    route.fulfill({
      json: {
        ...usage,
        allowances: usage.allowances.map((allowance) => ({
          ...allowance,
          dailyRemaining: 0,
        })),
      },
    }),
  );
  let requests = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      request.url().includes('/workspace/conversations')
    )
      requests++;
  });
  await page.goto('/chat');
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(page.locator('#composer-status')).toContainText(
    'You’ve reached your usage limit.',
  );
  await composer.fill('Keep this draft for later.');
  await expect(
    page.getByRole('button', { name: 'Send', exact: true }),
  ).toBeDisabled();
  await composer.press('Enter');
  await expect(composer).toBeEnabled();
  await expect(composer).toHaveValue('Keep this draft for later.');
  expect(requests).toBe(0);
  await expect(page.getByRole('link', { name: 'View usage' })).toHaveAttribute(
    'href',
    '/usage',
  );
});

test('credit quotes block unaffordable chat and images and accompany requests', async ({
  page,
}) => {
  await mockApi(page);
  await page.route('**/workspace/preferences', (route) =>
    route.fulfill({ json: { sendOnEnter: true } }),
  );
  await page.route('**/workspace/usage', (route) =>
    route.fulfill({
      json: {
        ...usage,
        credits: { limit: 100, remaining: 7 },
        allowances: usage.allowances.map((allowance) => ({
          ...allowance,
          allowedFeatures: ['chat', 'image_generation'],
          creditCosts: {
            chat: allowance.bucket === 'AUTO' ? 1 : 8,
            image_generation: 35,
          },
        })),
      },
    }),
  );
  const requests: Record<string, unknown>[] = [];
  await page.route(
    '**/conversations/' + conversationId + '/messages',
    (route) => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({
        status: 503,
        json: { message: 'Test provider offline' },
      });
    },
  );
  await page.goto('/chat');
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  const picker = page.getByRole('combobox', { name: 'Choose AI model' });
  await expect(page.locator('#composer-status')).toContainText(
    '1 credit per response',
  );
  await composer.fill('Keep my draft');
  await picker.selectOption(modelId);
  await expect(page.locator('#composer-status')).toContainText(
    'This response needs 8 credits. You have 7.',
  );
  await expect(
    page.getByRole('button', { name: 'Send', exact: true }),
  ).toBeDisabled();
  await composer.press('Enter');
  expect(requests).toHaveLength(0);
  await picker.selectOption('AUTO');
  await page.getByRole('button', { name: 'Chat options', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Choose task' })
    .selectOption('image_generation');
  await page.keyboard.press('Escape');
  await expect(page.locator('#composer-status')).toContainText(
    'This response needs 35 credits. You have 7.',
  );
  await composer.press('Enter');
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Chat options', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Choose task' })
    .selectOption('chat');
  await page.keyboard.press('Escape');
  await composer.press('Enter');
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'Test provider offline',
  );
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    mode: 'AUTO',
    feature: 'chat',
    maxCredits: 1,
  });
});

test('usage explains shared credits and shows each task price', async ({
  page,
}) => {
  await mockApi(page);
  await page.route('**/workspace/usage', (route) =>
    route.fulfill({
      json: {
        ...usage,
        allowances: usage.allowances.map((allowance) => ({
          ...allowance,
          creditCosts: {
            chat: allowance.bucket === 'AUTO' ? 1 : 8,
            image_generation: allowance.bucket === 'AUTO' ? 35 : null,
          },
        })),
      },
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/usage');
  await expect(
    page.getByRole('article', { name: 'Auto allowance', exact: true }),
  ).toContainText('1 credit per chat response · 35 credits per image request');
  await expect(
    page.getByRole('article', {
      name: 'Configured model allowance',
      exact: true,
    }),
  ).toContainText('8 credits per chat response');
  await page.getByText('How usage is counted', { exact: true }).click();
  await expect(page.locator('.usage-explanation')).toContainText(
    'Model limits do not add extra credits',
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: 'test-results/credit-usage-mobile.png',
    fullPage: true,
  });
});

test('failed empty responses can be retried and Enter uses Auto once', async ({
  page,
}) => {
  await mockApi(page);
  await page.route('**/workspace/preferences', (route) =>
    route.fulfill({
      json: { displayName: 'Alex', defaultModelId: null, sendOnEnter: true },
    }),
  );
  const failed = {
    id: 'failed-response',
    role: 'assistant',
    content: '',
    status: 'FAILED',
    modelName: 'Configured model',
  };
  await page.route('**/workspace/conversations/' + conversationId, (route) =>
    route.fulfill({
      json: {
        id: conversationId,
        title: 'Retry conversation',
        attachments: [],
        messages: [
          {
            id: 'original-prompt',
            role: 'user',
            content: 'Help me write',
            status: 'SUCCEEDED',
          },
          failed,
        ],
      },
    }),
  );
  const requests: Record<string, unknown>[] = [];
  await page.route(
    '**/conversations/' + conversationId + '/messages',
    async (route) => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        contentType: 'text/event-stream',
        body:
          'data: ' +
          JSON.stringify({
            type: 'done',
            status: 'SUCCEEDED',
            messageId: 'retry-result',
            usage,
          }) +
          '\n\n',
      });
    },
  );
  await page.goto('/chat?id=' + conversationId);
  await page.getByRole('button', { name: 'Retry response' }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({
    mode: 'AUTO',
    regenerateMessageId: 'failed-response',
  });
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeEnabled();
  await composer.fill('Next prompt');
  await composer.press('Shift+Enter');
  expect(requests).toHaveLength(1);
  await composer.press('Enter');
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1]).toMatchObject({ mode: 'AUTO', content: 'Next prompt' });
});

for (const role of ['USER', 'ADMIN'] as const) {
  test(
    role + ' pages fit mobile and keep account actions accessible',
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await mockApi(page, role);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const paths =
        role === 'USER'
          ? [
              '/chat',
              '/conversations',
              '/projects',
              '/saved-prompts',
              '/workflows',
              '/usage',
              '/billing',
              '/settings',
            ]
          : [
              '/admin',
              '/admin/models',
              '/admin/plans',
              '/admin/users',
              '/admin/analytics',
              '/admin/billing',
              '/admin/audit',
              '/admin/settings',
            ];
      for (const path of paths) {
        await page.goto(path);
        await expect(page.locator('main h1')).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Account menu' }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          path,
        ).toBe(true);
        await page.getByRole('button', { name: 'Account menu' }).click();
        await expect(
          page.getByRole('button', { name: 'Change theme' }),
        ).toBeVisible();
        await page.keyboard.press('Escape');
        const menu = page.getByRole('button', { name: 'Toggle navigation' });
        await menu.click();
        const nav = page.getByRole('navigation', {
          name: role === 'ADMIN' ? 'Administration' : 'Workspace',
          exact: true,
        });
        await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
        await page.keyboard.press('Escape');
        await expect(menu).toBeFocused();
      }
      expect(errors).toEqual([]);
      await page.screenshot({
        path: 'test-results/' + role.toLowerCase() + '-settings-mobile.png',
        fullPage: true,
      });
    },
  );
}

test('usage failure has a working retry and accessible remaining-credit meters', async ({
  page,
}) => {
  await mockApi(page);
  let failed = true;
  await page.route('**/api/v1/workspace/usage', async (route) => {
    await route.fulfill(
      failed
        ? { status: 503, json: { message: 'Usage temporarily unavailable' } }
        : { json: usage },
    );
  });
  await page.goto('/usage');
  await expect(page.locator('main').getByRole('alert')).toContainText(
    'Usage temporarily unavailable',
  );
  failed = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(
    page.getByRole('progressbar', {
      name: 'Monthly credits remaining',
      exact: true,
    }),
  ).toHaveAttribute('value', '100');
  await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
  await page.screenshot({
    path: 'test-results/usage-desktop.png',
    fullPage: true,
  });
});

test('usage keeps unavailable model names, handles zero limits, and fits narrow screens', async ({
  page,
}) => {
  await mockApi(page);
  let modelRequests = 0;
  await page.route('**/workspace/models', (route) => {
    modelRequests++;
    return route.fulfill({
      status: 503,
      json: { message: 'Models unavailable' },
    });
  });
  await page.route('**/workspace/usage', (route) =>
    route.fulfill({
      json: {
        ...usage,
        credits: { limit: 150, remaining: 125, used: 20, reserved: 5 },
        resets: { daily: '', monthly: 'not-a-date' },
        allowances: [
          {
            ...usage.allowances[1],
            modelName: 'A model temporarily unavailable for chat',
            dailyRemaining: 0,
            maxFiles: 1,
            maxFileBytes: 500_000,
          },
          {
            ...usage.allowances[0],
            dailyLimit: 0,
            monthlyLimit: 0,
            dailyRemaining: 0,
            monthlyRemaining: 0,
          },
        ],
      },
    }),
  );
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/usage');
  const credits = page.getByRole('progressbar', {
    name: 'Monthly credits remaining',
    exact: true,
  });
  await expect(credits).toHaveAttribute('max', '150');
  await expect(credits).toHaveAttribute('value', '125');
  const modelRow = page.getByRole('article', {
    name: 'A model temporarily unavailable for chat allowance',
    exact: true,
  });
  await expect(modelRow.getByRole('heading')).toHaveText(
    'A model temporarily unavailable for chat',
  );
  await expect(modelRow).toContainText('Daily limit reached');
  await modelRow.locator('summary').click();
  await expect(modelRow).toContainText('0.5 MB per file');
  await expect(
    page
      .getByRole('article', { name: 'Auto allowance', exact: true })
      .getByRole('progressbar'),
  ).toHaveCount(0);
  await expect(
    page
      .locator('.usage-reset-card')
      .getByText('Not available', { exact: true }),
  ).toHaveCount(2);
  await expect(page.locator('main')).not.toContainText('Invalid Date');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(modelRequests).toBe(0);
});

test('usage refresh reports failure instead of presenting stale balances as current', async ({
  page,
}) => {
  await mockApi(page);
  let failed = false;
  await page.route('**/workspace/usage', (route) =>
    route.fulfill(
      failed
        ? { status: 503, json: { message: 'Usage refresh failed' } }
        : { json: usage },
    ),
  );
  await page.goto('/usage');
  await expect(page.locator('.usage-credit-card')).toBeVisible();
  failed = true;
  await page.getByRole('button', { name: 'Refresh usage' }).click();
  await expect(page.locator('main').getByRole('alert')).toHaveText(
    'Usage refresh failed',
  );
  await expect(page.locator('.usage-credit-card')).toBeHidden();
  failed = false;
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.usage-credit-card')).toBeVisible();
});

test('model search clears and routing has one administration destination', async ({
  page,
}) => {
  await mockApi(page, 'ADMIN');
  await page.goto('/admin/models');
  await expect(
    page.getByText('Configured model', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('searchbox', { name: 'Search models' })
    .fill('no matching model');
  await expect(
    page.getByText('No results match your search.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await expect(
    page.getByText('Configured model', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add allowance' })).toHaveCount(
    0,
  );
  await page
    .getByRole('link', { name: 'Manage allowances & routing', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Generation allowances & routing' }),
  ).toBeVisible();
});

test('account filters can be reset and unchanged preferences cannot be submitted', async ({
  page,
}) => {
  await mockApi(page, 'ADMIN');
  await page.goto('/admin/users');
  await page.getByRole('searchbox', { name: 'Search users' }).fill('alex');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page
    .getByRole('combobox', { name: 'Filter role' })
    .selectOption('ADMIN');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(
    page.getByRole('searchbox', { name: 'Search users' }),
  ).toHaveValue('');
  await expect(page.getByRole('combobox', { name: 'Filter role' })).toHaveValue(
    '',
  );
  await page.screenshot({
    path: 'test-results/admin-users-desktop.png',
    fullPage: true,
  });
  await page.unrouteAll({ behavior: 'wait' });
  await mockApi(page, 'USER');
  await page.goto('/settings');
  await expect(page.getByLabel('Display name')).toHaveValue('Alex');
  await expect(
    page.getByRole('button', { name: 'Save preferences' }),
  ).toBeDisabled();
  await page.getByLabel('Display name').fill('Alex updated');
  await expect(
    page.getByRole('button', { name: 'Save preferences' }),
  ).toBeEnabled();
});
