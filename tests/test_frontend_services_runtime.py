import shutil
import subprocess
import tempfile
import textwrap
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class FrontendServiceRuntimeTests(unittest.TestCase):
    @unittest.skipIf(shutil.which('node') is None, 'node is required for frontend runtime smoke tests')
    def test_service_modules_delegate_at_runtime(self):
        script = textwrap.dedent(
            r"""
            const assert = require('assert');
            const fs = require('fs');
            const path = require('path');
            const vm = require('vm');

            const root = process.cwd();
            const listeners = {};
            const elements = {};
            let clickedId = null;
            const sandbox = {
              console,
              document: {
                documentElement: { contains: () => true },
                addEventListener(type, handler) {
                  listeners[type] = handler;
                },
                getElementById(id) {
                  if (!elements[id]) {
                    elements[id] = {
                  id,
                  value: '',
                  textContent: '',
                  hidden: false,
                  removed: false,
                  classList: {
                    removed: [],
                    remove(name) {
                      this.removed.push(name);
                    }
                  },
                  click() {
                    clickedId = id;
                  },
                  remove() {
                    this.removed = true;
                  }
                    };
                  }
                  return elements[id];
                }
              }
            };
            sandbox.window = sandbox;
            sandbox.globalThis = sandbox;
            vm.createContext(sandbox);

            function run(file) {
              const code = fs.readFileSync(path.join(root, file), 'utf8');
              vm.runInContext(code, sandbox, { filename: file });
            }

            run('js/app-context.js');

            sandbox.toast = (message, ms) => {
              sandbox.toastArgs = [message, ms];
              return 'toast-result';
            };
            sandbox.renderMessages = () => {
              sandbox.rendered = true;
            };
            sandbox.refreshMsgNode = (idx, chat) => {
              sandbox.refreshArgs = [idx, chat.id];
            };
            sandbox.updateSendBtn = () => {
              sandbox.sendBtnUpdated = true;
            };

            run('js/ui-service.js');
            const ui = sandbox.AgentApp.require('uiService');
            assert.strictEqual(ui.toast('hello', 5), 'toast-result');
            assert.deepStrictEqual(sandbox.toastArgs, ['hello', 5]);
            ui.renderMessages();
            assert.strictEqual(sandbox.rendered, true);
            ui.refreshMsgNode(2, { id: 'chat-1' });
            assert.deepStrictEqual(sandbox.refreshArgs, [2, 'chat-1']);
            ui.updateSendBtn();
            assert.strictEqual(sandbox.sendBtnUpdated, true);

            run('js/orchestration-service.js');

            sandbox.AgentApp.define('apiCore', {
              callAPI(roundLimit, options) {
                return { kind: 'api', roundLimit, options };
              },
              callOnceWithRole(history, model, rolePrompt, options) {
                return { kind: 'role', history, model, rolePrompt, options };
              }
            });
            sandbox.AgentApp.define('tools', {
              executeTool(name, args, context) {
                return { kind: 'tool', name, args, context };
              }
            });
            sandbox.AgentApp.define('planCore', {
              callAPIWithPlan(options) {
                return { kind: 'plan', options };
              }
            });
            sandbox.AgentApp.define('outlineCore', {
              callAPIWithOutline(options) {
                return { kind: 'outline', options };
              }
            });

            const orchestration = sandbox.AgentApp.require('orchestrationService');
            assert.deepStrictEqual(orchestration.callAPI(3, { a: 1 }), {
              kind: 'api',
              roundLimit: 3,
              options: { a: 1 }
            });
            assert.deepStrictEqual(orchestration.callAPIWithPlan({ chatId: 'c1' }), {
              kind: 'plan',
              options: { chatId: 'c1' }
            });
            assert.deepStrictEqual(orchestration.executeTool('read', { path: 'a' }, { chatId: 'c1' }), {
              kind: 'tool',
              name: 'read',
              args: { path: 'a' },
              context: { chatId: 'c1' }
            });
            assert.deepStrictEqual(orchestration.callOnceWithRole([{ role: 'user', content: 'x' }], 'm', 'p', { sourceLabel: 's' }), {
              kind: 'role',
              history: [{ role: 'user', content: 'x' }],
              model: 'm',
              rolePrompt: 'p',
              options: { sourceLabel: 's' }
            });

            sandbox.newChat = () => {
              sandbox.newChatCalled = true;
            };
            sandbox.saveSettings = () => {
              sandbox.saveSettingsCalled = true;
            };
            sandbox.onPickFiles = (event) => {
              sandbox.pickFilesEvent = event;
            };
            sandbox.openSettingsSection = (section) => {
              sandbox.openedSettingsSection = section;
            };
            sandbox.toggleTheme = () => {
              sandbox.themeToggled = true;
            };
            sandbox.closeSettings = () => {
              sandbox.settingsClosed = true;
            };
            sandbox.updateUrlPreview = () => {
              sandbox.urlPreviewUpdated = true;
            };
            sandbox.openCurrentFileInMainPanel = (kind) => {
              sandbox.openedMainPanelKind = kind;
            };
            sandbox.filterFetchModels = () => {
              sandbox.fetchModelsFiltered = true;
            };
            sandbox.applyPlanPreset = (value) => {
              sandbox.planPreset = value;
            };
            sandbox.applyPreset = (value) => {
              sandbox.reflectionPreset = value;
            };
            sandbox.switchMcpSkillTab = (value) => {
              sandbox.mcpTab = value;
            };
            sandbox.initProjectInstructions = (createIfMissing) => {
              sandbox.projectInstructionsCreate = createIfMissing;
            };
            sandbox.initProjectMemory = (forceReload) => {
              sandbox.projectMemoryForceReload = forceReload;
            };
            sandbox.saveSkillRootsFromUi = () => {
              sandbox.skillRootsSaved = true;
            };
            sandbox.taskQueueOpenChat = (taskId) => {
              sandbox.taskQueueOpenChatId = taskId;
            };
            sandbox.taskQueuePauseItem = (taskId) => {
              sandbox.taskQueuePauseItemId = taskId;
            };
            sandbox.taskQueueSaveDefaults = () => {
              sandbox.taskQueueDefaultsSaved = true;
            };
            sandbox.taskQueueUpdateItemOrder = (taskId, value) => {
              sandbox.taskQueueOrderArgs = [taskId, value];
            };
            sandbox.taskQueueUpdateItemExpose = (taskId, checked) => {
              sandbox.taskQueueExposeArgs = [taskId, checked];
            };
            sandbox.taskQueueUpdateItemText = (taskId, value) => {
              sandbox.taskQueueTextArgs = [taskId, value];
            };
            sandbox.addPresetTool = (value) => {
              sandbox.presetTool = value;
            };
            sandbox.switchJsonTab = (tab, target) => {
              sandbox.jsonTabArgs = [tab, target.dataset.jsontab];
            };
            sandbox.shellAuditConfirmReject = (aborted) => {
              sandbox.shellAuditRejected = aborted;
            };
            sandbox.importFromFile = (event) => {
              sandbox.importEvent = event;
            };
            sandbox.exportDialogManagedChat = (format) => {
              sandbox.dialogExportFormat = format;
            };
            sandbox.setDialogExportChat = (chatId) => {
              sandbox.dialogExportChatId = chatId;
            };
            sandbox.lmsPanelSetTab = (tab) => {
              sandbox.lmsTab = tab;
            };
            sandbox.lmsPanelDownload = (id, name) => {
              sandbox.lmsDownloadArgs = [id, name];
            };
            sandbox.lmsPanelSetScoreTerm = (value) => {
              sandbox.lmsScoreTerm = value;
            };
            sandbox.lmsPanelSetScoreAccountType = (value) => {
              sandbox.lmsScoreAccountType = value;
            };
            sandbox.lmsPanelLoginWithPassword = () => {
              sandbox.lmsLoginSubmitted = true;
            };
            sandbox.syncPlanSettingRange = (rangeId, inputId, valueId) => {
              sandbox.syncedPlanRange = [rangeId, inputId, valueId];
            };
            sandbox.syncPlanSettingInput = (inputId, rangeId, valueId, min, max, fallback) => {
              sandbox.syncedPlanInput = [inputId, rangeId, valueId, min, max, fallback];
            };
            sandbox._selectFile = (path, source) => {
              sandbox.gitSelectedFile = [path, source];
            };
            sandbox._doPush = (force) => {
              sandbox.gitPushForce = force;
            };
            sandbox._onRemoteTargetBranchInput = (target) => {
              sandbox.gitInputTargetValue = target.value;
            };
            sandbox._normalizeRemoteTargetBranchInput = (target) => {
              sandbox.gitBlurTargetValue = target.value;
            };
            sandbox._updateGitProxyPreview = () => {
              sandbox.gitProxyPreviewUpdated = true;
            };
            sandbox.refreshMusicLibrary = (showToast) => {
              sandbox.musicRefreshShowToast = showToast;
            };
            sandbox.musicPlayIndex = (idx) => {
              sandbox.musicPlayIndexValue = idx;
            };
            sandbox.musicImportFiles = (event) => {
              sandbox.musicImportEvent = event;
            };
            sandbox.musicOpenLocalFiles = (event) => {
              sandbox.musicOpenEvent = event;
            };
            sandbox.musicSetVolume = (value) => {
              sandbox.musicVolume = value;
            };
            sandbox.musicSetMuted = (value) => {
              sandbox.musicMuted = value;
            };
            sandbox.toggleRatePause = () => {
              sandbox.ratePauseToggled = true;
            };
            sandbox.applyRatePreset = (value) => {
              sandbox.ratePreset = value;
            };
            sandbox.editPlanStep = (msgIdx, stepIdx) => {
              sandbox.planEditArgs = [msgIdx, stepIdx];
            };
            sandbox.approveAndExecutePlan = (msgIdx) => {
              sandbox.planApproveIdx = msgIdx;
            };
            sandbox.togglePlanPanel = (msgIdx) => {
              sandbox.planToggleIdx = msgIdx;
            };
            sandbox.debateTimeoutSliderChanged = (kind) => {
              sandbox.debateSliderKind = kind;
            };
            sandbox.debateTimeoutInputChanged = (kind) => {
              sandbox.debateInputKind = kind;
            };
            sandbox.debateProfileChanged = (role) => {
              sandbox.debateProfileRole = role;
            };
            sandbox.debateManualWin = (chatId, side) => {
              sandbox.debateManualWinArgs = [chatId, side];
            };
            sandbox.openDebateChat = (chatId) => {
              sandbox.debateOpenedChat = chatId;
            };
            sandbox.copyMsg = (idx) => {
              sandbox.copiedMsgIdx = idx;
            };
            sandbox.deleteMessageTurn = (idx) => {
              sandbox.deletedMessageTurnIdx = idx;
            };
            sandbox.jumpToDialogMessage = (idx) => {
              sandbox.dialogJumpIdx = idx;
            };
            sandbox.renameTimelineNode = (idx) => {
              sandbox.dialogRenameIdx = idx;
            };
            sandbox.dialogExplorerEnterFolder = (folderId) => {
              sandbox.dialogEnteredFolder = folderId;
            };
            sandbox.dialogExplorerToggleView = (mode) => {
              sandbox.dialogViewMode = mode;
            };
            sandbox.dialogExplorerToggleSort = (mode) => {
              sandbox.dialogSortMode = mode;
            };
            sandbox.dialogExplorerContextMenu = (event, type, id) => {
              sandbox.dialogContextMenuArgs = [event.type, type, id];
              return false;
            };
            sandbox.dialogExplorerDragStart = (event, type, id) => {
              sandbox.dialogDragStartArgs = [event.type, type, id];
            };
            sandbox.dialogExplorerDragEnd = (event) => {
              sandbox.dialogDragEndEvent = event.type;
            };
            sandbox.dialogExplorerItemDragOver = (event) => {
              sandbox.dialogDragOverEvent = event.type;
            };
            sandbox.dialogExplorerItemDragLeave = (event) => {
              sandbox.dialogDragLeaveEvent = event.type;
            };
            sandbox.dialogExplorerItemDrop = (event, targetFolderId) => {
              sandbox.dialogDropArgs = [event.type, targetFolderId];
            };
            sandbox.switchDialogManagerChat = (chatId) => {
              sandbox.dialogSwitchedChat = chatId;
            };
            sandbox.applyPromptToChat = (promptId) => {
              sandbox.dialogAppliedPrompt = promptId;
            };
            sandbox.finishOutlineNow = (idx) => {
              sandbox.outlineFinishIdx = idx;
            };
            sandbox.restoreOutlineCheckpoint = (idx) => {
              sandbox.outlineRestoreIdx = idx;
            };
            sandbox.concurrentSelectTargetChanged = () => {
              sandbox.concurrentTargetChanged = true;
            };
            sandbox.openConcurrentChat = (chatId) => {
              sandbox.concurrentOpenedChat = chatId;
            };
            sandbox.setTokenUsageQuickRange = (mode) => {
              sandbox.tokenQuickRange = mode;
            };
            sandbox.onTokenUsageDateChange = (value) => {
              sandbox.tokenDate = value;
            };
            sandbox.onTokenUsageRangeChange = (field, value) => {
              sandbox.tokenRangeArgs = [field, value];
            };
            sandbox.editResendUserMsg = (idx) => {
              sandbox.editResendIdx = idx;
            };
            sandbox.removeAttachment = (id) => {
              sandbox.removedAttachmentId = id;
            };
            sandbox.closePricingManager = () => {
              sandbox.pricingClosed = true;
            };
            sandbox.removePricingRow = (idx) => {
              sandbox.pricingRemovedIdx = idx;
            };
            sandbox.setPricingCurrency = (target, currency) => {
              sandbox.pricingCurrencyArgs = [target.dataset.value, currency];
            };
            sandbox.renderSecurityRecords = () => {
              sandbox.securityRecordsRendered = true;
            };
            sandbox.clearSecurityRecords = () => {
              sandbox.securityRecordsCleared = true;
            };
            sandbox.closeHealthCheckModal = () => {
              sandbox.healthModalClosed = true;
            };
            sandbox.copyInlineFileContent = () => {
              sandbox.inlineFileCopied = true;
            };
            sandbox.editTool = (idx) => {
              sandbox.editedToolIdx = idx;
            };
            sandbox.deleteTool = (idx) => {
              sandbox.deletedToolIdx = idx;
            };
            sandbox.copyTraceJson = (id) => {
              sandbox.copiedTraceId = id;
            };
            sandbox.toggleTraceExpand = (id) => {
              sandbox.toggledTraceId = id;
            };
            sandbox.selectJsonResponse = (idx) => {
              sandbox.selectedJsonResponseIdx = idx;
            };
            sandbox.copyHistoryRequest = (idx) => {
              sandbox.copiedHistoryRequestIdx = idx;
            };
            sandbox.copyCode = (id) => {
              sandbox.copiedCodeId = id;
            };
            sandbox.onTogglePermission = (category, checked) => {
              sandbox.permissionToggleArgs = [category, checked];
            };
            sandbox.toggleMcpServer = (id) => {
              sandbox.toggledMcpServer = id;
            };
            sandbox.discoverMcpServer = (id) => {
              sandbox.discoveredMcpServer = id;
            };
            sandbox.toggleSkill = (path, checked) => {
              sandbox.skillToggleArgs = [path, checked];
            };
            sandbox.closeContextLimitSettings = () => {
              sandbox.contextLimitClosed = true;
            };
            sandbox.removeContextLimitRow = (idx) => {
              sandbox.contextLimitRemovedIdx = idx;
            };
            sandbox.setCurrentModelFromPicker = (model, event) => {
              sandbox.modelPickerArgs = [model, event && event.type];
            };
            sandbox.onFetchModelItemToggle = (target) => {
              sandbox.fetchModelToggleValue = target.value;
            };
            sandbox.manualCompress = () => {
              sandbox.manualCompressCalled = true;
            };
            sandbox.refreshAccurateTokenCount = (force) => {
              sandbox.refreshAccurateTokenForce = force;
            };
            sandbox.resetTokenStats = () => {
              sandbox.tokenStatsReset = true;
            };
            sandbox.openContextLimitSettings = () => {
              sandbox.contextLimitOpened = true;
            };
            sandbox.openPricingManager = () => {
              sandbox.pricingOpened = true;
            };
            sandbox.closePrivacySettings = () => {
              sandbox.privacyClosed = true;
            };
            sandbox.savePrivacySettingsFromUi = () => {
              sandbox.privacySaved = true;
            };
            sandbox.saveShellAuditSettingsFromUi = () => {
              sandbox.shellAuditSaved = (sandbox.shellAuditSaved || 0) + 1;
            };
            sandbox.onShellAuditProfileChange = () => {
              sandbox.shellAuditProfileChanged = true;
            };
            sandbox.resetShellAuditPrompt = () => {
              sandbox.shellAuditPromptReset = true;
            };
            sandbox.closePptSettings = () => {
              sandbox.pptSettingsClosed = true;
            };
            sandbox.resetPptPromptsToDefault = () => {
              sandbox.pptPromptsReset = true;
            };
            sandbox.savePptSettings = () => {
              sandbox.pptSettingsSaved = true;
            };
            sandbox.resumePptTaskFromPanel = (idx, skipGuidance) => {
              sandbox.pptResumeArgs = [idx, skipGuidance];
            };
            sandbox.pausePptTaskFromPanel = (idx) => {
              sandbox.pptPauseIdx = idx;
            };
            sandbox.cancelPptTaskFromPanel = (idx) => {
              sandbox.pptCancelIdx = idx;
            };
            sandbox.togglePptPanel = (idx) => {
              sandbox.pptToggleIdx = idx;
            };
            sandbox.handlePptGuidancePaste = (event) => {
              sandbox.pptPasteEvent = event;
            };
            sandbox.handlePptGuidanceDragOver = (event) => {
              sandbox.pptDragOverEvent = event;
            };
            sandbox.handlePptGuidanceDrop = (event) => {
              sandbox.pptDropEvent = event;
            };

            run('js/event-delegation.js');
            assert.strictEqual(typeof listeners.click, 'function');
            assert.strictEqual(typeof listeners.change, 'function');
            assert.strictEqual(typeof listeners.input, 'function');
            assert.strictEqual(typeof listeners.focusout, 'function');
            assert.strictEqual(typeof listeners.paste, 'function');
            assert.strictEqual(typeof listeners.dragover, 'function');
            assert.strictEqual(typeof listeners.drop, 'function');

            function eventTarget(dataset, attr, value = '', closestMap = {}) {
              return {
                dataset,
                value,
                closest(selector) {
                  if (selector === '[' + attr + ']') return this;
                  if (closestMap[selector]) return closestMap[selector];
                  return null;
                }
              };
            }

            let prevented = false;
            listeners.click({
              target: eventTarget({ action: 'newChat' }, 'data-action'),
              preventDefault() {
                prevented = true;
              }
            });
            assert.strictEqual(prevented, true);
            assert.strictEqual(sandbox.newChatCalled, true);

            listeners.click({
              target: eventTarget({ action: 'openFilePicker', target: 'fileInput' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(clickedId, 'fileInput');

            listeners.click({
              target: eventTarget({ action: 'openSettingsSection', settingsSection: 'git' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.openedSettingsSection, 'git');

            listeners.click({
              target: eventTarget({ action: 'toggleTheme' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.themeToggled, true);

            listeners.click({
              target: eventTarget({ action: 'closeSettings' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.settingsClosed, true);

            listeners.click({
              target: eventTarget({ action: 'openCurrentFileInMainPanel', kind: 'pdf' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.openedMainPanelKind, 'pdf');

            listeners.click({
              target: eventTarget({ action: 'toggleRatePause' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.ratePauseToggled, true);

            listeners.click({
              target: eventTarget({ action: 'applyPlanPreset', value: 'code' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.planPreset, 'code');

            listeners.click({
              target: eventTarget({ action: 'applyPreset', value: 'math' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.reflectionPreset, 'math');

            listeners.click({
              target: eventTarget({ action: 'switchMcpSkillTab', value: 'skills' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.mcpTab, 'skills');

            listeners.click({
              target: eventTarget({ action: 'initProjectInstructions', createIfMissing: 'false' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.projectInstructionsCreate, false);

            listeners.click({
              target: eventTarget({ action: 'initProjectMemory', forceReload: 'true' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.projectMemoryForceReload, true);

            listeners.click({
              target: eventTarget({ action: 'taskQueueOpenChat', taskId: 'q_1' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.taskQueueOpenChatId, 'q_1');

            listeners.click({
              target: eventTarget({ action: 'taskQueuePauseItem', taskId: 'q_2' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.taskQueuePauseItemId, 'q_2');

            listeners.click({
              target: eventTarget({ action: 'addPresetTool', value: 'weather' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.presetTool, 'weather');

            listeners.click({
              target: eventTarget({ action: 'hideModal', target: 'toolEditModal' }, 'data-action'),
              preventDefault() {}
            });
            assert.deepStrictEqual(elements.toolEditModal.classList.removed, ['show']);

            listeners.click({
              target: eventTarget({ action: 'hideTarget', target: 'gitConfigInline' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(elements.gitConfigInline.hidden, true);

            listeners.click({
              target: eventTarget({ action: 'removeTarget', target: 'gitRemotePanel' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(elements.gitRemotePanel.removed, true);

            const closestModal = { removed: false, remove() { this.removed = true; } };
            listeners.click({
              target: eventTarget({ action: 'removeClosest', selector: '.modal-mask' }, 'data-action', '', { '.modal-mask': closestModal }),
              preventDefault() {}
            });
            assert.strictEqual(closestModal.removed, true);

            const selfTarget = eventTarget({ action: 'hideSelf' }, 'data-action');
            selfTarget.classList = { removed: [], remove(name) { this.removed.push(name); } };
            listeners.click({
              target: selfTarget,
              preventDefault() {}
            });
            assert.deepStrictEqual(selfTarget.classList.removed, ['show']);

            listeners.click({
              target: eventTarget({ action: 'switchJsonTab', jsontab: 'headers' }, 'data-action'),
              preventDefault() {}
            });
            assert.deepStrictEqual(sandbox.jsonTabArgs, ['headers', 'headers']);

            listeners.click({
              target: eventTarget({ action: 'shellAuditConfirmReject', aborted: 'false' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.shellAuditRejected, false);

            listeners.click({
              target: eventTarget({ action: 'exportDialogManagedChat', value: 'pdf' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.dialogExportFormat, 'pdf');

            listeners.click({
              target: eventTarget({ action: 'valueClick', handler: 'lmsPanelSetTab', value: 'todos' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.lmsTab, 'todos');

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'lmsPanelDownload',
                value: '42',
                valueType: 'number',
                extraValue: 'slides.pdf'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.deepStrictEqual(sandbox.lmsDownloadArgs, [42, 'slides.pdf']);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: '_selectFile',
                value: 'src/app.js',
                extraValue: 'unstaged'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.deepStrictEqual(sandbox.gitSelectedFile, ['src/app.js', 'unstaged']);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: '_doPush',
                value: 'true',
                valueType: 'boolean'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.gitPushForce, true);

            let stopped = false;
            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: '_doPush',
                value: 'false',
                valueType: 'boolean',
                stopPropagation: 'true'
              }, 'data-action'),
              preventDefault() {},
              stopPropagation() {
                stopped = true;
              }
            });
            assert.strictEqual(stopped, true);
            assert.strictEqual(sandbox.gitPushForce, false);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'refreshMusicLibrary',
                value: 'true',
                valueType: 'boolean'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.musicRefreshShowToast, true);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'musicPlayIndex',
                value: '3',
                valueType: 'number'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.musicPlayIndexValue, 3);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'applyRatePreset',
                value: 'safe'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.ratePreset, 'safe');

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'editPlanStep',
                value: '8',
                valueType: 'number',
                extraValue: '2',
                extraType: 'number',
                stopPropagation: 'true'
              }, 'data-action'),
              preventDefault() {},
              stopPropagation() {}
            });
            assert.deepStrictEqual(sandbox.planEditArgs, [8, 2]);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'approveAndExecutePlan',
                value: '4',
                valueType: 'number'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.planApproveIdx, 4);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'togglePlanPanel',
                value: '5',
                valueType: 'number'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.planToggleIdx, 5);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'debateManualWin',
                value: 'debate-chat',
                extraValue: 'pro'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.deepStrictEqual(sandbox.debateManualWinArgs, ['debate-chat', 'pro']);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'openDebateChat',
                value: 'chat-9'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.debateOpenedChat, 'chat-9');

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'copyMsg',
                value: '12',
                valueType: 'number'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.copiedMsgIdx, 12);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'deleteMessageTurn',
                value: '12',
                valueType: 'number'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.deletedMessageTurnIdx, 12);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'jumpToDialogMessage',
                value: '6',
                valueType: 'number'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.dialogJumpIdx, 6);

            let renameStopped = false;
            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'renameTimelineNode',
                value: '7',
                valueType: 'number',
                stopPropagation: 'true'
              }, 'data-action'),
              preventDefault() {},
              stopPropagation() {
                renameStopped = true;
              }
            });
            assert.strictEqual(renameStopped, true);
            assert.strictEqual(sandbox.dialogRenameIdx, 7);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'dialogExplorerEnterFolder',
                value: 'folder-1'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.dialogEnteredFolder, 'folder-1');

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'dialogExplorerToggleView',
                value: 'list'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.dialogViewMode, 'list');

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'switchDialogManagerChat',
                value: 'chat-dialog'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.dialogSwitchedChat, 'chat-dialog');

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'applyPromptToChat',
                value: 'prompt-1'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.dialogAppliedPrompt, 'prompt-1');

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'finishOutlineNow',
                value: '10',
                valueType: 'number'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.outlineFinishIdx, 10);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'restoreOutlineCheckpoint',
                value: '11',
                valueType: 'number'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.outlineRestoreIdx, 11);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'openConcurrentChat',
                value: 'concurrent-chat'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.concurrentOpenedChat, 'concurrent-chat');

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'setTokenUsageQuickRange',
                value: '30d'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.tokenQuickRange, '30d');

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'editResendUserMsg',
                value: '13',
                valueType: 'number'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.editResendIdx, 13);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'removeAttachment',
                value: 'att-1'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.removedAttachmentId, 'att-1');

            listeners.click({
              target: eventTarget({ action: 'closePricingManager' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.pricingClosed, true);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'removePricingRow',
                value: '2',
                valueType: 'number'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.pricingRemovedIdx, 2);

            listeners.click({
              target: eventTarget({
                action: 'setPricingCurrency',
                value: 'CNY'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.deepStrictEqual(sandbox.pricingCurrencyArgs, ['CNY', 'CNY']);

            listeners.click({
              target: eventTarget({ action: 'clearSecurityRecords' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.securityRecordsCleared, true);

            listeners.click({
              target: eventTarget({ action: 'closeHealthCheckModal' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.healthModalClosed, true);

            listeners.click({
              target: eventTarget({ action: 'copyInlineFileContent' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.inlineFileCopied, true);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'editTool',
                value: '4',
                valueType: 'number',
                stopPropagation: 'true'
              }, 'data-action'),
              preventDefault() {},
              stopPropagation() {}
            });
            assert.strictEqual(sandbox.editedToolIdx, 4);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'copyTraceJson',
                value: 'tr_abc'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.copiedTraceId, 'tr_abc');

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'toggleTraceExpand',
                value: 'tr_def'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.toggledTraceId, 'tr_def');

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'selectJsonResponse',
                value: '5',
                valueType: 'number'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.selectedJsonResponseIdx, 5);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'copyHistoryRequest',
                value: '6',
                valueType: 'number'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.copiedHistoryRequestIdx, 6);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'copyCode',
                value: 'code_abc'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.copiedCodeId, 'code_abc');

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'toggleMcpServer',
                value: 'mcp-1',
                stopPropagation: 'true'
              }, 'data-action'),
              preventDefault() {},
              stopPropagation() {}
            });
            assert.strictEqual(sandbox.toggledMcpServer, 'mcp-1');

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'discoverMcpServer',
                value: 'mcp-2'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.discoveredMcpServer, 'mcp-2');

            listeners.click({
              target: eventTarget({ action: 'closePptSettings' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.pptSettingsClosed, true);

            listeners.click({
              target: eventTarget({ action: 'closePrivacySettings' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.privacyClosed, true);

            listeners.click({
              target: eventTarget({ action: 'savePrivacySettingsFromUi' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.privacySaved, true);

            listeners.click({
              target: eventTarget({ action: 'closeContextLimitSettings' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.contextLimitClosed, true);

            listeners.click({
              target: eventTarget({ action: 'manualCompress' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.manualCompressCalled, true);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'refreshAccurateTokenCount',
                value: 'true',
                valueType: 'boolean'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.refreshAccurateTokenForce, true);

            listeners.click({
              target: eventTarget({ action: 'resetTokenStats' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.tokenStatsReset, true);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'removeContextLimitRow',
                value: '7',
                valueType: 'number'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.contextLimitRemovedIdx, 7);

            const modelPickerEvent = {
              type: 'click',
              target: eventTarget({ action: 'setCurrentModelFromPicker', model: 'gpt-4o' }, 'data-action'),
              preventDefault() {}
            };
            listeners.click(modelPickerEvent);
            assert.deepStrictEqual(sandbox.modelPickerArgs, ['gpt-4o', 'click']);

            listeners.click({
              target: eventTarget({
                action: 'hideModalAndCall',
                target: 'tokenDetailModal',
                handler: 'openContextLimitSettings'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.deepStrictEqual(elements.tokenDetailModal.classList.removed, ['show']);
            assert.strictEqual(sandbox.contextLimitOpened, true);

            listeners.click({
              target: eventTarget({
                action: 'hideModalAndCall',
                target: 'tokenDetailModal',
                handler: 'openPricingManager'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.pricingOpened, true);

            listeners.click({
              target: eventTarget({ action: 'resetShellAuditPrompt' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.shellAuditPromptReset, true);

            listeners.click({
              target: eventTarget({ action: 'resetPptPromptsToDefault' }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.pptPromptsReset, true);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'resumePptTaskFromPanel',
                value: '14',
                valueType: 'number',
                extraValue: 'true',
                extraType: 'boolean'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.deepStrictEqual(sandbox.pptResumeArgs, [14, true]);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'pausePptTaskFromPanel',
                value: '15',
                valueType: 'number'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.pptPauseIdx, 15);

            listeners.click({
              target: eventTarget({
                action: 'valueClick',
                handler: 'togglePptPanel',
                value: '16',
                valueType: 'number'
              }, 'data-action'),
              preventDefault() {}
            });
            assert.strictEqual(sandbox.pptToggleIdx, 16);

            const collapsedParent = {
              toggled: [],
              classList: {
                toggle(name) {
                  collapsedParent.toggled.push(name);
                }
              }
            };
            const collapseTarget = eventTarget({ action: 'toggleParentCollapsed' }, 'data-action');
            collapseTarget.parentElement = collapsedParent;
            listeners.click({
              target: collapseTarget,
              preventDefault() {}
            });
            assert.deepStrictEqual(collapsedParent.toggled, ['collapsed']);

            const changeEvent = {
              target: eventTarget({ changeAction: 'saveSettings' }, 'data-change-action')
            };
            listeners.change(changeEvent);
            assert.strictEqual(sandbox.saveSettingsCalled, true);

            listeners.change({
              target: eventTarget({ changeAction: 'updateUrlPreview' }, 'data-change-action')
            });
            assert.strictEqual(sandbox.urlPreviewUpdated, true);

            listeners.change({
              target: eventTarget({ changeAction: 'updateGitProxyPreview' }, 'data-change-action')
            });
            assert.strictEqual(sandbox.gitProxyPreviewUpdated, true);

            listeners.change({
              target: eventTarget({ changeAction: 'saveSkillRootsFromUi' }, 'data-change-action')
            });
            assert.strictEqual(sandbox.skillRootsSaved, true);

            listeners.change({
              target: eventTarget({ changeAction: 'taskQueueSaveDefaults' }, 'data-change-action')
            });
            assert.strictEqual(sandbox.taskQueueDefaultsSaved, true);

            const importEvent = {
              target: eventTarget({ changeAction: 'importFromFile' }, 'data-change-action')
            };
            listeners.change(importEvent);
            assert.strictEqual(sandbox.importEvent, importEvent);

            const musicImportEvent = {
              target: eventTarget({ changeAction: 'musicImportFiles' }, 'data-change-action')
            };
            listeners.change(musicImportEvent);
            assert.strictEqual(sandbox.musicImportEvent, musicImportEvent);

            const musicOpenEvent = {
              target: eventTarget({ changeAction: 'musicOpenLocalFiles' }, 'data-change-action')
            };
            listeners.change(musicOpenEvent);
            assert.strictEqual(sandbox.musicOpenEvent, musicOpenEvent);

            listeners.change({
              target: eventTarget({ changeAction: 'setDialogExportChat' }, 'data-change-action', 'chat-7')
            });
            assert.strictEqual(sandbox.dialogExportChatId, 'chat-7');

            listeners.change({
              target: eventTarget({ changeAction: 'valueChange', handler: 'lmsPanelSetScoreAccountType' }, 'data-change-action', 'undergraduate')
            });
            assert.strictEqual(sandbox.lmsScoreAccountType, 'undergraduate');

            listeners.change({
              target: eventTarget({ changeAction: 'valueChange', handler: 'debateProfileChanged', value: 'judge' }, 'data-change-action', '__current')
            });
            assert.strictEqual(sandbox.debateProfileRole, 'judge');

            listeners.change({
              target: eventTarget({ changeAction: 'valueChange', handler: 'dialogExplorerToggleSort' }, 'data-change-action', 'recent')
            });
            assert.strictEqual(sandbox.dialogSortMode, 'recent');

            listeners.change({
              target: eventTarget({ changeAction: 'concurrentSelectTargetChanged' }, 'data-change-action')
            });
            assert.strictEqual(sandbox.concurrentTargetChanged, true);

            listeners.change({
              target: eventTarget({ changeAction: 'renderSecurityRecords' }, 'data-change-action')
            });
            assert.strictEqual(sandbox.securityRecordsRendered, true);

            listeners.change({
              target: eventTarget({ changeAction: 'saveShellAuditSettingsFromUi' }, 'data-change-action')
            });
            assert.strictEqual(sandbox.shellAuditSaved, 1);

            listeners.change({
              target: eventTarget({ changeAction: 'onShellAuditProfileChange' }, 'data-change-action')
            });
            assert.strictEqual(sandbox.shellAuditProfileChanged, true);

            listeners.change({
              target: eventTarget({ changeAction: 'onFetchModelItemToggle' }, 'data-change-action', 'gpt-4o-mini')
            });
            assert.strictEqual(sandbox.fetchModelToggleValue, 'gpt-4o-mini');

            listeners.change({
              target: eventTarget({ changeAction: 'tokenUsageDateChange' }, 'data-change-action', '2026-07-05')
            });
            assert.strictEqual(sandbox.tokenDate, '2026-07-05');

            listeners.change({
              target: eventTarget({ changeAction: 'tokenUsageRangeChange', field: 'start' }, 'data-change-action', '2026-07-01')
            });
            assert.deepStrictEqual(sandbox.tokenRangeArgs, ['start', '2026-07-01']);

            listeners.change({
              target: eventTarget({ changeAction: 'taskQueueUpdateItemOrder', taskId: 'q_3' }, 'data-change-action', '4')
            });
            assert.deepStrictEqual(sandbox.taskQueueOrderArgs, ['q_3', '4']);

            const exposeTarget = eventTarget({ changeAction: 'taskQueueUpdateItemExpose', taskId: 'q_4' }, 'data-change-action');
            exposeTarget.checked = true;
            listeners.change({ target: exposeTarget });
            assert.deepStrictEqual(sandbox.taskQueueExposeArgs, ['q_4', true]);

            const musicMutedTarget = eventTarget({ changeAction: 'valueChange', handler: 'musicSetMuted' }, 'data-change-action');
            musicMutedTarget.type = 'checkbox';
            musicMutedTarget.checked = true;
            listeners.change({ target: musicMutedTarget });
            assert.strictEqual(sandbox.musicMuted, true);

            const permissionTarget = eventTarget({
              changeAction: 'valueChange',
              handler: 'onTogglePermission',
              value: 'shell',
              checkedArg: 'true'
            }, 'data-change-action');
            permissionTarget.type = 'checkbox';
            permissionTarget.checked = true;
            listeners.change({ target: permissionTarget });
            assert.deepStrictEqual(sandbox.permissionToggleArgs, ['shell', true]);

            const skillTarget = eventTarget({
              changeAction: 'valueChange',
              handler: 'toggleSkill',
              value: 'C:/skills/demo',
              checkedArg: 'true'
            }, 'data-change-action');
            skillTarget.type = 'checkbox';
            skillTarget.checked = false;
            listeners.change({ target: skillTarget });
            assert.deepStrictEqual(sandbox.skillToggleArgs, ['C:/skills/demo', false]);

            listeners.input({
              target: eventTarget({ inputAction: 'setLabelFromValue', labelTarget: 'tempVal' }, 'data-input-action', '1.2')
            });
            assert.strictEqual(elements.tempVal.textContent, '1.2');

            listeners.input({
              target: eventTarget({ inputAction: 'setLabelFromValue', labelTarget: 'volumeVal', suffix: '%' }, 'data-input-action', '80')
            });
            assert.strictEqual(elements.volumeVal.textContent, '80%');

            listeners.input({
              target: eventTarget({ inputAction: 'syncMaxToolRoundsRange' }, 'data-input-action', '32')
            });
            assert.strictEqual(elements.maxToolRoundsVal.textContent, '32');
            assert.strictEqual(elements.maxToolRoundsInput.value, '32');

            listeners.input({
              target: eventTarget({ inputAction: 'syncMaxToolRoundsInput' }, 'data-input-action', '150')
            });
            assert.strictEqual(elements.maxToolRoundsVal.textContent, '150');
            assert.strictEqual(elements.maxToolRounds.value, 100);

            listeners.input({
              target: eventTarget({ inputAction: 'filterFetchModels' }, 'data-input-action', 'qwen')
            });
            assert.strictEqual(sandbox.fetchModelsFiltered, true);

            const planRangeTarget = eventTarget({
                inputAction: 'syncPlanSettingRange',
                inputTarget: 'plan_maxStepsInput',
                labelTarget: 'planMaxStepsVal'
              }, 'data-input-action', '6');
            planRangeTarget.id = 'plan_maxSteps';
            listeners.input({ target: planRangeTarget });
            assert.deepStrictEqual(sandbox.syncedPlanRange, ['plan_maxSteps', 'plan_maxStepsInput', 'planMaxStepsVal']);

            const planNumberTarget = eventTarget({
              inputAction: 'syncPlanSettingInput',
              rangeTarget: 'plan_maxSteps',
              labelTarget: 'planMaxStepsVal',
              min: '2',
              max: '10',
              fallback: '5'
            }, 'data-input-action', '6');
            planNumberTarget.id = 'plan_maxStepsInput';
            listeners.input({ target: planNumberTarget });
            assert.deepStrictEqual(sandbox.syncedPlanInput, ['plan_maxStepsInput', 'plan_maxSteps', 'planMaxStepsVal', 2, 10, 5]);

            listeners.input({
              target: eventTarget({ inputAction: 'taskQueueUpdateItemText', taskId: 'q_5' }, 'data-input-action', 'new task')
            });
            assert.deepStrictEqual(sandbox.taskQueueTextArgs, ['q_5', 'new task']);

            listeners.input({
              target: eventTarget({ inputAction: 'valueInput', handler: 'lmsPanelSetScoreTerm' }, 'data-input-action', '2024-2025-1')
            });
            assert.strictEqual(sandbox.lmsScoreTerm, '2024-2025-1');

            listeners.input({
              target: eventTarget({ inputAction: 'valueInput', handler: 'musicSetVolume' }, 'data-input-action', '80')
            });
            assert.strictEqual(sandbox.musicVolume, '80');

            listeners.input({
              target: eventTarget({ inputAction: 'valueInput', handler: 'debateTimeoutSliderChanged', value: 'Review' }, 'data-input-action', '60')
            });
            assert.strictEqual(sandbox.debateSliderKind, 'Review');

            listeners.input({
              target: eventTarget({ inputAction: 'valueInput', handler: 'debateTimeoutInputChanged', value: 'FinalJudge' }, 'data-input-action', '180')
            });
            assert.strictEqual(sandbox.debateInputKind, 'FinalJudge');

            sandbox.gitProxyPreviewUpdated = false;
            listeners.input({
              target: eventTarget({ inputAction: 'updateGitProxyPreview' }, 'data-input-action', '7890')
            });
            assert.strictEqual(sandbox.gitProxyPreviewUpdated, true);

            listeners.input({
              target: eventTarget({ inputAction: 'saveShellAuditSettingsFromUi' }, 'data-input-action', 'audit prompt')
            });
            assert.strictEqual(sandbox.shellAuditSaved, 2);

            listeners.input({
              target: eventTarget({ inputAction: 'valueInputTarget', inputHandler: '_onRemoteTargetBranchInput' }, 'data-input-action', 'feature/refactor')
            });
            assert.strictEqual(sandbox.gitInputTargetValue, 'feature/refactor');

            listeners.focusout({
              target: eventTarget({ blurAction: 'valueBlurTarget', blurHandler: '_normalizeRemoteTargetBranchInput' }, 'data-blur-action', 'origin/main')
            });
            assert.strictEqual(sandbox.gitBlurTargetValue, 'origin/main');

            const pasteEvent = {
              target: eventTarget({ pasteAction: 'handlePptGuidancePaste' }, 'data-paste-action')
            };
            listeners.paste(pasteEvent);
            assert.strictEqual(sandbox.pptPasteEvent, pasteEvent);

            let contextPrevented = false;
            listeners.contextmenu({
              type: 'contextmenu',
              target: eventTarget({
                contextmenuAction: 'dialogExplorerContextMenu',
                contextmenuValue: 'chat',
                contextmenuExtraValue: 'chat-1'
              }, 'data-contextmenu-action'),
              preventDefault() {
                contextPrevented = true;
              }
            });
            assert.strictEqual(contextPrevented, true);
            assert.deepStrictEqual(sandbox.dialogContextMenuArgs, ['contextmenu', 'chat', 'chat-1']);

            listeners.dragstart({
              type: 'dragstart',
              target: eventTarget({
                dragstartAction: 'dialogExplorerDragStart',
                dragstartValue: 'folder',
                dragstartExtraValue: 'folder-1'
              }, 'data-dragstart-action')
            });
            assert.deepStrictEqual(sandbox.dialogDragStartArgs, ['dragstart', 'folder', 'folder-1']);

            listeners.dragend({
              type: 'dragend',
              target: eventTarget({ dragendAction: 'dialogExplorerDragEnd' }, 'data-dragend-action')
            });
            assert.strictEqual(sandbox.dialogDragEndEvent, 'dragend');

            const dragOverEvent = {
              type: 'dragover',
              target: eventTarget({ dragoverAction: 'handlePptGuidanceDragOver' }, 'data-dragover-action')
            };
            listeners.dragover(dragOverEvent);
            assert.strictEqual(sandbox.pptDragOverEvent, dragOverEvent);

            listeners.dragover({
              type: 'dragover',
              target: eventTarget({ dragoverAction: 'dialogExplorerItemDragOver' }, 'data-dragover-action')
            });
            assert.strictEqual(sandbox.dialogDragOverEvent, 'dragover');

            listeners.dragleave({
              type: 'dragleave',
              target: eventTarget({ dragleaveAction: 'dialogExplorerItemDragLeave' }, 'data-dragleave-action')
            });
            assert.strictEqual(sandbox.dialogDragLeaveEvent, 'dragleave');

            const dropEvent = {
              type: 'drop',
              target: eventTarget({ dropAction: 'handlePptGuidanceDrop' }, 'data-drop-action')
            };
            listeners.drop(dropEvent);
            assert.strictEqual(sandbox.pptDropEvent, dropEvent);

            listeners.drop({
              type: 'drop',
              target: eventTarget({
                dropAction: 'dialogExplorerItemDrop',
                dropValue: 'folder-2'
              }, 'data-drop-action')
            });
            assert.deepStrictEqual(sandbox.dialogDropArgs, ['drop', 'folder-2']);

            let enterPrevented = false;
            listeners.keydown({
              key: 'Enter',
              target: eventTarget({ keydownAction: 'enterGlobal', handler: 'lmsPanelLoginWithPassword' }, 'data-keydown-action'),
              preventDefault() {
                enterPrevented = true;
              }
            });
            assert.strictEqual(enterPrevented, true);
            assert.strictEqual(sandbox.lmsLoginSubmitted, true);
            """
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / 'frontend_service_runtime_test.js'
            script_path.write_text(script, encoding='utf-8')
            completed = subprocess.run(
                ['node', str(script_path)],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )
        self.assertEqual(
            completed.returncode,
            0,
            msg=f'node runtime service smoke failed\nSTDOUT:\n{completed.stdout}\nSTDERR:\n{completed.stderr}',
        )

    @unittest.skipIf(shutil.which('node') is None, 'node is required for frontend runtime smoke tests')
    def test_regenerate_truncates_entire_tool_turn(self):
        script = textwrap.dedent(
            r"""
            const assert = require('assert');
            const fs = require('fs');
            const path = require('path');
            const vm = require('vm');

            const root = process.cwd();
            const sandbox = { console };
            sandbox.window = sandbox;
            sandbox.globalThis = sandbox;
            vm.createContext(sandbox);

            function run(file) {
              const code = fs.readFileSync(path.join(root, file), 'utf8');
              vm.runInContext(code, sandbox, { filename: file });
            }

            run('js/app-context.js');
            sandbox.AgentApp.define('state', {
              state: { settings: {}, pendingAttachments: [], pendingAIAttachments: [] },
              saveData() {},
              persistSettings() {},
              currentChat() { return null; },
              chatById() { return null; },
              isCurrentChat() { return false; },
              chatTaskById() { return null; },
              isChatGenerating() { return false; },
              syncGlobalTaskState() {},
              requestStopChatTask() { return false; }
            });
            sandbox.AgentApp.define('orchestrationService', {});

            run('js/chat.js');
            const chat = sandbox.AgentApp.require('chat');
            const plain = value => JSON.parse(JSON.stringify(value));
            const messages = [
              { role: 'user', content: 'please inspect files' },
              {
                role: 'assistant',
                content: '',
                tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{}' } }]
              },
              { role: 'tool', tool_call_id: 'call_1', name: 'read_file', content: 'file contents' },
              { role: 'assistant', content: 'final answer' }
            ];
            assert.strictEqual(chat._findRegenerateCutIndex(messages, 3), 1);
            assert.strictEqual(chat._findRegenerateCutIndex(messages, 1), 1);
            assert.deepStrictEqual(plain(chat._findMessageTurnBounds(messages, 3)), { start: 0, end: 4, count: 4 });
            assert.deepStrictEqual(plain(chat._findMessageTurnBounds(messages, 1)), { start: 0, end: 4, count: 4 });

            const multiTurn = [
              { role: 'user', content: 'first' },
              { role: 'assistant', content: 'first answer' },
              { role: 'user', content: 'second' },
              messages[1],
              messages[2],
              messages[3]
            ];
            assert.strictEqual(chat._findRegenerateCutIndex(multiTurn, 5), 3);
            assert.strictEqual(chat._findRegenerateCutIndex([{ role: 'assistant', content: 'orphan' }], 1), 0);
            assert.deepStrictEqual(plain(chat._findMessageTurnBounds(multiTurn, 1)), { start: 0, end: 2, count: 2 });
            assert.deepStrictEqual(plain(chat._findMessageTurnBounds(multiTurn, 5)), { start: 2, end: 6, count: 4 });

            const withHiddenBeaconBeforeNextUser = [
              { role: 'user', content: 'first' },
              { role: 'assistant', content: 'first answer' },
              { role: 'user', content: 'hidden beacon', _hiddenFromUI: true, _isBeacon: true },
              { role: 'assistant', content: 'hidden ack', _hiddenFromUI: true, _isBeacon: true },
              { role: 'user', content: 'second' },
              { role: 'assistant', content: 'second answer' }
            ];
            assert.deepStrictEqual(plain(chat._findMessageTurnBounds(withHiddenBeaconBeforeNextUser, 1)), { start: 0, end: 2, count: 2 });

            const withHiddenContextInsideToolTurn = [
              { role: 'user', content: 'inspect attachment' },
              messages[1],
              { role: 'user', content: 'hidden attachment context', _hiddenFromUI: true, _concurrentAttachment: true },
              messages[2],
              messages[3],
              { role: 'user', content: 'next visible question' }
            ];
            assert.deepStrictEqual(plain(chat._findMessageTurnBounds(withHiddenContextInsideToolTurn, 1)), { start: 0, end: 5, count: 5 });
            """
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / 'regenerate_cut_index_test.js'
            script_path.write_text(script, encoding='utf-8')
            completed = subprocess.run(
                ['node', str(script_path)],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )
        self.assertEqual(
            completed.returncode,
            0,
            msg=f'regenerate cut index runtime test failed\nSTDOUT:\n{completed.stdout}\nSTDERR:\n{completed.stderr}',
        )

    @unittest.skipIf(shutil.which('node') is None, 'node is required for frontend runtime smoke tests')
    def test_responses_input_fills_missing_function_call_outputs(self):
        script = textwrap.dedent(
            r"""
            const assert = require('assert');
            const fs = require('fs');
            const path = require('path');
            const vm = require('vm');

            const root = process.cwd();
            const sandbox = { console };
            sandbox.window = sandbox;
            sandbox.globalThis = sandbox;
            vm.createContext(sandbox);

            function run(file) {
              const code = fs.readFileSync(path.join(root, file), 'utf8');
              vm.runInContext(code, sandbox, { filename: file });
            }

            run('js/app-context.js');
            sandbox.AgentApp.define('state', {
              state: { settings: { systemPrompt: '' } }
            });

            run('js/api-adapters.js');
            const adapters = sandbox.AgentApp.require('apiAdapters');
            const fixed = adapters.fixOpenAIResponsesInputSequence([
              { role: 'user', content: 'inspect' },
              { type: 'function_call', call_id: 'call_1', name: 'read_file', arguments: '{}' },
              { role: 'user', content: 'next message' }
            ]);
            assert.strictEqual(fixed[2].type, 'function_call_output');
            assert.strictEqual(fixed[2].call_id, 'call_1');
            assert.strictEqual(fixed[3].role, 'user');

            const complete = adapters.fixOpenAIResponsesInputSequence([
              { type: 'function_call', call_id: 'call_2', name: 'read_file', arguments: '{}' },
              { type: 'function_call_output', call_id: 'call_2', output: 'ok' }
            ]);
            assert.strictEqual(complete.length, 2);

            const built = adapters.buildOpenAIResponsesInput([
              { role: 'user', content: 'inspect' },
              {
                role: 'assistant',
                content: '',
                _responsesOutput: [{ type: 'function_call', call_id: 'call_3', name: 'read_file', arguments: '{}' }]
              }
            ]);
            assert.strictEqual(built[built.length - 1].type, 'function_call_output');
            assert.strictEqual(built[built.length - 1].call_id, 'call_3');
            """
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / 'responses_input_sequence_test.js'
            script_path.write_text(script, encoding='utf-8')
            completed = subprocess.run(
                ['node', str(script_path)],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )
        self.assertEqual(
            completed.returncode,
            0,
            msg=f'responses input sequence runtime test failed\nSTDOUT:\n{completed.stdout}\nSTDERR:\n{completed.stderr}',
        )

    @unittest.skipIf(shutil.which('node') is None, 'node is required for frontend runtime smoke tests')
    def test_temporary_chat_stop_does_not_abort_background_chat(self):
        script = textwrap.dedent(
            r"""
            const assert = require('assert');
            const fs = require('fs');
            const path = require('path');
            const vm = require('vm');

            const root = process.cwd();
            const elements = {};
            const sandbox = {
              console,
              storage: { get() { return null; }, set() {}, remove() {}, flush() {} },
              confirm() { return true; },
              document: {
                querySelectorAll() { return []; },
                getElementById(id) {
                  if (!elements[id]) {
                    elements[id] = {
                      id,
                      value: '',
                      textContent: '',
                      classList: { add() {}, remove() {}, toggle() {} }
                    };
                  }
                  return elements[id];
                }
              }
            };
            sandbox.window = sandbox;
            sandbox.globalThis = sandbox;
            sandbox.addEventListener = () => {};
            vm.createContext(sandbox);

            function run(file) {
              const code = fs.readFileSync(path.join(root, file), 'utf8');
              vm.runInContext(code, sandbox, { filename: file });
            }

            run('js/app-context.js');
            sandbox.AgentApp.define('uiService', {
              toast() {},
              updateSendBtn() {},
              renderChatList() {},
              renderMessages() {}
            });
            run('js/config.js');
            run('js/state.js');
            run('js/api-stream.js');

            const stateModule = sandbox.AgentApp.require('state');
            const apiStream = sandbox.AgentApp.require('apiStream');
            const state = stateModule.state;
            const original = { id: 'chat-original', title: 'original', messages: [] };
            state.chats = [original];
            state.currentId = original.id;

            let aborted = false;
            const ctrl = {
              signal: { aborted: false },
              abort() {
                aborted = true;
                this.signal.aborted = true;
              }
            };
            stateModule.beginChatTask(original.id, ctrl, { resetStop: true });
            assert.strictEqual(state.abortCtrl, ctrl);
            assert.strictEqual(state.activeTaskChatId, original.id);

            state.temporaryChat = stateModule.createTemporaryChat();
            state.currentId = state.temporaryChat.id;
            stateModule.syncGlobalTaskState(state.currentId);
            assert.strictEqual(state.activeTaskChatId, original.id);
            assert.strictEqual(state.abortCtrl, null);
            assert.strictEqual(state.stopRequested, false);

            apiStream.stopGenerate();
            assert.strictEqual(aborted, false);
            assert.strictEqual(ctrl.signal.aborted, false);
            assert.strictEqual(stateModule.chatTaskById(original.id).stopRequested, false);
          """
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / 'temporary_chat_background_abort_test.js'
            script_path.write_text(script, encoding='utf-8')
            completed = subprocess.run(
                ['node', str(script_path)],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )
        self.assertEqual(
            completed.returncode,
            0,
            msg=f'temporary chat background abort runtime test failed\nSTDOUT:\n{completed.stdout}\nSTDERR:\n{completed.stderr}',
        )

    @unittest.skipIf(shutil.which('node') is None, 'node is required for frontend runtime smoke tests')
    def test_outline_save_enforces_initial_item_limit(self):
        script = textwrap.dedent(
            r"""
            const assert = require('assert');
            const fs = require('fs');
            const path = require('path');
            const vm = require('vm');

            const root = process.cwd();
            const sandbox = { console };
            sandbox.window = sandbox;
            sandbox.globalThis = sandbox;
            vm.createContext(sandbox);

            function run(file) {
              const code = fs.readFileSync(path.join(root, file), 'utf8');
              vm.runInContext(code, sandbox, { filename: file });
            }

            run('js/app-context.js');
            sandbox.AgentApp.define('state', {
              state: { settings: { outlineMaxItems: 4 }, pendingAttachments: [], pendingAIAttachments: [] },
              saveData() {},
              currentChat() { return null; },
              chatById() { return null; },
              isCurrentChat() { return false; },
              isChatGenerating() { return false; },
              beginChatTask() { return {}; },
              setChatTaskMode() {},
              updateChatTaskController() {},
              clearChatTask() {},
              activeTaskChat() { return null; }
            });
            sandbox.AgentApp.define('orchestrationService', {});
            sandbox.AgentApp.define('uiService', {
              toast() {},
              renderMessages() {},
              refreshMsgNode() {},
              updateSendBtn() {}
            });

            run('js/outline-prompts.js');
            run('js/outline-core.js');

            const outlineCore = sandbox.AgentApp.require('outlineCore');
            const codePrompt = outlineCore.buildOutlineSystemPromptForProfile('', [], { domain: 'coding' });
            assert.match(codePrompt, /不超过 4 项/);
            const sixItems = Array.from({ length: 6 }, (_, idx) => ({
              id: `a${idx + 1}`,
              title: `step ${idx + 1}`,
              status: 'pending'
            }));
            const outline = { items: [] };
            const result = outlineCore.handleOutlineTool('save_outline', { items: sixItems }, outline);
            assert.strictEqual(result.ok, true);
            assert.strictEqual(outline.items.length, 4);
            assert.deepStrictEqual(outline.items.map(item => item.id), ['a1', 'a2', 'a3', 'a4']);
            assert.match(result.value, /初始上限 4/);
            assert.match(result.value, /截断 2 项/);

            const appendResult = outlineCore.handleOutlineTool(
              'append_outline',
              { id: 'a5', title: 'extra step' },
              outline
            );
            assert.strictEqual(appendResult.ok, true);
            assert.strictEqual(outline.items.length, 5);

            const rewritten = sixItems.map((item, idx) => ({ ...item, id: `b${idx + 1}` }));
            const rewriteResult = outlineCore.handleOutlineTool('save_outline', { items: rewritten }, outline);
            assert.strictEqual(rewriteResult.ok, true);
            assert.strictEqual(outline.items.length, 6);
            assert.doesNotMatch(rewriteResult.value, /截断/);
            """
        )

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / 'outline_initial_item_limit_test.js'
            script_path.write_text(script, encoding='utf-8')
            completed = subprocess.run(
                ['node', str(script_path)],
                cwd=ROOT,
                text=True,
                capture_output=True,
                check=False,
            )
        self.assertEqual(
            completed.returncode,
            0,
            msg=f'outline initial item limit runtime test failed\nSTDOUT:\n{completed.stdout}\nSTDERR:\n{completed.stderr}',
        )


if __name__ == '__main__':
    unittest.main()
