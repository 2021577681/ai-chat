const { test, expect } = require('@playwright/test');
const {
  MOCK_LMS_COOKIE,
  gotoApp
} = require('./helpers');

async function openSettingsSection(page, section) {
  await page.locator('button[data-action="openSettings"]').first().click();
  await expect(page.locator('#settingsPage')).toHaveClass(/show/);
  await page.locator(`.settings-nav-item[data-settings-section="${section}"]`).click();
  await expect(page.locator('#settingsPageContent .settings-docked-panel')).toBeVisible();
}

async function gitSubcommands(backend) {
  return backend.backendCalls
    .filter(call => call.action === 'git')
    .map(call => call.body.subcommand);
}

async function expectGitCommand(backend, subcommand) {
  await expect.poll(async () => (await gitSubcommands(backend)).includes(subcommand)).toBe(true);
}

async function openLmsPanel(page) {
  await page.locator('[data-action="openLmsPanel"]').click();
  await expect(page.locator('#lmsPanel')).toHaveClass(/show/);
}

async function saveManualLmsCookie(page) {
  await page.locator('#lmsStatusBar [data-handler="lmsPanelOpenCookieEditor"][data-value="cookie"]').first().click();
  await expect(page.locator('#lmsCookieModal')).toHaveClass(/show/);
  await page.locator('#lmsAuthTabCookie').click();
  await page.fill('#lmsCookieInput', MOCK_LMS_COOKIE);
  await page.locator('[data-action="lmsPanelSaveCookie"]').click();
  await expect(page.locator('#lmsCookieModal')).not.toHaveClass(/show/);
}

async function openLmsHomePage(page, pageName) {
  const back = page.locator('#lmsPanelBody [data-handler="lmsPanelSetPage"][data-value="home"]');
  if (await back.count()) {
    await back.first().click();
  }
  await page.locator(`#lmsPanelBody [data-handler="lmsPanelSetPage"][data-value="${pageName}"]`).click();
}

test.describe('Git and LMS workflows without real credentials', () => {
  test('Git panel handles status, diff, commit, config, reflog, and remote sync through mocked backend', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page);

    await openSettingsSection(page, 'git');
    await expect(page.locator('#gitBody')).toContainText('js/pricing.js');
    await expect(page.locator('#gitHistory')).toContainText('E2E mock commit');
    await expectGitCommand(backend, 'check');
    await expectGitCommand(backend, 'status');
    await expectGitCommand(backend, 'log');

    await page.locator('.git-file-row[data-value="js/pricing.js"]').click();
    await expect(page.locator('#gitDetail')).toContainText('new mock line');
    await expectGitCommand(backend, 'diff');

    await page.locator('[data-action="_stageAll"]').click();
    await expectGitCommand(backend, 'add');
    await page.locator('[data-action="_stageUntracked"]').click();
    await expectGitCommand(backend, 'add');
    await page.locator('[data-action="_unstageAll"]').click();
    await expectGitCommand(backend, 'unstage');

    await page.fill('#gitCommitMsg', 'E2E commit from Playwright');
    await page.locator('[data-action="_onCommit"]').click();
    await expectGitCommand(backend, 'commit');
    await expect(page.locator('#gitCommitMsg')).toHaveValue('');

    await page.locator('[data-action="_showGitConfigInline"]').first().click();
    await expect(page.locator('#cfgUserName')).toBeVisible();
    await page.fill('#cfgUserName', 'Inline E2E User');
    await page.fill('#cfgUserEmail', 'inline-e2e@example.test');
    await page.locator('[data-action="_saveGitConfig"]').click();
    await expectGitCommand(backend, 'config_set');

    await page.locator('[data-action="_toggleReflogPanel"]').click();
    await expect(page.locator('#gitReflogPanel')).toContainText('HEAD@{0}');
    await expectGitCommand(backend, 'reflog');

    await page.locator('#gitBody [data-action="_openRemotePanel"]').first().click();
    await expect(page.locator('#gitRemotePanel')).toHaveClass(/show/);
    await page.fill('#newRemoteName', 'upstream');
    await page.fill('#newRemoteUrl', 'https://example.test/upstream.git');
    await expect(page.locator('#newRemoteName')).toHaveValue('upstream');
    await page.locator('[data-action="_addRemote"]').click();
    await expectGitCommand(backend, 'remote_add');

    await page.fill('#cfgRpUserName', 'Remote Panel User');
    await page.fill('#cfgRpUserEmail', 'remote-panel@example.test');
    await page.locator('[data-action="_savePanelUser"]').click();
    await expectGitCommand(backend, 'config_set');

    await page.locator('#gitProxyEnabled').check();
    await page.fill('#gitProxyPort', '7890');
    await page.locator('[data-action="_saveGitProxyConfig"]').click();
    await expect.poll(async () => backend.backendCalls.some(call =>
      call.action === 'git' &&
      call.body.subcommand === 'config_set' &&
      call.body.key === 'http.proxy' &&
      call.body.value === 'http://127.0.0.1:7890'
    )).toBe(true);
    await page.locator('[data-action="_clearGitProxyConfig"]').click();
    await expectGitCommand(backend, 'config_unset');

    await page.fill('#gitSyncTargetBranch', 'main-e2e');
    await page.locator('[data-action="_doFetch"]').click();
    await expectGitCommand(backend, 'fetch');
    await page.locator('[data-action="_doPull"]').click();
    await expectGitCommand(backend, 'pull');
    await page.locator('[data-handler="_doPush"][data-value="false"]').click();
    await expectGitCommand(backend, 'scan_diff');
    await expectGitCommand(backend, 'push');

    clientErrors.expectNoErrors();
  });

  test('LMS learning page covers cookie auth, todos, homework, course materials, and downloads with mocks', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page);

    await openLmsPanel(page);
    await saveManualLmsCookie(page);
    await page.locator('#lmsPanelBody [data-handler="lmsPanelSetPage"][data-value="lms"]').click();
    await expect(page.locator('#lmsPanelBody')).toContainText('E2E Homework');
    await expect(page.locator('#lmsPanelBody')).toContainText('Software Engineering');
    await expect.poll(() => backend.lmsProxyCalls.some(call => call.path === '/api/todos')).toBe(true);
    await expect.poll(() => backend.lmsProxyCalls.some(call => call.path === '/api/my-courses')).toBe(true);

    await page.locator('#lmsTab_todos').click();
    await page.locator('#lmsPanelBody [data-handler="lmsPanelShowHomework"]').first().click();
    await expect(page.locator('#lmsModal')).toHaveClass(/show/);
    await expect(page.locator('#lmsModalContent')).toContainText('E2E Homework');
    await page.locator('[data-action="lmsPanelCloseModal"]').last().click();
    await expect(page.locator('#lmsModal')).not.toHaveClass(/show/);

    await page.locator('#lmsTab_courses').click();
    await page.locator('#lmsPanelBody [data-handler="lmsPanelShowMaterials"][data-value="801"]').first().click();
    await expect(page.locator('#lmsPanelBody')).toContainText('week-1-slides.pdf');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('#lmsPanelBody [data-handler="lmsPanelDownload"][data-value="901"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('week-1-slides');
    await expect.poll(() => backend.lmsProxyCalls.some(call => call.path === '/api/uploads/901/url')).toBe(true);

    clientErrors.expectNoErrors();
  });

  test('LMS service pages query scores, schedule, rooms, attendance, judge, and training plan without real accounts', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page);

    await openLmsPanel(page);
    await saveManualLmsCookie(page);

    await openLmsHomePage(page, 'scores');
    await page.fill('#lmsScoreTerm', 'all');
    await page.locator('[data-action="lmsPanelFetchScores"]').click();
    await expect(page.locator('#lmsPanelBody')).toContainText('Applied AI');
    await page.locator('[data-handler="lmsPanelSelectAllScores"][data-value="false"]').click();

    await openLmsHomePage(page, 'schedule');
    await page.fill('#lmsScheduleTerm', '2025-2026-1');
    await page.locator('[data-action="lmsPanelFetchSchedule"]').click();
    await expect(page.locator('#lmsPanelBody')).toContainText('Prof. E2E');

    await openLmsHomePage(page, 'emptyRooms');
    await page.fill('#lmsEmptyRoomDate', '2026-07-05');
    await page.locator('[data-action="lmsPanelFetchEmptyRooms"]').click();
    await expect(page.locator('#lmsPanelBody')).toContainText('A101');

    await openLmsHomePage(page, 'attendance');
    await page.fill('#lmsAttendanceStartDate', '2026-07-01');
    await page.fill('#lmsAttendanceEndDate', '2026-07-05');
    await page.selectOption('#lmsAttendancePageSize', '10');
    await page.locator('[data-action="lmsPanelFetchAttendance"]').click();
    await expect(page.locator('#lmsPanelBody')).toContainText('flow-1');
    await page.locator('[data-action="lmsPanelAttendanceNextPage"]').click();
    await expect(page.locator('#lmsPanelBody')).toContainText('flow-2');

    await openLmsHomePage(page, 'judge');
    await page.fill('#lmsJudgeComment', 'E2E teaching feedback');
    await page.locator('[data-action="lmsPanelFetchJudgeStatus"]').click();
    await expect(page.locator('#lmsPanelBody')).toContainText('Teaching Survey');
    await page.locator('[data-action="lmsPanelSubmitJudgeAll"]').click();
    await expect(page.locator('#lmsPanelBody')).toContainText('submitted');

    await openLmsHomePage(page, 'trainingPlan');
    await page.locator('[data-action="lmsPanelFetchTrainingPlan"]').click();
    await expect(page.locator('#lmsPanelBody')).toContainText('E2E Training Plan');
    await expect(page.locator('#lmsPanelBody')).toContainText('Core Courses');

    const paths = backend.lmsServiceCalls.map(call => call.path);
    expect(paths).toEqual(expect.arrayContaining([
      '/lms-scores',
      '/lms-schedule',
      '/lms-empty-rooms',
      '/lms-attendance',
      '/lms-judge',
      '/lms-training-plan'
    ]));
    clientErrors.expectNoErrors();
  });
});
