const { test, expect } = require('@playwright/test');
const {
  gotoApp
} = require('./helpers');

async function openSettingsSection(page, section) {
  await page.locator('button[data-action="openSettings"]').first().click();
  await expect(page.locator('#settingsPage')).toHaveClass(/show/);
  await page.locator(`.settings-nav-item[data-settings-section="${section}"]`).click();
  await expect(page.locator('#settingsPageContent .settings-docked-panel')).toBeVisible();
}

async function gitCalls(backend, subcommand) {
  return backend.backendCalls.filter(call => call.action === 'git' && call.body.subcommand === subcommand);
}

async function expectGitCall(backend, subcommand, predicate = () => true) {
  await expect.poll(async () => (await gitCalls(backend, subcommand)).some(predicate)).toBe(true);
}

async function acceptGitDanger(page) {
  const modal = page.locator('.git-danger-mask').last();
  await expect(modal).toBeVisible();
  await modal.locator('.git-danger-input').fill('我确定');
  await expect(modal.locator('[data-act="ok"]')).toBeEnabled();
  await modal.locator('[data-act="ok"]').click();
  await expect(modal).toBeHidden();
}

async function openGitBranchMenu(page) {
  const trigger = page
    .locator('[data-action="_toggleBranchMenu"]')
    .filter({ has: page.locator('#gitBranchInlineBadge') });
  await trigger.click();
  const menu = page.locator('#gitBranchMenu');
  await expect(menu).not.toHaveAttribute('hidden', '');
  const triggerBox = await trigger.boundingBox();
  const menuBox = await menu.boundingBox();
  expect(triggerBox).not.toBeNull();
  expect(menuBox).not.toBeNull();
  expect(Math.abs((menuBox.x + menuBox.width) - (triggerBox.x + triggerBox.width))).toBeLessThan(36);
  expect(menuBox.y).toBeGreaterThanOrEqual(triggerBox.y - 4);
}

async function openLmsPanel(page) {
  await page.locator('[data-action="openLmsPanel"]').click();
  await expect(page.locator('#lmsPanel')).toHaveClass(/show/);
}

async function openExplorer(page) {
  await page.locator('#sidebarExplorerBtn').click();
  await expect(page.locator('#sidebarExplorerPanel')).not.toHaveAttribute('hidden', '');
  await expect(page.locator('#fileExplorerList')).toContainText('sample.txt');
}

async function openFileFromExplorer(page, name) {
  await page.locator('.file-explorer-item').filter({ hasText: name }).click();
}

async function openFileContextMenu(page, name) {
  await page.locator('.file-explorer-item').filter({ hasText: name }).click({ button: 'right' });
  await expect(page.locator('#fileExplorerContextMenu')).not.toHaveAttribute('hidden', '');
}

async function openBlankExplorerContextMenu(page) {
  await page.locator('#fileExplorerList').evaluate(el => {
    el.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 120,
      clientY: 180
    }));
  });
  await expect(page.locator('#fileExplorerContextMenu')).not.toHaveAttribute('hidden', '');
}

async function clickContextMenuAction(page, action) {
  await page.locator(`#fileExplorerContextMenu [data-action="${action}"]:visible`).click();
}

async function installBrowserStubs(page) {
  await page.addInitScript(() => {
    window.__e2eClipboard = '';
    window.__openedUrls = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async text => {
          window.__e2eClipboard = String(text);
        }
      }
    });
    window.open = url => {
      window.__openedUrls.push(String(url));
      return null;
    };
  });
}

test.describe('extra Git, LMS, and file explorer E2E coverage without real services', () => {
  test('Git branch menu, commit-and-push, recovery, config clearing, and credential help use mocked Git', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page);

    await openSettingsSection(page, 'git');
    await expect(page.locator('#gitBody')).toContainText('js/pricing.js');

    await openGitBranchMenu(page);
    await page.locator('#gitBranchMenu [data-action="_doBranchCreate"]').click();
    await expectGitCall(backend, 'branch_create', call => call.body.name === 'e2e-value');

    await openGitBranchMenu(page);
    await page.locator('#gitBranchMenu [data-action="_doBranchRename"]').click();
    await expectGitCall(backend, 'branch_rename', call => call.body.new === 'e2e-value');

    await openGitBranchMenu(page);
    await page.locator('#gitBranchMenu .git-branch-item[data-name="feature/e2e"]').click();
    await acceptGitDanger(page);
    await expectGitCall(backend, 'branch_switch', call => call.body.name === 'feature/e2e');

    await page.fill('#gitCommitMsg', 'E2E commit and push');
    await page.locator('[data-action="_onCommitAndPush"]').click();
    await expectGitCall(backend, 'commit', call => call.body.message === 'E2E commit and push');
    await expectGitCall(backend, 'push');

    await page.locator('[data-action="_showGitConfigInline"]').first().click();
    await expect(page.locator('#cfgUserName')).toBeVisible();
    await page.locator('#gitConfigInline [data-action="_clearGitConfig"]').click();
    await expectGitCall(backend, 'config_set', call => call.body.key === 'user.name' && call.body.value === '');
    await expectGitCall(backend, 'config_set', call => call.body.key === 'user.email' && call.body.value === '');

    await page.locator('[data-action="_undoLastReset"]').click();
    await acceptGitDanger(page);
    await expectGitCall(backend, 'reset_orig_head');

    await page.locator('#gitBody [data-action="_openRemotePanel"]').first().click();
    await expect(page.locator('#gitRemotePanel')).toHaveClass(/show/);
    await page.locator('[data-action="_showCredHelp"]').click();
    await expect(page.locator('.git-help-box')).toContainText('GitHub');
    await page.locator('.git-help-box [data-action="removeClosest"]').click();
    await expect(page.locator('.git-help-box')).toHaveCount(0);

    clientErrors.expectNoErrors();
  });

  test('Git init wizard initializes an empty mocked workspace', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page, { gitInRepo: false });

    await openSettingsSection(page, 'git');
    await expect(page.locator('#gitBody')).toContainText('初始化');
    await page.fill('#initUserName', 'Init E2E User');
    await page.fill('#initUserEmail', 'init-e2e@example.test');
    await page.locator('[data-action="_doInit"]').click();
    await expectGitCall(backend, 'init', call =>
      call.body.userName === 'Init E2E User' &&
      call.body.userEmail === 'init-e2e@example.test'
    );

    clientErrors.expectNoErrors();
  });

  test('LMS login dialog covers saved credentials, MFA, explicit refreshes, attendance paging, and cookie clearing', async ({ page }) => {
    const { backend, clientErrors } = await gotoApp(page, {
      lmsHasSavedCredential: true,
      lmsLoginRequiresMfa: true
    });

    await openLmsPanel(page);
    await page.locator('#lmsStatusBar [data-handler="lmsPanelOpenCookieEditor"][data-value="login"]').first().click();
    await expect(page.locator('#lmsCookieModal')).toHaveClass(/show/);
    await expect(page.locator('#lmsSavedCredentialBox')).toContainText('e2e-student');
    await page.locator('[data-action="lmsPanelClearSavedCredential"]').click();
    await expect.poll(() => backend.lmsServiceCalls.some(call =>
      call.path === '/lms-login' && call.body.action === 'clear_credentials'
    )).toBe(true);

    await page.fill('#lmsLoginUsername', 'e2e-student');
    await page.fill('#lmsLoginPassword', 'fake-password');
    await page.locator('#lmsLoginRemember').check();
    await page.locator('[data-action="lmsPanelLoginWithPassword"]').click();
    await expect(page.locator('#lmsLoginMfaBox')).toBeVisible();
    await page.locator('[data-action="lmsPanelSendMfaCode"]').click();
    await page.fill('#lmsLoginMfaCode', '123456');
    await page.locator('[data-action="lmsPanelVerifyMfaCode"]').click();
    await expect(page.locator('#lmsCookieModal')).not.toHaveClass(/show/);

    await page.locator('#lmsPanelBody [data-handler="lmsPanelSetPage"][data-value="lms"]').click();
    await expect(page.locator('#lmsPanelBody')).toContainText('E2E Homework');
    await page.locator('#lmsTab_todos').click();
    await page.locator('#lmsPanelBody [data-action="lmsPanelFetchTodos"]').click();
    await expect(page.locator('#lmsPanelBody')).toContainText('E2E Homework');
    await page.locator('#lmsTab_courses').click();
    await page.locator('#lmsPanelBody [data-action="lmsPanelFetchCourses"]').click();
    await expect(page.locator('#lmsPanelBody')).toContainText('Software Engineering');

    await page.locator('#lmsPanelBody [data-handler="lmsPanelSetPage"][data-value="home"]').click();
    await page.locator('#lmsPanelBody [data-handler="lmsPanelSetPage"][data-value="attendance"]').click();
    await page.locator('[data-action="lmsPanelFetchAttendance"]').click();
    await expect(page.locator('#lmsPanelBody')).toContainText('flow-1');
    await page.locator('[data-action="lmsPanelAttendanceNextPage"]').click();
    await expect(page.locator('#lmsPanelBody')).toContainText('flow-2');
    await page.locator('[data-action="lmsPanelAttendancePrevPage"]').click();
    await expect(page.locator('#lmsPanelBody')).toContainText('flow-1');

    await page.locator('#lmsStatusBar [data-handler="lmsPanelOpenCookieEditor"][data-value="cookie"]').first().click();
    await expect(page.locator('#lmsCookieModal')).toHaveClass(/show/);
    await page.locator('[data-action="lmsPanelClearCookie"]').click();
    await expect(page.locator('#lmsCookieModal')).not.toHaveClass(/show/);

    expect(backend.lmsServiceCalls.map(call => call.body.action)).toEqual(expect.arrayContaining([
      'credential_status',
      'clear_credentials',
      'start',
      'send_mfa',
      'verify_mfa'
    ]));
    clientErrors.expectNoErrors();
  });

  test('file explorer context menus, editor controls, inline panel, clipboard, and workspace navigation use mocked backend', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installBrowserStubs(page);
    const { backend, clientErrors } = await gotoApp(page, {
      dialogResponses: ['e2e-created.txt', 'reload-confirm', 'e2e-folder']
    });

    await openExplorer(page);
    await openBlankExplorerContextMenu(page);
    await clickContextMenuAction(page, 'new-file');
    await expect(page.locator('#fileEditorModal')).toHaveClass(/show/);
    await expect(page.locator('#fileEditorPath')).toContainText('e2e-created.txt');
    await expect.poll(() => backend.backendCalls.some(call =>
      call.action === 'create_file' && call.body.path === 'e2e-created.txt'
    )).toBe(true);

    await page.fill('#fileEditorContent', 'clipboard from file editor');
    await page.locator('[data-action="copyFileEditorContent"]').click();
    await expect.poll(() => page.evaluate(() => window.__e2eClipboard)).toBe('clipboard from file editor');
    await page.fill('#fileEditorContent', 'changed before reload');
    await page.locator('[data-action="reloadFileEditor"]').click();
    await expect(page.locator('#fileEditorContent')).toHaveValue(/Sample file content/);
    await page.locator('[data-action="openCurrentFileInMainPanel"][data-kind="text"]').click();
    await expect(page.locator('#fileEditorModal')).not.toHaveClass(/show/);
    await expect(page.locator('#inlineFilePanel')).not.toHaveAttribute('hidden', '');
    await page.locator('[data-action="copyInlineFileContent"]').click();
    await expect.poll(() => page.evaluate(() => window.__e2eClipboard)).toContain('Sample file content');
    await page.locator('[data-action="closeInlineFilePanel"]').click();

    await openBlankExplorerContextMenu(page);
    await clickContextMenuAction(page, 'new-folder');
    await expect.poll(() => backend.backendCalls.some(call =>
      call.action === 'create_dir' && call.body.path === 'e2e-folder'
    )).toBe(true);

    await openFileContextMenu(page, 'sample.txt');
    await clickContextMenuAction(page, 'copy-path');
    await expect.poll(() => page.evaluate(() => window.__e2eClipboard)).toBe('sample.txt');

    await openFileFromExplorer(page, 'sample.md');
    await expect(page.locator('#fileEditorModal')).toHaveClass(/show/);
    await page.locator('[data-action="toggleFileEditorMarkdownPreview"]').click();
    await expect(page.locator('#fileEditorMarkdownPreview')).toBeVisible();
    await page.locator('[data-action="closeFileEditor"]').first().click();

    await openFileFromExplorer(page, 'sample.py');
    await expect(page.locator('#fileEditorModal')).toHaveClass(/show/);
    await page.locator('[data-action="toggleFileEditorCodePreview"]').click();
    await expect(page.locator('#fileEditorMarkdownPreview')).toBeVisible();
    await page.locator('[data-action="closeFileEditor"]').first().click();

    await openFileFromExplorer(page, 'src');
    await expect(page.locator('#fileExplorerPath')).toHaveText('src');
    await page.locator('[data-action="fileExplorerGoUp"]').click();
    await expect(page.locator('#fileExplorerPath')).toHaveText('.');
    const listCallsBeforeRefresh = backend.backendCalls.filter(call => call.action === 'list_dir').length;
    await page.locator('[data-action="refreshFileExplorer"]').click();
    await expect.poll(() => backend.backendCalls.filter(call => call.action === 'list_dir').length).toBeGreaterThan(listCallsBeforeRefresh);

    clientErrors.expectNoErrors();
  });

  test('file explorer previews PDF, image, media, inline PDF new-tab, and TeX compilation via mocked backend', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installBrowserStubs(page);
    const { backend, clientErrors } = await gotoApp(page);

    await openExplorer(page);
    await openFileFromExplorer(page, 'sample.pdf');
    await expect(page.locator('#pdfViewerModal')).toHaveClass(/show/);
    await page.locator('[data-action="openPdfViewerInNewTab"]').click();
    await expect.poll(() => page.evaluate(() => window.__openedUrls.length)).toBe(1);
    await page.locator('[data-action="openCurrentFileInMainPanel"][data-kind="pdf"]').click();
    await expect(page.locator('#inlineFilePanel')).not.toHaveAttribute('hidden', '');
    await page.locator('[data-action="openInlineFileInNewTab"]').click();
    await expect.poll(() => page.evaluate(() => window.__openedUrls.length)).toBe(2);
    await page.locator('[data-action="closeInlineFilePanel"]').click();

    await openFileFromExplorer(page, 'sample.png');
    await expect(page.locator('#imageViewerModal')).toHaveClass(/show/);
    await page.locator('[data-action="openImageViewerInNewTab"]').click();
    await expect.poll(() => page.evaluate(() => window.__openedUrls.length)).toBe(3);
    await page.locator('#imageViewerModal [data-action="closeImageViewer"]').last().click();

    await openFileFromExplorer(page, 'sample.mp3');
    await expect(page.locator('#mediaViewerModal')).toHaveClass(/show/);
    await page.locator('[data-action="openMediaViewerInNewTab"]').click();
    await expect.poll(() => page.evaluate(() => window.__openedUrls.length)).toBe(4);
    await page.locator('#mediaViewerModal [data-action="closeMediaViewer"]').last().click();

    await openFileContextMenu(page, 'sample.tex');
    await clickContextMenuAction(page, 'compile-tex');
    await expect.poll(() => backend.backendCalls.some(call =>
      call.action === 'compile_tex' && call.body.path === 'sample.tex'
    )).toBe(true);
    await expect(page.locator('#pdfViewerModal')).toHaveClass(/show/);

    clientErrors.expectNoErrors();
  });
});
