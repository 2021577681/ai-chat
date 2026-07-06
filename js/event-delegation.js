(function(global) {
  'use strict';

  const AgentApp = global.AgentApp;
  if (!AgentApp) throw new Error('AgentApp registry must load before event-delegation.js');

  let initialized = false;

  function globalFn(name) {
    const fn = global[name];
    return typeof fn === 'function' ? fn : null;
  }

  function callGlobal(name, args = []) {
    const fn = globalFn(name);
    if (!fn) {
      console.warn('[domEvents] handler not loaded:', name);
      return undefined;
    }
    return fn(...args);
  }

  const directClickActions = new Set([
    'toggleSidebarExplorer',
    'collapseSidebar',
    'refreshWorkspaceInfo',
    'selectWorkspaceFromUi',
    'newChat',
    'fileExplorerGoUp',
    'refreshFileExplorer',
    'openWorkspaceTerminal',
    'openRemoteConnection',
    'openSettings',
    'toggleSidebar',
    'toggleStatsBar',
    'startTemporaryChat',
    'togglePlan',
    'openGoalPanel',
    'closeGoalPanel',
    'createGoalFromUi',
    'continueActiveGoal',
    'pauseActiveGoal',
    'cancelActiveGoal',
    'deleteActiveGoal',
    'saveGoalEditFromUi',
    'openGoalSettings',
    'closeGoalSettings',
    'saveGoalSettings',
    'resetGoalPrompts',
    'toggleOutline',
    'toggleTools',
    'openLmsPanel',
    'toggleTracePanel',
    'runHealthCheck',
    'closeHealthCheckModal',
    'toggleRemoteControl',
    'onSend',
    'toggleInlineFileSide',
    'closeInlineFilePanel',
    'copyInlineFileContent',
    'toggleInlineMarkdownPreview',
    'toggleInlinePythonPreview',
    'reloadInlineFilePanel',
    'openInlineFileInNewTab',
    'closeTracePanel',
    'exportTraces',
    'clearSessionTraces',
    'clearAllTraces',
    'toggleTheme',
    'toggleCoolMode',
    'toggleSecurityMode',
    'closeSettingsPage',
    'closeSettings',
    'toggleApiProfileMenu',
    'onSaveAsNewProfile',
    'onOverwriteActiveProfile',
    'onRenameActiveProfile',
    'onDuplicateActiveProfile',
    'onDeleteActiveProfile',
    'toggleKey',
    'onFetchModels',
    'testConnection',
    'saveAndClose',
    'closeFileEditor',
    'copyFileEditorContent',
    'toggleFileEditorMarkdownPreview',
    'toggleFileEditorCodePreview',
    'reloadFileEditor',
    'saveFileEditor',
    'closePdfViewer',
    'reloadPdfViewer',
    'openPdfViewerInNewTab',
    'closeImageViewer',
    'reloadImageViewer',
    'openImageViewerInNewTab',
    'closeMediaViewer',
    'reloadMediaViewer',
    'openMediaViewerInNewTab',
    'closeRemoteConnection',
    'openRemoteDirPicker',
    'remoteDirGoHome',
    'remoteDirGoParent',
    'refreshRemoteDirPicker',
    'selectRemoteDirCurrent',
    'checkRemoteStatus',
    'saveRemoteConnectionFromUi',
    'disconnectRemoteAgent',
    'connectRemoteAgent',
    'closeFetchModelsModal',
    'toggleSelectAllFetchModels',
    'confirmAddFetchedModels',
    'closeRemoteControlSettings',
    'saveAndCloseRemoteControlSettings',
    'closePlanSettings',
    'resetPlanPrompts',
    'savePlanSettings',
    'closeOutlineSettings',
    'resetOutlinePrompt',
    'resetAllOutlinePrompts',
    'saveOutlineSettings',
    'closeReflectionSettings',
    'saveReflectionSettings',
    'closeMcpSkillSettings',
    'syncMcpTools',
    'openTools',
    'saveMcpServer',
    'clearMcpServerForm',
    'saveSkillRootsFromUi',
    'scanSkills',
    'closeProjectInstructionsSettings',
    'saveProjectInstructionsSettingsFromUi',
    'generateProjectInstructionsDraft',
    'fillDefaultProjectInstructionsDraft',
    'saveProjectInstructionsFromUi',
    'clearLoadedProjectInstructions',
    'closeProjectMemorySettings',
    'saveProjectMemorySettingsFromUi',
    'generateProjectMemoryDraft',
    'saveProjectMemoryFromUi',
    'clearLoadedProjectMemory',
    'closeTaskQueue',
    'taskQueueAddTasks',
    'taskQueueAutoSchedule',
    'startTaskQueue',
    'taskQueueTogglePauseAll',
    'taskQueueStopAll',
    'openTaskQueueTree',
    'taskQueueClearSettled',
    'taskQueueClearAll',
    'closeTaskQueueTree',
    'renderTaskQueueTree',
    'closeTools',
    'addCustomTool',
    'toggleLmsTools',
    'toggleGitTools',
    'togglePaperTools',
    'resetBuiltinTools',
    'clearAllTools',
    'saveToolEdit',
    'closeJsonEditor',
    'refreshJsonPreview',
    'copyJsonPreview',
    'copyJsonBodyOnly',
    'copyAsCurl',
    'refreshJsonResponse',
    'copyJsonResponse',
    'clearJsonResponses',
    'formatJsonTemplate',
    'resetJsonTemplate',
    'saveJsonTemplate',
    'setCodexUserAgentHeader',
    'refreshJsonHistory',
    'clearJsonHistory',
    'closeBackup',
    'exportConfig',
    'copyConfigToClipboard',
    'resetAllData',
    'applyImport',
    'closePermissions',
    'onToggleFullAccess',
    'onClearAllPerms',
    'onClearAllSecrets',
    'shellAuditConfirmAccept',
    'termConfirmReject',
    'termConfirmRejectAll',
    'termConfirmAccept',
    'termConfirmAcceptAll',
    'closeDialogManager',
    'saveDialogManagerSettings',
    'scrollDialogToBottom',
    'savePromptFromUi',
    'clearPromptEditor',
    'closeLmsPanel',
    'lmsPanelCloseCookieEditor',
    'lmsPanelSendMfaCode',
    'lmsPanelLoginWithPassword',
    'lmsPanelVerifyMfaCode',
    'lmsPanelCookieParse',
    'lmsPanelClearCookie',
    'lmsPanelSaveCookie',
    'lmsPanelCloseModal',
    'lmsPanelFetchAll',
    'lmsPanelFetchTodos',
    'lmsPanelFetchCourses',
    'lmsPanelFetchScores',
    'lmsPanelFetchSchedule',
    'lmsPanelFetchEmptyRooms',
    'lmsPanelFetchAttendance',
    'lmsPanelFetchJudgeStatus',
    'lmsPanelSubmitJudgeAll',
    'lmsPanelFetchTrainingPlan',
    'lmsPanelOpenCredentialLogin',
    'lmsPanelAttendancePrevPage',
    'lmsPanelAttendanceNextPage',
    'lmsPanelLoginWithSavedCredential',
    'lmsPanelClearSavedCredential',
    'closeGitPanel',
    '_toggleBranchMenu',
    '_openRemotePanel',
    '_showGitConfigInline',
    '_undoLastReset',
    '_toggleReflogPanel',
    '_onCommitAndPush',
    '_onCommit',
    '_doInit',
    '_unstageAll',
    '_stageAll',
    '_stageUntracked',
    '_saveGitConfig',
    '_clearGitConfig',
    '_doBranchCreate',
    '_doBranchRename',
    '_savePanelUser',
    '_addRemote',
    '_saveGitProxyConfig',
    '_clearGitProxyConfig',
    '_doPull',
    '_doFetch',
    '_showCredHelp',
    'closeMusicPlayer',
    'musicPrevTrack',
    'musicTogglePlay',
    'musicNextTrack',
    'musicToggleTrackList',
    'musicPreviewCompletionSound',
    'musicPreviewGenerationBgm',
    'toggleRatePause',
    'openRateSettings',
    'closeRateSettings',
    'saveRateSettings',
    'resetRateStats',
    'closeDebateMode',
    'startDebateFromUi',
    'stopCurrentDebate',
    'continueCurrentDebate',
    'dialogExplorerGoUp',
    'closeConcurrentRequests',
    'startConcurrentRequestFromUi',
    'stopSelectedConcurrentRequest',
    'stopAllConcurrentRequests',
    'closeTokenUsageStats',
    'renderTokenUsageStats',
    'resetTokenUsageLedger',
    'closePptSettings',
    'resetPptPromptsToDefault',
    'savePptSettings',
    'closePricingManager',
    'savePricingConfigFromUI',
    'addPricingRow',
    'savePricingListFromUI',
    'testPricingMatch',
    'resetPricingToDefault',
    'closeSecurityRecords',
    'renderSecurityRecords',
    'clearSecurityRecords',
    'onClearTaskPerms',
    'closePrivacySettings',
    'clearPrivacyRestoreMappings',
    'resetPrivacyGuardDefaults',
    'savePrivacySettingsFromUi',
    'resetShellAuditPrompt',
    'closeContextLimitSettings',
    'addContextLimitRow',
    'saveContextLimitRulesFromUI',
    'testContextLimitMatch',
    'resetContextLimitRulesToDefault',
    'manualCompress',
    'showTokenDetails',
    'resetTokenStats'
  ]);

  const valueClickActions = new Set([
    'lmsPanelSetTab',
    'useSuggestion',
    'lmsPanelSetAuthMode',
    'lmsPanelFinishAccountChoice',
    'lmsPanelOpenCookieEditor',
    'lmsPanelSetPage',
    'lmsPanelSelectAllScores',
    'lmsPanelShowHomework',
    'lmsPanelShowMaterials',
    'lmsPanelFetchMaterials',
    'lmsPanelDownload',
    '_selectFile',
    '_stageOne',
    '_unstageOne',
    '_checkoutOne',
    '_selectCommit',
    '_restoreReflogHash',
    '_doRevert',
    '_doResetMixed',
    '_doResetHard',
    '_doPush',
    'refreshMusicLibrary',
    'musicPlayIndex',
    'applyRatePreset',
    'selectGoalById',
    'continueGoalById',
    'pauseGoalById',
    'cancelGoalById',
    'deleteGoalById',
    'editPlanStep',
    'retryPlanStep',
    'skipPlanStep',
    'markPlanStepDone',
    'deletePlanStep',
    'approveAndExecutePlan',
    'regeneratePlan',
    'cancelPlan',
    'continuePlanImprovement',
    'acceptPlanWithFailedVerification',
    'togglePlanPanel',
    'debateManualPass',
    'debateManualWin',
    'openDebateChat',
    'continueDebate',
    'requestStopDebate',
    'copyMsg',
    'jumpToDialogMessage',
    'renameTimelineNode',
    'dialogExplorerEnterFolder',
    'dialogExplorerToggleView',
    'switchDialogManagerChat',
    'applyPromptToChat',
    'editPrompt',
    'deletePrompt',
    'finishOutlineNow',
    'resumeOutline',
    'cancelOutline',
    'toggleOutlinePanel',
    'redoOutlineCheckpoint',
    'restoreOutlineCheckpoint',
    'toggleOutlineDiffSummary',
    'openConcurrentChat',
    'chooseConcurrentChat',
    'requestStopConcurrentChat',
    'setTokenUsageQuickRange',
    'editResendUserMsg',
    'undoCompressionSnapshot',
    'showImagePreview',
    'toggleReflectionPanel',
    'regenerate',
    'deleteMessageTurn',
    'removeAttachment',
    'resumePptTaskFromPanel',
    'pausePptTaskFromPanel',
    'cancelPptTaskFromPanel',
    'togglePptPanel',
    'removePricingRow',
    'editTool',
    'deleteTool',
    'copyTraceJson',
    'deleteTrace',
    'toggleTraceExpand',
    'selectJsonResponse',
    'copyHistoryRequest',
    'copyCode',
    'toggleMcpServer',
    'editMcpServer',
    'deleteMcpServer',
    'discoverMcpServer',
    'removeContextLimitRow',
    'refreshAccurateTokenCount'
  ]);

  const valueChangeActions = new Set([
    'lmsPanelSetScoreAccountType',
    'lmsPanelSelectAllScores',
    'lmsPanelToggleScoreSelection',
    'lmsPanelSetScheduleAccountType',
    'lmsPanelSetEmptyRoomCampus',
    'lmsPanelSetEmptyRoomBuilding',
    'lmsPanelSetEmptyRoomDate',
    'lmsPanelSetEmptyRoomStartPeriod',
    'lmsPanelSetEmptyRoomEndPeriod',
    'lmsPanelSetAttendanceAccountType',
    'lmsPanelSetAttendanceAccessMode',
    'lmsPanelSetAttendanceStartDate',
    'lmsPanelSetAttendanceEndDate',
    'lmsPanelSetAttendancePage',
    'lmsPanelSetAttendancePageSize',
    'lmsPanelSetJudgeAccountType',
    'lmsPanelSetJudgeScore',
    'lmsPanelSetJudgeGraduateScore',
    'lmsPanelSetTrainingPlanAccountType',
    'lmsPanelSetTrainingPlanCode',
    'musicSetPlaybackRate',
    'musicSetLoopMode',
    'musicSetShuffle',
    'musicSetMuted',
    'musicSetAutoplayNext',
    'musicSetRememberPosition',
    'musicSetCompletionEnabled',
    'musicSetCompletionMode',
    'musicSetCompletionTrack',
    'musicSetGenerationBgmEnabled',
    'musicSetGenerationBgmTrack',
    'musicSetGenerationBgmLoop',
    'debateProfileChanged',
    'dialogExplorerToggleSort',
    'onTogglePermission',
    'toggleSkill'
  ]);

  const valueInputActions = new Set([
    'lmsPanelSetScoreTerm',
    'lmsPanelSetScheduleTerm',
    'lmsPanelSetJudgeComment',
    'musicSetVolume',
    'musicSetGenerationBgmVolume',
    'musicSetTrackSearch',
    'debateTimeoutSliderChanged',
    'debateTimeoutInputChanged'
  ]);

  const valueInputTargetActions = new Set([
    '_onRemoteTargetBranchInput'
  ]);

  const valueBlurTargetActions = new Set([
    '_normalizeRemoteTargetBranchInput'
  ]);

  const enterKeyActions = new Set([
    'lmsPanelLoginWithPassword',
    'lmsPanelVerifyMfaCode'
  ]);

  const pasteActions = new Set([
    'handlePptGuidancePaste'
  ]);

  const dragOverActions = new Set([
    'handlePptGuidanceDragOver',
    'dialogExplorerBreadcrumbDragOver',
    'dialogExplorerItemDragOver'
  ]);

  const dragLeaveActions = new Set([
    'dialogExplorerBreadcrumbDragLeave',
    'dialogExplorerItemDragLeave'
  ]);

  const dragStartActions = new Set([
    'dialogExplorerDragStart'
  ]);

  const dragEndActions = new Set([
    'dialogExplorerDragEnd'
  ]);

  const dropActions = new Set([
    'handlePptGuidanceDrop',
    'dialogExplorerItemDrop'
  ]);

  const contextMenuActions = new Set([
    'dialogExplorerContextMenu'
  ]);

  const modalFollowupActions = new Set([
    'openContextLimitSettings',
    'openPricingManager'
  ]);

  function dataValue(target, fallback = '') {
    return target.dataset.value !== undefined ? target.dataset.value : fallback;
  }

  function dataBoolean(target, name, fallback = false) {
    if (target.dataset[name] === undefined) return fallback;
    return target.dataset[name] === 'true';
  }

  function typedDatasetValue(target, name = 'value') {
    const raw = target.dataset[name];
    const explicitType = target.dataset[name + 'Type'];
    const type = explicitType || (name === 'value' ? target.dataset.valueType : target.dataset.extraType);
    if (type === 'number') return Number(raw);
    if (type === 'boolean') return raw === 'true';
    return raw;
  }

  const clickActions = {
    toggleModelMenu(event) {
      return callGlobal('toggleModelMenu', [event]);
    },
    toggleReasoningEffortMenu(event) {
      return callGlobal('toggleReasoningEffortMenu', [event]);
    },
    setReasoningEffort(event, target) {
      return callGlobal('setReasoningEffort', [target.dataset.effort || '', event]);
    },
    toggleScheduledSend(event, target) {
      if (target.dataset.value === 'false') return callGlobal('toggleScheduledSend', [false]);
      return callGlobal('toggleScheduledSend');
    },
    setTraceFilter(event, target) {
      return callGlobal('setTraceFilter', [target.dataset.value || 'session']);
    },
    openSettingsSection(event, target) {
      return callGlobal('openSettingsSection', [target.dataset.settingsSection]);
    },
    openCurrentFileInMainPanel(event, target) {
      return callGlobal('openCurrentFileInMainPanel', [target.dataset.kind || 'text']);
    },
    openFilePicker(event, target) {
      const id = target.dataset.target || 'fileInput';
      const input = document.getElementById(id);
      if (input) input.click();
    },
    applyPlanPreset(event, target) {
      return callGlobal('applyPlanPreset', [dataValue(target, 'general')]);
    },
    applyPreset(event, target) {
      return callGlobal('applyPreset', [dataValue(target, 'general')]);
    },
    switchMcpSkillTab(event, target) {
      return callGlobal('switchMcpSkillTab', [dataValue(target, target.dataset.tab || 'mcp')]);
    },
    initProjectInstructions(event, target) {
      return callGlobal('initProjectInstructions', [dataBoolean(target, 'createIfMissing', false)]);
    },
    initProjectMemory(event, target) {
      return callGlobal('initProjectMemory', [dataBoolean(target, 'forceReload', true)]);
    },
    taskQueueOpenChat(event, target) {
      return callGlobal('taskQueueOpenChat', [target.dataset.taskId || '']);
    },
    taskQueueRetryItem(event, target) {
      return callGlobal('taskQueueRetryItem', [target.dataset.taskId || '']);
    },
    taskQueueRemoveItem(event, target) {
      return callGlobal('taskQueueRemoveItem', [target.dataset.taskId || '']);
    },
    taskQueuePauseItem(event, target) {
      return callGlobal('taskQueuePauseItem', [target.dataset.taskId || '']);
    },
    taskQueueStopItem(event, target) {
      return callGlobal('taskQueueStopItem', [target.dataset.taskId || '']);
    },
    taskQueueSkipItem(event, target) {
      return callGlobal('taskQueueSkipItem', [target.dataset.taskId || '']);
    },
    addPresetTool(event, target) {
      return callGlobal('addPresetTool', [dataValue(target)]);
    },
    hideModal(event, target) {
      const el = document.getElementById(target.dataset.target || '');
      if (el) el.classList.remove('show');
    },
    hideModalAndCall(event, target) {
      const el = document.getElementById(target.dataset.target || '');
      if (el) el.classList.remove('show');
      const handler = target.dataset.handler || '';
      if (!modalFollowupActions.has(handler)) return undefined;
      return callGlobal(handler);
    },
    hideSelf(event, target) {
      target.classList.remove('show');
    },
    hideTarget(event, target) {
      const el = document.getElementById(target.dataset.target || '');
      if (el) el.hidden = true;
    },
    removeTarget(event, target) {
      const el = document.getElementById(target.dataset.target || '');
      if (el) el.remove();
    },
    removeClosest(event, target) {
      const selector = target.dataset.selector || '';
      const el = selector && target.closest ? target.closest(selector) : null;
      if (el) el.remove();
    },
    toggleParentCollapsed(event, target) {
      if (target.parentElement) target.parentElement.classList.toggle(target.dataset.toggleClass || 'collapsed');
    },
    switchJsonTab(event, target) {
      return callGlobal('switchJsonTab', [target.dataset.jsontab || dataValue(target, 'preview'), target]);
    },
    shellAuditConfirmReject(event, target) {
      return callGlobal('shellAuditConfirmReject', [dataBoolean(target, 'aborted', false)]);
    },
    setPricingCurrency(event, target) {
      return callGlobal('setPricingCurrency', [target, dataValue(target, 'USD')]);
    },
    setCurrentModelFromPicker(event, target) {
      return callGlobal('setCurrentModelFromPicker', [target.dataset.model || dataValue(target), event]);
    },
    exportDialogManagedChat(event, target) {
      return callGlobal('exportDialogManagedChat', [dataValue(target, 'md')]);
    },
    valueClick(event, target) {
      const handler = target.dataset.handler || '';
      if (!valueClickActions.has(handler)) return undefined;
      const value = typedDatasetValue(target);
      const extraRaw = target.dataset.extraValue;
      if (extraRaw !== undefined) {
        const extra = typedDatasetValue(target, 'extraValue');
        return callGlobal(handler, [value, extra]);
      }
      return callGlobal(handler, [value]);
    }
  };

  const changeActions = {
    saveSettings(event) {
      return callGlobal('saveSettings', [event]);
    },
    onPickFiles(event) {
      return callGlobal('onPickFiles', [event]);
    },
    musicImportFiles(event) {
      return callGlobal('musicImportFiles', [event]);
    },
    musicOpenLocalFiles(event) {
      return callGlobal('musicOpenLocalFiles', [event]);
    },
    onApiProfileSelectChange(event) {
      return callGlobal('onApiProfileSelectChange', [event]);
    },
    onProviderChange(event) {
      return callGlobal('onProviderChange', [event]);
    },
    updateUrlPreview(event) {
      return callGlobal('updateUrlPreview', [event]);
    },
    saveSkillRootsFromUi() {
      return callGlobal('saveSkillRootsFromUi');
    },
    taskQueueSaveDefaults() {
      return callGlobal('taskQueueSaveDefaults');
    },
    saveShellAuditSettingsFromUi() {
      return callGlobal('saveShellAuditSettingsFromUi');
    },
    onShellAuditProfileChange() {
      return callGlobal('onShellAuditProfileChange');
    },
    onFetchModelItemToggle(event, target) {
      return callGlobal('onFetchModelItemToggle', [target]);
    },
    concurrentSelectTargetChanged() {
      return callGlobal('concurrentSelectTargetChanged');
    },
    renderSecurityRecords() {
      return callGlobal('renderSecurityRecords');
    },
    tokenUsageDateChange(event, target) {
      return callGlobal('onTokenUsageDateChange', [target.value]);
    },
    tokenUsageRangeChange(event, target) {
      return callGlobal('onTokenUsageRangeChange', [target.dataset.field || '', target.value]);
    },
    taskQueueUpdateItemOrder(event, target) {
      return callGlobal('taskQueueUpdateItemOrder', [target.dataset.taskId || '', target.value]);
    },
    taskQueueUpdateItemExpose(event, target) {
      return callGlobal('taskQueueUpdateItemExpose', [target.dataset.taskId || '', !!target.checked]);
    },
    taskQueueUpdateItemMode(event, target) {
      return callGlobal('taskQueueUpdateItemMode', [target.dataset.taskId || '', target.value]);
    },
    taskQueueUpdateItemTools(event, target) {
      return callGlobal('taskQueueUpdateItemTools', [target.dataset.taskId || '', !!target.checked]);
    },
    taskQueueUpdateItemDepends(event, target) {
      return callGlobal('taskQueueUpdateItemDepends', [target.dataset.taskId || '', target.value]);
    },
    importFromFile(event) {
      return callGlobal('importFromFile', [event]);
    },
    setDialogExportChat(event, target) {
      return callGlobal('setDialogExportChat', [target.value]);
    },
    updateGitProxyPreview() {
      return callGlobal('_updateGitProxyPreview');
    },
    valueChange(event, target) {
      const handler = target.dataset.handler || '';
      if (!valueChangeActions.has(handler)) return undefined;
      const raw = target.type === 'checkbox' ? !!target.checked : target.value;
      const value = target.dataset.value !== undefined
        ? (target.dataset.valueType === 'number' ? Number(target.dataset.value) : target.dataset.value)
        : raw;
      if (target.dataset.checkedArg === 'true') return callGlobal(handler, [value, !!target.checked]);
      return callGlobal(handler, [value]);
    }
  };

  const inputActions = {
    renderTracePanel(event) {
      return callGlobal('renderTracePanel', [event]);
    },
    updateUrlPreview(event) {
      return callGlobal('updateUrlPreview', [event]);
    },
    setLabelFromValue(event, target) {
      const label = document.getElementById(target.dataset.labelTarget || '');
      if (label) label.textContent = String(target.value) + (target.dataset.suffix || '');
    },
    syncMaxToolRoundsRange(event, target) {
      const label = document.getElementById('maxToolRoundsVal');
      const input = document.getElementById('maxToolRoundsInput');
      if (label) label.textContent = target.value;
      if (input) input.value = target.value;
    },
    syncMaxToolRoundsInput(event, target) {
      const label = document.getElementById('maxToolRoundsVal');
      const range = document.getElementById('maxToolRounds');
      const value = String(target.value);
      if (label) label.textContent = value;
      if (range) range.value = Math.max(1, Math.min(100, parseInt(value, 10) || 1));
    },
    setRetryMaxAttemptsLabel(event, target) {
      return callGlobal('setRetryMaxAttemptsLabel', [target.value]);
    },
    filterFetchModels(event) {
      return callGlobal('filterFetchModels', [event]);
    },
    syncPlanSettingRange(event, target) {
      return callGlobal('syncPlanSettingRange', [
        target.id,
        target.dataset.inputTarget,
        target.dataset.labelTarget
      ]);
    },
    syncPlanSettingInput(event, target) {
      return callGlobal('syncPlanSettingInput', [
        target.id,
        target.dataset.rangeTarget,
        target.dataset.labelTarget,
        parseInt(target.dataset.min, 10),
        parseInt(target.dataset.max, 10),
        parseInt(target.dataset.fallback, 10)
      ]);
    },
    taskQueueUpdateItemText(event, target) {
      return callGlobal('taskQueueUpdateItemText', [target.dataset.taskId || '', target.value]);
    },
    lmsPanelCookieParse() {
      return callGlobal('lmsPanelCookieParse');
    },
    saveShellAuditSettingsFromUi() {
      return callGlobal('saveShellAuditSettingsFromUi');
    },
    updateGitProxyPreview() {
      return callGlobal('_updateGitProxyPreview');
    },
    valueInput(event, target) {
      const handler = target.dataset.handler || '';
      if (!valueInputActions.has(handler)) return undefined;
      const value = target.dataset.value !== undefined ? typedDatasetValue(target) : target.value;
      return callGlobal(handler, [value]);
    },
    valueInputTarget(event, target) {
      const handler = target.dataset.inputHandler || target.dataset.handler || '';
      if (!valueInputTargetActions.has(handler)) return undefined;
      return callGlobal(handler, [target]);
    }
  };

  const blurActions = {
    valueBlurTarget(event, target) {
      const handler = target.dataset.blurHandler || target.dataset.handler || '';
      if (!valueBlurTargetActions.has(handler)) return undefined;
      return callGlobal(handler, [target]);
    }
  };

  const keydownActions = {
    enterGlobal(event, target) {
      if (event.key !== 'Enter') return undefined;
      event.preventDefault();
      const handler = target.dataset.handler || '';
      if (!enterKeyActions.has(handler)) return undefined;
      return callGlobal(handler, [event]);
    },
    goalCardSelect(event, target) {
      if (event.key !== 'Enter' && event.key !== ' ') return undefined;
      event.preventDefault();
      return callGlobal('selectGoalById', [dataValue(target)]);
    }
  };

  function actionTarget(event, attr) {
    const target = event.target && event.target.closest ? event.target.closest('[' + attr + ']') : null;
    if (!target || !document.documentElement.contains(target)) return null;
    return target;
  }

  function isDisabled(target) {
    const control = target.closest('button,input,select,textarea');
    return !!(control && control.disabled);
  }

  function handleClick(event) {
    const target = actionTarget(event, 'data-action');
    if (!target || isDisabled(target)) return;

    if (target.dataset.stopPropagation === 'true') event.stopPropagation();
    const action = target.dataset.action;
    if (!action) return;
    if (directClickActions.has(action)) {
      event.preventDefault();
      callGlobal(action, [event]);
      return;
    }
    const handler = clickActions[action];
    if (!handler) return;
    event.preventDefault();
    handler(event, target);
  }

  function handleChange(event) {
    const target = actionTarget(event, 'data-change-action');
    if (!target || isDisabled(target)) return;

    const handler = changeActions[target.dataset.changeAction];
    if (handler) handler(event, target);
  }

  function handleInput(event) {
    const target = actionTarget(event, 'data-input-action');
    if (!target || isDisabled(target)) return;

    const handler = inputActions[target.dataset.inputAction];
    if (handler) handler(event, target);
  }

  function handleKeydown(event) {
    const target = actionTarget(event, 'data-keydown-action');
    if (!target || isDisabled(target)) return;

    const handler = keydownActions[target.dataset.keydownAction];
    if (handler) handler(event, target);
  }

  function handleBlur(event) {
    const target = actionTarget(event, 'data-blur-action');
    if (!target || isDisabled(target)) return;

    const handler = blurActions[target.dataset.blurAction];
    if (handler) handler(event, target);
  }

  function handleDirectEvent(event, attr, actions) {
    const target = actionTarget(event, attr);
    if (!target || isDisabled(target)) return;

    const action = target.dataset[attr.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase())];
    if (!actions.has(action)) return undefined;
    const args = [event];
    const eventName = attr
      .replace(/^data-/, '')
      .replace(/-action$/, '')
      .replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const specificValueName = eventName + 'Value';
    const specificExtraName = eventName + 'ExtraValue';
    const valueName = target.dataset[specificValueName] !== undefined
      ? specificValueName
      : (target.dataset.eventValue !== undefined ? 'eventValue' : 'value');
    const extraName = target.dataset[specificExtraName] !== undefined
      ? specificExtraName
      : (target.dataset.eventExtraValue !== undefined ? 'eventExtraValue' : 'extraValue');
    if (target.dataset[valueName] !== undefined) args.push(typedDatasetValue(target, valueName));
    if (target.dataset[extraName] !== undefined) args.push(typedDatasetValue(target, extraName));
    const result = callGlobal(action, args);
    if (result === false && event && typeof event.preventDefault === 'function') event.preventDefault();
    return result;
  }

  function handlePaste(event) {
    handleDirectEvent(event, 'data-paste-action', pasteActions);
  }

  function handleDragOver(event) {
    handleDirectEvent(event, 'data-dragover-action', dragOverActions);
  }

  function handleDragLeave(event) {
    handleDirectEvent(event, 'data-dragleave-action', dragLeaveActions);
  }

  function handleDragStart(event) {
    handleDirectEvent(event, 'data-dragstart-action', dragStartActions);
  }

  function handleDragEnd(event) {
    handleDirectEvent(event, 'data-dragend-action', dragEndActions);
  }

  function handleDrop(event) {
    handleDirectEvent(event, 'data-drop-action', dropActions);
  }

  function handleContextMenu(event) {
    handleDirectEvent(event, 'data-contextmenu-action', contextMenuActions);
  }

  function init() {
    if (initialized) return;
    document.addEventListener('click', handleClick);
    document.addEventListener('change', handleChange);
    document.addEventListener('input', handleInput);
    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('focusout', handleBlur);
    document.addEventListener('paste', handlePaste);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('dragstart', handleDragStart);
    document.addEventListener('dragend', handleDragEnd);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('drop', handleDrop);
    initialized = true;
  }

  const domEvents = {
    init,
    handleClick,
    handleChange,
    handleInput,
    handleKeydown,
    handleBlur,
    handlePaste,
    handleContextMenu,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    directClickActions,
    clickActions,
    changeActions,
    inputActions,
    keydownActions,
    blurActions,
    pasteActions,
    contextMenuActions,
    dragStartActions,
    dragEndActions,
    dragOverActions,
    dragLeaveActions,
    dropActions
  };

  AgentApp.define('domEvents', domEvents);
  init();
})(window);
