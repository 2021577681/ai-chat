import unittest
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class FrontendModuleTests(unittest.TestCase):
    def test_app_context_loads_before_config_and_state(self):
        html = (ROOT / 'AI-Chat-大模型对话助手.html').read_text(encoding='utf-8')

        app_idx = html.index('js/app-context.js')
        config_idx = html.index('js/config.js')
        state_idx = html.index('js/state.js')
        ui_service_idx = html.index('js/ui-service.js')
        utils_idx = html.index('js/utils.js')
        markdown_idx = html.index('js/markdown.js')
        project_instructions_idx = html.index('js/project-instructions.js')
        project_memory_idx = html.index('js/project-memory.js')
        mcp_skills_idx = html.index('js/mcp-skills.js')
        rate_limiter_idx = html.index('js/rate-limiter.js')
        tokens_idx = html.index('js/tokens.js')
        token_usage_idx = html.index('js/token-usage.js')
        tools_idx = html.index('js/tools.js')
        pricing_idx = html.index('js/pricing.js')
        security_records_idx = html.index('js/security-records.js')
        api_profiles_idx = html.index('js/api-profiles.js')
        api_adapters_idx = html.index('js/api-adapters.js')
        api_core_idx = html.index('js/api-core.js')
        api_stream_idx = html.index('js/api-stream.js')
        shell_audit_idx = html.index('js/shell-audit.js')
        reflection_idx = html.index('js/reflection.js')
        plan_core_idx = html.index('js/plan-core.js')
        plan_ui_idx = html.index('js/plan-ui.js')
        json_editor_idx = html.index('js/json-editor.js')
        backup_idx = html.index('js/backup.js')
        outline_prompts_idx = html.index('js/outline-prompts.js')
        outline_core_idx = html.index('js/outline-core.js')
        theme_idx = html.index('js/theme.js')
        permissions_idx = html.index('js/permissions.js')
        trace_idx = html.index('js/trace.js')
        beacon_idx = html.index('js/beacon.js')
        music_player_idx = html.index('js/music-player.js')
        terminal_idx = html.index('js/terminal.js')
        file_explorer_idx = html.index('js/file-explorer.js')
        terminal_launcher_idx = html.index('js/terminal-launcher.js')
        remote_connection_idx = html.index('js/remote-connection.js')
        git_panel_idx = html.index('js/git-panel.js')
        settings_page_idx = html.index('js/settings-page.js')
        privacy_guard_idx = html.index('js/privacy-guard.js')
        scheduled_tasks_idx = html.index('js/scheduled-tasks.js')
        remote_control_idx = html.index('js/remote-control.js')
        debate_mode_idx = html.index('js/debate-mode.js')
        dialog_manager_idx = html.index('js/dialog-manager.js')
        lms_idx = html.index('js/lms.js')
        lms_panel_idx = html.index('js/lms_panel.js')
        concurrent_requests_idx = html.index('js/concurrent-requests.js')
        task_queue_idx = html.index('js/task-queue.js')
        ppt_mode_idx = html.index('js/ppt-mode.js')
        outline_render_idx = html.index('js/outline-render.js')
        main_idx = html.index('js/main.js')

        self.assertLess(app_idx, config_idx)
        self.assertLess(ui_service_idx, state_idx)
        self.assertLess(config_idx, state_idx)
        self.assertLess(state_idx, utils_idx)
        self.assertLess(ui_service_idx, markdown_idx)
        self.assertLess(utils_idx, markdown_idx)
        self.assertLess(state_idx, project_instructions_idx)
        self.assertLess(ui_service_idx, project_instructions_idx)
        self.assertLess(state_idx, project_memory_idx)
        self.assertLess(ui_service_idx, project_memory_idx)
        self.assertLess(state_idx, mcp_skills_idx)
        self.assertLess(state_idx, rate_limiter_idx)
        self.assertLess(state_idx, tokens_idx)
        self.assertLess(ui_service_idx, token_usage_idx)
        self.assertLess(ui_service_idx, tokens_idx)
        self.assertLess(tokens_idx, token_usage_idx)
        self.assertLess(state_idx, tools_idx)
        self.assertLess(state_idx, pricing_idx)
        self.assertLess(ui_service_idx, pricing_idx)
        self.assertLess(ui_service_idx, security_records_idx)
        self.assertLess(state_idx, api_profiles_idx)
        self.assertLess(state_idx, api_adapters_idx)
        self.assertLess(state_idx, api_core_idx)
        self.assertLess(state_idx, api_stream_idx)
        self.assertLess(tokens_idx, shell_audit_idx)
        self.assertLess(api_profiles_idx, shell_audit_idx)
        self.assertLess(api_core_idx, shell_audit_idx)
        self.assertLess(rate_limiter_idx, shell_audit_idx)
        self.assertLess(state_idx, reflection_idx)
        self.assertLess(ui_service_idx, reflection_idx)
        self.assertLess(config_idx, reflection_idx)
        self.assertLess(plan_core_idx, plan_ui_idx)
        self.assertLess(api_profiles_idx, backup_idx)
        self.assertLess(config_idx, backup_idx)
        self.assertLess(state_idx, json_editor_idx)
        self.assertLess(api_core_idx, json_editor_idx)
        self.assertLess(utils_idx, json_editor_idx)
        self.assertLess(state_idx, outline_prompts_idx)
        self.assertLess(state_idx, outline_core_idx)
        self.assertLess(outline_prompts_idx, outline_core_idx)
        self.assertLess(state_idx, theme_idx)
        self.assertLess(state_idx, permissions_idx)
        self.assertLess(state_idx, trace_idx)
        self.assertLess(state_idx, beacon_idx)
        self.assertLess(state_idx, music_player_idx)
        self.assertLess(state_idx, terminal_idx)
        self.assertLess(ui_service_idx, terminal_idx)
        self.assertLess(ui_service_idx, file_explorer_idx)
        self.assertLess(ui_service_idx, terminal_launcher_idx)
        self.assertLess(ui_service_idx, remote_connection_idx)
        self.assertLess(terminal_idx, git_panel_idx)
        self.assertLess(ui_service_idx, git_panel_idx)
        self.assertLess(state_idx, settings_page_idx)
        self.assertLess(ui_service_idx, main_idx)
        self.assertLess(state_idx, main_idx)
        self.assertLess(state_idx, privacy_guard_idx)
        self.assertLess(state_idx, scheduled_tasks_idx)
        self.assertLess(state_idx, remote_control_idx)
        self.assertLess(ui_service_idx, remote_control_idx)
        self.assertLess(state_idx, debate_mode_idx)
        self.assertLess(ui_service_idx, debate_mode_idx)
        self.assertLess(state_idx, dialog_manager_idx)
        self.assertLess(ui_service_idx, dialog_manager_idx)
        self.assertLess(lms_idx, lms_panel_idx)
        self.assertLess(ui_service_idx, lms_panel_idx)
        self.assertLess(state_idx, concurrent_requests_idx)
        self.assertLess(state_idx, task_queue_idx)
        self.assertLess(state_idx, ppt_mode_idx)
        self.assertLess(ui_service_idx, ppt_mode_idx)
        self.assertLess(state_idx, outline_render_idx)
        self.assertLess(ui_service_idx, outline_render_idx)

    def test_core_files_register_modules(self):
        config_js = (ROOT / 'js' / 'config.js').read_text(encoding='utf-8')
        state_js = (ROOT / 'js' / 'state.js').read_text(encoding='utf-8')
        utils_js = (ROOT / 'js' / 'utils.js').read_text(encoding='utf-8')
        markdown_js = (ROOT / 'js' / 'markdown.js').read_text(encoding='utf-8')
        mcp_skills_js = (ROOT / 'js' / 'mcp-skills.js').read_text(encoding='utf-8')
        tools_js = (ROOT / 'js' / 'tools.js').read_text(encoding='utf-8')
        pricing_js = (ROOT / 'js' / 'pricing.js').read_text(encoding='utf-8')
        security_records_js = (ROOT / 'js' / 'security-records.js').read_text(encoding='utf-8')
        rate_limiter_js = (ROOT / 'js' / 'rate-limiter.js').read_text(encoding='utf-8')
        tokens_js = (ROOT / 'js' / 'tokens.js').read_text(encoding='utf-8')
        token_usage_js = (ROOT / 'js' / 'token-usage.js').read_text(encoding='utf-8')
        project_instructions_js = (ROOT / 'js' / 'project-instructions.js').read_text(encoding='utf-8')
        project_memory_js = (ROOT / 'js' / 'project-memory.js').read_text(encoding='utf-8')
        shell_audit_js = (ROOT / 'js' / 'shell-audit.js').read_text(encoding='utf-8')
        reflection_js = (ROOT / 'js' / 'reflection.js').read_text(encoding='utf-8')
        plan_core_js = (ROOT / 'js' / 'plan-core.js').read_text(encoding='utf-8')
        plan_ui_js = (ROOT / 'js' / 'plan-ui.js').read_text(encoding='utf-8')
        backup_js = (ROOT / 'js' / 'backup.js').read_text(encoding='utf-8')
        settings_page_js = (ROOT / 'js' / 'settings-page.js').read_text(encoding='utf-8')
        privacy_guard_js = (ROOT / 'js' / 'privacy-guard.js').read_text(encoding='utf-8')
        scheduled_tasks_js = (ROOT / 'js' / 'scheduled-tasks.js').read_text(encoding='utf-8')
        remote_control_js = (ROOT / 'js' / 'remote-control.js').read_text(encoding='utf-8')
        debate_mode_js = (ROOT / 'js' / 'debate-mode.js').read_text(encoding='utf-8')
        dialog_manager_js = (ROOT / 'js' / 'dialog-manager.js').read_text(encoding='utf-8')
        concurrent_requests_js = (ROOT / 'js' / 'concurrent-requests.js').read_text(encoding='utf-8')
        task_queue_js = (ROOT / 'js' / 'task-queue.js').read_text(encoding='utf-8')
        ppt_mode_js = (ROOT / 'js' / 'ppt-mode.js').read_text(encoding='utf-8')
        outline_render_js = (ROOT / 'js' / 'outline-render.js').read_text(encoding='utf-8')
        api_adapters_js = (ROOT / 'js' / 'api-adapters.js').read_text(encoding='utf-8')
        api_profiles_js = (ROOT / 'js' / 'api-profiles.js').read_text(encoding='utf-8')
        api_core_js = (ROOT / 'js' / 'api-core.js').read_text(encoding='utf-8')
        api_stream_js = (ROOT / 'js' / 'api-stream.js').read_text(encoding='utf-8')
        json_editor_js = (ROOT / 'js' / 'json-editor.js').read_text(encoding='utf-8')
        outline_prompts_js = (ROOT / 'js' / 'outline-prompts.js').read_text(encoding='utf-8')
        outline_core_js = (ROOT / 'js' / 'outline-core.js').read_text(encoding='utf-8')
        theme_js = (ROOT / 'js' / 'theme.js').read_text(encoding='utf-8')
        trace_js = (ROOT / 'js' / 'trace.js').read_text(encoding='utf-8')
        beacon_js = (ROOT / 'js' / 'beacon.js').read_text(encoding='utf-8')
        music_player_js = (ROOT / 'js' / 'music-player.js').read_text(encoding='utf-8')
        terminal_js = (ROOT / 'js' / 'terminal.js').read_text(encoding='utf-8')
        stats_toggle_js = (ROOT / 'js' / 'stats-toggle.js').read_text(encoding='utf-8')
        file_explorer_js = (ROOT / 'js' / 'file-explorer.js').read_text(encoding='utf-8')
        terminal_launcher_js = (ROOT / 'js' / 'terminal-launcher.js').read_text(encoding='utf-8')
        remote_connection_js = (ROOT / 'js' / 'remote-connection.js').read_text(encoding='utf-8')
        git_panel_js = (ROOT / 'js' / 'git-panel.js').read_text(encoding='utf-8')
        settings_js = (ROOT / 'js' / 'settings.js').read_text(encoding='utf-8')
        chat_js = (ROOT / 'js' / 'chat.js').read_text(encoding='utf-8')
        permissions_js = (ROOT / 'js' / 'permissions.js').read_text(encoding='utf-8')
        main_js = (ROOT / 'js' / 'main.js').read_text(encoding='utf-8')
        lms_js = (ROOT / 'js' / 'lms.js').read_text(encoding='utf-8')
        lms_panel_js = (ROOT / 'js' / 'lms_panel.js').read_text(encoding='utf-8')
        paper_tools_js = (ROOT / 'js' / 'paper_tools.js').read_text(encoding='utf-8')

        self.assertIn("window.AgentApp.define('config'", config_js)
        self.assertIn("window.AgentApp.define('state'", state_js)
        self.assertIn("window.AgentApp.define('utils'", utils_js)
        self.assertIn("window.AgentApp.define('markdown'", markdown_js)
        self.assertIn("window.AgentApp.define('mcpSkills'", mcp_skills_js)
        self.assertIn("window.AgentApp.define('tools'", tools_js)
        self.assertIn("window.AgentApp.define('pricing'", pricing_js)
        self.assertIn("window.AgentApp.define('securityRecords'", security_records_js)
        self.assertIn("window.AgentApp.define('rateLimiter'", rate_limiter_js)
        self.assertIn("window.AgentApp.define('tokens'", tokens_js)
        self.assertIn('function tokenUsageNumber', tokens_js)
        self.assertIn('usage.usageMetadata || usage.usage || usage', tokens_js)
        self.assertIn('usageSource.promptTokenCount', tokens_js)
        self.assertIn('usageSource.totalTokenCount', tokens_js)
        self.assertIn("window.AgentApp.define('tokenUsage'", token_usage_js)
        self.assertIn("window.AgentApp.define('projectInstructions'", project_instructions_js)
        self.assertIn("window.AgentApp.define('projectMemory'", project_memory_js)
        self.assertIn("window.AgentApp.define('shellAudit'", shell_audit_js)
        self.assertIn("window.AgentApp.define('reflection'", reflection_js)
        self.assertIn("window.AgentApp.define('planCore'", plan_core_js)
        self.assertIn("window.AgentApp.define('planUi'", plan_ui_js)
        self.assertIn("window.AgentApp.define('backup'", backup_js)
        self.assertIn("window.AgentApp.define('settingsPage'", settings_page_js)
        self.assertIn("window.AgentApp.define('privacyGuard'", privacy_guard_js)
        self.assertIn("window.AgentApp.define('scheduledTasks'", scheduled_tasks_js)
        self.assertIn("window.AgentApp.define('remoteControl'", remote_control_js)
        self.assertIn("window.AgentApp.define('debateMode'", debate_mode_js)
        self.assertIn("window.AgentApp.define('dialogManager'", dialog_manager_js)
        self.assertIn("window.AgentApp.define('concurrentRequests'", concurrent_requests_js)
        self.assertIn("window.AgentApp.define('taskQueue'", task_queue_js)
        self.assertIn("window.AgentApp.define('pptMode'", ppt_mode_js)
        self.assertIn("window.AgentApp.define('outlineRender'", outline_render_js)
        self.assertIn("window.AgentApp.define('apiAdapters'", api_adapters_js)
        self.assertIn("window.AgentApp.define('apiProfiles'", api_profiles_js)
        self.assertIn("window.AgentApp.define('apiCore'", api_core_js)
        self.assertIn("window.AgentApp.define('apiStream'", api_stream_js)
        self.assertIn("window.AgentApp.define('jsonEditor'", json_editor_js)
        self.assertIn("window.AgentApp.define('outlinePrompts'", outline_prompts_js)
        self.assertIn("window.AgentApp.define('outlineCore'", outline_core_js)
        self.assertIn("window.AgentApp.define('theme'", theme_js)
        self.assertIn("window.AgentApp.define('trace'", trace_js)
        self.assertIn("window.AgentApp.define('beacon'", beacon_js)
        self.assertIn("window.AgentApp.define('musicPlayer'", music_player_js)
        self.assertIn("window.AgentApp.define('terminal'", terminal_js)
        self.assertIn("window.AgentApp.define('statsToggle'", stats_toggle_js)
        self.assertIn("window.AgentApp.define('fileExplorer'", file_explorer_js)
        self.assertIn("window.AgentApp.define('terminalLauncher'", terminal_launcher_js)
        self.assertIn("window.AgentApp.define('remoteConnection'", remote_connection_js)
        self.assertIn("window.AgentApp.define('gitPanel'", git_panel_js)
        self.assertIn("window.AgentApp.define('settings'", settings_js)
        self.assertIn("window.AgentApp.define('chat'", chat_js)
        self.assertIn("window.AgentApp.define('permissions'", permissions_js)
        self.assertIn("window.AgentApp.define('main'", main_js)
        self.assertIn("window.AgentApp.define('lms'", lms_js)
        self.assertIn("window.AgentApp.define('lmsPanel'", lms_panel_js)
        self.assertIn("window.AgentApp.define('paperTools'", paper_tools_js)

    def test_loaded_scripts_register_modules_except_bootstrap(self):
        html_file = next(ROOT.glob('AI-Chat-*.html'))
        html = html_file.read_text(encoding='utf-8')
        script_paths = re.findall(r'<script src="js/([^"]+\.js)"', html)
        bootstrap_scripts = {'idb-store.js', 'app-context.js'}

        for script in script_paths:
            if script in bootstrap_scripts:
                continue
            js = (ROOT / 'js' / script).read_text(encoding='utf-8')
            self.assertIn('AgentApp.define(', js, f'{script} should register a module API')

    def test_remote_connection_auto_reconnect_persists_last_workspace(self):
        remote_connection_js = (ROOT / 'js' / 'remote-connection.js').read_text(encoding='utf-8')
        main_js = (ROOT / 'js' / 'main.js').read_text(encoding='utf-8')
        utils_js = (ROOT / 'js' / 'utils.js').read_text(encoding='utf-8')
        file_explorer_js = (ROOT / 'js' / 'file-explorer.js').read_text(encoding='utf-8')

        for snippet in (
            'autoReconnect: false',
            'lastConnectedAt: 0',
            "lastServerUrl: ''",
            'let remoteAutoReconnectAttempted = false;',
            'function persistActiveRemoteConnection(info = {})',
            'function clearRemoteAutoReconnectFlag()',
            'function noteRemoteWorkspaceChanged(path)',
            'async function initRemoteConnection()',
            'async function connectRemoteAgent(options = {})',
            'const skipConfirm = !!opts.skipConfirm || autoReconnect;',
            "if (!skipConfirm && !confirm('",
            'if (!autoReconnect) {',
            'saveRemoteConnectionFromUi({ silent: !!opts.silentSave });',
            'persistActiveRemoteConnection({',
            'clearRemoteAutoReconnectFlag();',
            'window.initRemoteConnection = initRemoteConnection;',
            'window.noteRemoteWorkspaceChanged = noteRemoteWorkspaceChanged;',
            'initRemoteConnection,',
            'noteRemoteWorkspaceChanged,',
        ):
            self.assertIn(snippet, remote_connection_js)

        self.assertIn('const remoteInit = initRemoteConnection();', main_js)
        self.assertIn("remoteInit.catch(e => console.warn('[remote] init failed:', e));", main_js)
        self.assertIn('noteRemoteWorkspaceChanged(r.workspace || r.cwd);', utils_js)
        self.assertIn('noteRemoteWorkspaceChanged(r.workspace || r.cwd || normalizedPath);', file_explorer_js)

    def test_remote_terminal_uses_local_controller_and_default_open_warns(self):
        terminal_launcher_js = (ROOT / 'js' / 'terminal-launcher.js').read_text(encoding='utf-8')
        file_explorer_js = (ROOT / 'js' / 'file-explorer.js').read_text(encoding='utf-8')
        routes_py = (ROOT / 'server' / 'routes.py').read_text(encoding='utf-8')

        for snippet in (
            'async function openRemoteWorkspaceTerminal()',
            "typeof isRemoteAgentActive !== 'function' || !isRemoteAgentActive()",
            'REMOTE_CONTROLLER.serverUrl',
            "action: 'open_remote_terminal'",
            'ssh_command: sshCommand',
            'remote_workspace: remoteWorkspace',
            '已打开本机终端并连接到远程目录',
            'window.openRemoteWorkspaceTerminal = openRemoteWorkspaceTerminal',
            'openRemoteWorkspaceTerminal,',
        ):
            self.assertIn(snippet, terminal_launcher_js)

        self.assertIn("ActionRoute('open_remote_terminal', 'handle_open_remote_terminal')", routes_py)
        self.assertIn('if (isFileExplorerRemoteMode()) {', file_explorer_js)
        self.assertIn('远程连接时不能用本机默认应用直接打开远程文件', file_explorer_js)
        self.assertIn('请使用预览或下载', file_explorer_js)

    def test_workspace_home_button_disconnects_remote_and_resets_agent_home(self):
        html_file = next(ROOT.glob('AI-Chat-*.html'))
        html = html_file.read_text(encoding='utf-8')
        utils_js = (ROOT / 'js' / 'utils.js').read_text(encoding='utf-8')
        remote_connection_js = (ROOT / 'js' / 'remote-connection.js').read_text(encoding='utf-8')
        event_delegation_js = (ROOT / 'js' / 'event-delegation.js').read_text(encoding='utf-8')
        routes_py = (ROOT / 'server' / 'routes.py').read_text(encoding='utf-8')
        workspace_py = (ROOT / 'server' / 'workspace.py').read_text(encoding='utf-8')
        proxy_py = (ROOT / 'server' / 'proxy.py').read_text(encoding='utf-8')

        self.assertIn('data-action="returnToAgentWorkspace"', html)
        self.assertIn('async function returnToAgentWorkspace()', utils_js)
        self.assertIn("workspaceBackendAction('reset_workspace_to_agent_home')", utils_js)
        self.assertIn('disconnectRemoteAgent({', utils_js)
        self.assertIn('skipConfirm: true', utils_js)
        self.assertIn('stopRemote: false', utils_js)
        self.assertIn('refreshWorkspace: false', utils_js)
        self.assertIn('window.returnToAgentWorkspace = returnToAgentWorkspace;', utils_js)
        self.assertIn('returnToAgentWorkspace,', utils_js)
        self.assertIn("'returnToAgentWorkspace'", event_delegation_js)
        self.assertIn('async function disconnectRemoteAgent(options = {})', remote_connection_js)
        self.assertIn('if (!opts.skipConfirm && !confirm(', remote_connection_js)
        self.assertIn("ActionRoute('reset_workspace_to_agent_home', 'handle_reset_workspace_to_agent_home')", routes_py)
        self.assertIn('def handle_reset_workspace_to_agent_home(self, body):', workspace_py)
        self.assertIn('config.AGENT_HOME', workspace_py)
        self.assertIn("'agent_home': config.AGENT_HOME", proxy_py)

    def test_state_consumes_config_module_for_storage_keys(self):
        state_js = (ROOT / 'js' / 'state.js').read_text(encoding='utf-8')

        self.assertIn("window.AgentApp.require('config')", state_js)
        self.assertIn("window.AgentApp.require('uiService')", state_js)
        self.assertIn('const STORAGE_KEYS = StateConfig', state_js)
        self.assertIn('STATE_BUILTIN_TOOLS', state_js)
        self.assertIn('StateUiService.toast', state_js)
        for direct_usage in (
            'storage.get(STORE_KEY',
            'storage.set(STORE_KEY',
            'storage.get(SETTINGS_KEY',
            'storage.set(SETTINGS_KEY',
            'storage.get(TOOLS_KEY',
            'storage.set(TOOLS_KEY',
            'storage.get(BUILTIN_TOOLS_LOADED_KEY',
            'storage.set(BUILTIN_TOOLS_LOADED_KEY',
            'storage.remove(BUILTIN_TOOLS_LOADED_KEY',
        ):
            self.assertNotIn(direct_usage, state_js)

    def test_main_consumes_state_module_for_startup_state(self):
        main_js = (ROOT / 'js' / 'main.js').read_text(encoding='utf-8')

        self.assertIn("window.AgentApp.require('state')", main_js)
        self.assertIn('mainLoadData();', main_js)
        self.assertIn('mainSaveData();', main_js)
        self.assertIn('const appState = mainState();', main_js)
        self.assertNotIn('\n  loadData();', main_js)
        self.assertNotIn('state.settings', main_js)

    def test_settings_and_chat_consume_modules(self):
        settings_js = (ROOT / 'js' / 'settings.js').read_text(encoding='utf-8')
        chat_js = (ROOT / 'js' / 'chat.js').read_text(encoding='utf-8')

        self.assertIn("window.AgentApp.require('config')", settings_js)
        self.assertIn("window.AgentApp.require('state')", settings_js)
        self.assertIn('settingsState.settings', settings_js)
        self.assertIn('SETTINGS_PROVIDERS', settings_js)
        self.assertNotIn('state.settings', settings_js)
        self.assertNotIn('if (PROVIDERS[p])', settings_js)
        for inline_attr in (
            'onclick=',
            'onchange=',
            'oninput=',
            'onblur=',
            'onkeydown=',
            'onkeyup=',
            'onmouseover=',
            'onmouseout=',
        ):
            self.assertNotIn(inline_attr, settings_js)
        for delegated_attr in (
            'data-action="closeContextLimitSettings"',
            'data-action="addContextLimitRow"',
            'data-action="saveContextLimitRulesFromUI"',
            'data-action="testContextLimitMatch"',
            'data-action="resetContextLimitRulesToDefault"',
            'data-handler="removeContextLimitRow"',
            'data-action="setCurrentModelFromPicker"',
            'data-change-action="onFetchModelItemToggle"',
            'class="fetch-model-option"',
        ):
            self.assertIn(delegated_attr, settings_js)
        self.assertIn('.fetch-model-option:hover', (ROOT / 'css' / 'base.css').read_text(encoding='utf-8'))

        self.assertIn("window.AgentApp.require('state')", chat_js)
        self.assertIn('chatState.', chat_js)
        self.assertIn('chatSaveData();', chat_js)
        self.assertIn('function sealInterruptedToolFlows', chat_js)
        self.assertIn('gm._toolFlowInterrupted', chat_js)
        self.assertIn('sealInterruptedToolFlows', chat_js[chat_js.index("window.AgentApp.define('chat'"):])
        self.assertNotIn('state.', chat_js)
        self.assertNotIn('saveData();', chat_js)

    def test_tools_consumes_config_and_state_modules(self):
        tools_js = (ROOT / 'js' / 'tools.js').read_text(encoding='utf-8')

        self.assertIn("window.AgentApp.require('config')", tools_js)
        self.assertIn("window.AgentApp.require('state')", tools_js)
        self.assertIn('toolsState.tools', tools_js)
        self.assertIn('builtinToolDefs', tools_js)
        self.assertIn('presetToolDefs', tools_js)
        self.assertIn('toolsPersistTools();', tools_js)
        self.assertNotIn('state.tools', tools_js)
        self.assertNotIn('state.settings', tools_js)
        self.assertNotIn('persistTools();', tools_js)
        for inline_attr in (
            'onclick=',
            'onchange=',
            'oninput=',
            'onblur=',
            'onkeydown=',
            'onkeyup=',
        ):
            self.assertNotIn(inline_attr, tools_js)
        for delegated_attr in (
            'data-action="resetBuiltinTools"',
            'data-action="toggleParentCollapsed"',
            'data-handler="editTool"',
            'data-handler="deleteTool"',
            'data-stop-propagation="true"',
        ):
            self.assertIn(delegated_attr, tools_js)

    def test_api_modules_consume_state_module(self):
        api_adapters_js = (ROOT / 'js' / 'api-adapters.js').read_text(encoding='utf-8')
        api_profiles_js = (ROOT / 'js' / 'api-profiles.js').read_text(encoding='utf-8')

        self.assertIn("window.AgentApp.require('state')", api_adapters_js)
        self.assertIn('apiAdapterState.settings.systemPrompt', api_adapters_js)
        self.assertNotIn('state.settings.systemPrompt', api_adapters_js)

        self.assertIn("window.AgentApp.require('state')", api_profiles_js)
        self.assertIn("window.AgentApp.require('uiService')", api_profiles_js)
        self.assertIn('apiProfilesState.settings', api_profiles_js)
        self.assertIn('apiProfilesPersistSettings', api_profiles_js)
        self.assertIn('ApiProfilesUiService.toast', api_profiles_js)
        self.assertIn('ApiProfilesUiService.updateSendBtn', api_profiles_js)
        self.assertNotIn('state.settings', api_profiles_js)
        self.assertNotIn('persistSettings();', api_profiles_js)
        self.assertNotIn('typeof toast', api_profiles_js)
        self.assertNotIn('typeof updateSendBtn', api_profiles_js)

    def test_api_stream_consumes_state_module(self):
        api_stream_js = (ROOT / 'js' / 'api-stream.js').read_text(encoding='utf-8')
        api_stream_code = '\n'.join(
            line for line in api_stream_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", api_stream_js)
        self.assertIn('apiStreamState.settings', api_stream_js)
        self.assertIn('apiStreamCurrentChat()', api_stream_js)
        self.assertIn('apiStreamSyncGlobalTaskState(', api_stream_js)
        for direct_usage in (
            'state.',
            'currentChat()',
            'chatTaskById(',
            'requestStopChatTask(',
            'syncGlobalTaskState(',
            'isCurrentChatGenerating(',
            'isCurrentChat(',
        ):
            self.assertNotIn(direct_usage, api_stream_code)

    def test_stop_generate_seals_interrupted_tool_flows(self):
        api_stream_js = (ROOT / 'js' / 'api-stream.js').read_text(encoding='utf-8')

        self.assertIn('const apiStreamSaveData = ApiStreamStateModule.saveData;', api_stream_js)
        self.assertIn("typeof sealInterruptedToolFlows === 'function'", api_stream_js)
        self.assertIn('const changed = sealInterruptedToolFlows(c);', api_stream_js)
        self.assertIn("console.warn('[stopGenerate] 收尾工具流程失败:'", api_stream_js)
        seal_idx = api_stream_js.index("typeof sealInterruptedToolFlows === 'function'")
        self.assertLess(
            seal_idx,
            api_stream_js.index('apiStreamSyncGlobalTaskState(chatId)', seal_idx)
        )

    def test_api_core_consumes_state_module(self):
        api_core_js = (ROOT / 'js' / 'api-core.js').read_text(encoding='utf-8')
        api_core_code = '\n'.join(
            line for line in api_core_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", api_core_js)
        self.assertIn("window.AgentApp.require('uiService')", api_core_js)
        self.assertIn("window.AgentApp.require('orchestrationService')", api_core_js)
        self.assertIn('apiCoreState.settings', api_core_js)
        self.assertIn('apiCoreSaveData()', api_core_js)
        self.assertIn('apiCoreCurrentChat()', api_core_js)
        self.assertIn('apiCoreChatById(', api_core_js)
        self.assertIn('ApiCoreUiService.toast', api_core_js)
        self.assertIn('ApiCoreOrchestrationService.executeTool', api_core_js)
        self.assertIn('function normalizeUsageForAccounting', api_core_js)
        self.assertIn('function accumulateUsageForAccounting', api_core_js)
        self.assertIn('src.totalTokenCount', api_core_js)
        self.assertIn('totalUsage = accumulateUsageForAccounting(totalUsage, usageForAccounting)', api_core_js)
        self.assertIn('recordUsageFromResponse(_c, usageForAccounting, { model })', api_core_js)
        for direct_usage in (
            'state.',
            'saveData()',
            'currentChat()',
            'chatById(',
            'syncGlobalTaskState(',
            'isChatGenerating(',
            'isCurrentChatGenerating(',
            'beginChatTask(',
            'updateChatTaskController(',
            'clearChatTask(',
            'activeTaskChat(',
            'typeof toast',
            'typeof renderMessages',
            'typeof renderChatList',
            'typeof updateSendBtn',
            'typeof refreshMsgNode',
            'await executeTool(',
            'await callAPI(',
        ):
            self.assertNotIn(direct_usage, api_core_code)

    def test_api_core_discards_tool_result_after_stop(self):
        api_core_js = (ROOT / 'js' / 'api-core.js').read_text(encoding='utf-8')

        self.assertIn('const isMainToolStopRequested = () => {', api_core_js)
        main_exec = 'const result = await ApiCoreOrchestrationService.executeTool(fname, args, {'
        main_after_stop = 'if (isMainToolStopRequested()) {\n          userStoppedAll = true;\n          pruneToolCallsToExecuted(msg, executedToolCallIds);'
        main_prepare = 'const preparedToolResult = typeof prepareToolResultForContext'
        self.assertLess(api_core_js.index(main_exec), api_core_js.index(main_after_stop))
        self.assertLess(api_core_js.index(main_after_stop), api_core_js.index(main_prepare))
        self.assertIn("lastMsg.content = '*[已停止]*';", api_core_js)

        loop_exec = 'const result = await ApiCoreOrchestrationService.executeTool(tc.name, args, runToolContext);'
        loop_after_stop = "if (_isAborted()) {\n        if (assistantMsg.tool_calls) {"
        loop_emit = "_emit({ type: 'tool_result'"
        self.assertLess(api_core_js.index(loop_exec), api_core_js.index(loop_after_stop, api_core_js.index(loop_exec)))
        self.assertLess(api_core_js.index(loop_after_stop, api_core_js.index(loop_exec)), api_core_js.index(loop_emit, api_core_js.index(loop_exec)))

    def test_app_context_exposes_module_registry_api(self):
        app_js = (ROOT / 'js' / 'app-context.js').read_text(encoding='utf-8')

        self.assertIn('define(name, api)', app_js)
        self.assertIn('require: requireModule', app_js)
        self.assertIn('optional', app_js)

    def test_config_secret_clearer_uses_injected_state_data(self):
        config_js = (ROOT / 'js' / 'config.js').read_text(encoding='utf-8')
        config_code = '\n'.join(
            line for line in config_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn('function clearAllSecrets(options = {})', config_js)
        self.assertIn('const settings = options.settings || null;', config_js)
        self.assertNotIn('typeof state', config_code)
        self.assertNotIn('state.settings', config_code)
        self.assertNotIn('typeof persistSettings', config_code)
        self.assertNotIn('\npersistSettings();', config_code)

    def test_permissions_consumes_config_and_state_modules(self):
        permissions_js = (ROOT / 'js' / 'permissions.js').read_text(encoding='utf-8')
        permissions_code = '\n'.join(
            line for line in permissions_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('config')", permissions_js)
        self.assertIn("window.AgentApp.require('state')", permissions_js)
        self.assertIn('permissionsClearAllSecrets({', permissions_js)
        self.assertIn('settings: permissionsState.settings', permissions_js)
        self.assertNotIn('typeof SECRET_REGISTRY', permissions_code)
        self.assertNotIn('SECRET_REGISTRY.map', permissions_code)
        self.assertNotIn('clearAllSecrets();', permissions_code)
        self.assertNotIn('state.currentId', permissions_code)
        for inline_attr in (
            'onclick=',
            'onchange=',
            'oninput=',
            'onblur=',
            'onkeydown=',
            'onkeyup=',
        ):
            self.assertNotIn(inline_attr, permissions_js)
        for delegated_attr in (
            'data-change-action="valueChange"',
            'data-handler="onTogglePermission"',
            'data-checked-arg="true"',
            'data-action="onToggleFullAccess"',
            'data-action="onClearTaskPerms"',
        ):
            self.assertIn(delegated_attr, permissions_js)

    def test_full_access_permission_mode_keeps_shell_audit_and_marks_backend_requests(self):
        terminal_js = (ROOT / 'js' / 'terminal.js').read_text(encoding='utf-8')
        main_js = (ROOT / 'js' / 'main.js').read_text(encoding='utf-8')
        permissions_js = (ROOT / 'js' / 'permissions.js').read_text(encoding='utf-8')
        shell_audit_js = (ROOT / 'js' / 'shell-audit.js').read_text(encoding='utf-8')
        event_delegation_js = (ROOT / 'js' / 'event-delegation.js').read_text(encoding='utf-8')
        html = (ROOT / 'AI-Chat-大模型对话助手.html').read_text(encoding='utf-8')
        config_py = (ROOT / 'server' / 'config.py').read_text(encoding='utf-8')
        handler_py = (ROOT / 'server' / 'handler.py').read_text(encoding='utf-8')
        sandbox_py = (ROOT / 'server' / 'sandbox.py').read_text(encoding='utf-8')

        for snippet in (
            "const TERMINAL_FULL_ACCESS_KEY = 'aichat_terminal_full_access_v1'",
            "const TERMINAL_FULL_ACCESS_PERMS_BACKUP_KEY = 'aichat_terminal_full_access_perms_backup_v1'",
            'fullAccess: loadFullAccessMode()',
            'function clonePermanentPerms(perms)',
            'function saveFullAccessPermissionSnapshot(perms)',
            'function loadFullAccessPermissionSnapshot()',
            'function restoreFullAccessPermissions()',
            'function setFullAccessMode(enabled)',
            'function isFullAccessModeEnabled()',
            'function grantFullAccessPermissions()',
            'saveFullAccessPermissionSnapshot(TERMINAL_CONFIG.permanentAllow)',
            'TERMINAL_CONFIG.permanentAllow = snapshot',
            'const fullAccessAllowed = isFullAccessModeEnabled();',
            'const alreadyAllowed = fullAccessAllowed || permanentlyAllowed || taskAllowed;',
            'allow_full_access: fullAccessAllowed',
        ):
            self.assertIn(snippet, terminal_js)
        self.assertIn("storage.get('aichat_terminal_full_access_v1')", main_js)
        self.assertIn('TERMINAL_CONFIG.fullAccess = loadFullAccessMode();', main_js)
        self.assertIn("action === 'execute' && !skipShellAudit && typeof reviewShellCommandWithAI === 'function'", terminal_js)

        for snippet in (
            'function renderFullAccessControl()',
            'id="fullAccessPermissionPanel"',
            'perm-full-access-toggle',
            'data-action="onToggleFullAccess"',
            'aria-pressed="${fullAccess ? \'true\' : \'false\'}"',
            'function onToggleFullAccess()',
            'grantFullAccessPermissions()',
            'restoreFullAccessPermissions()',
            'const granted = fullAccess || !!perms[key];',
            '关闭完全访问后会恢复开启前的单项永久授权',
            '隐私模式和 Shell 审核仍会继续生效',
            '已恢复开启前的单项永久授权',
        ):
            self.assertIn(snippet, permissions_js if snippet != 'id="fullAccessPermissionPanel"' else html)

        self.assertIn("'onToggleFullAccess'", event_delegation_js)
        self.assertIn('function shellAuditFullAccessEnabled(context)', shell_audit_js)
        self.assertIn('shellAuditFullAccessEnabled(context)', shell_audit_js)
        self.assertIn('callShellAuditModel({', shell_audit_js)
        self.assertIn("_request_full_access = contextvars.ContextVar('request_full_access', default=False)", config_py)
        self.assertIn('def bind_request_full_access(enabled: bool = False):', config_py)
        self.assertIn("body.get('allow_full_access') or body.get('full_access')", handler_py)
        self.assertIn('config.reset_request_full_access(full_access_token)', handler_py)
        self.assertIn("if config.is_full_access_enabled():\n        return False, ''", sandbox_py)
        self.assertIn('if config.is_full_access_enabled():\n        return True', sandbox_py)

    def test_theme_consumes_state_module(self):
        theme_js = (ROOT / 'js' / 'theme.js').read_text(encoding='utf-8')

        self.assertIn("window.AgentApp.require('state')", theme_js)
        self.assertIn('themeState.settings', theme_js)
        self.assertIn('themePersistSettings()', theme_js)
        self.assertNotIn('state.settings', theme_js)
        self.assertNotIn('persistSettings()', theme_js)

    def test_utils_consumes_state_module_for_completion_sound(self):
        utils_js = (ROOT / 'js' / 'utils.js').read_text(encoding='utf-8')

        self.assertIn("window.AgentApp.require('state')", utils_js)
        self.assertIn('utilsState.settings', utils_js)
        self.assertNotIn('state.settings', utils_js)

    def test_markdown_code_blocks_use_event_delegation(self):
        markdown_js = (ROOT / 'js' / 'markdown.js').read_text(encoding='utf-8')

        self.assertNotIn('onclick=', markdown_js)
        self.assertIn('data-action="valueClick"', markdown_js)
        self.assertIn('data-handler="copyCode"', markdown_js)
        self.assertIn('data-value="${codeId}"', markdown_js)

    def test_beacon_consumes_state_module(self):
        beacon_js = (ROOT / 'js' / 'beacon.js').read_text(encoding='utf-8')
        beacon_code = '\n'.join(
            line for line in beacon_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", beacon_js)
        self.assertIn('beaconState.settings', beacon_js)
        self.assertIn('beaconCurrentChat()', beacon_js)
        self.assertIn('beaconIsCurrentChatGenerating()', beacon_js)
        self.assertNotIn('state.', beacon_code)
        self.assertNotIn('currentChat()', beacon_code)
        self.assertNotIn('onclick=', beacon_js)
        self.assertIn('data-action="runHealthCheck"', beacon_js)
        self.assertIn('data-action="closeHealthCheckModal"', beacon_js)

    def test_mcp_skills_consumes_state_module(self):
        mcp_skills_js = (ROOT / 'js' / 'mcp-skills.js').read_text(encoding='utf-8')

        self.assertIn("window.AgentApp.require('state')", mcp_skills_js)
        self.assertIn('mcpSkillsState.settings', mcp_skills_js)
        self.assertIn('mcpSkillsState.tools', mcp_skills_js)
        self.assertIn('mcpSkillsPersistSettings()', mcp_skills_js)
        self.assertIn('mcpSkillsPersistTools()', mcp_skills_js)
        self.assertNotIn('state.settings', mcp_skills_js)
        self.assertNotIn('state.tools', mcp_skills_js)
        self.assertNotIn('persistSettings()', mcp_skills_js)
        self.assertNotIn('persistTools()', mcp_skills_js)
        for inline_attr in (
            'onclick=',
            'onchange=',
            'oninput=',
            'onblur=',
            'onkeydown=',
            'onkeyup=',
        ):
            self.assertNotIn(inline_attr, mcp_skills_js)
        for delegated_attr in (
            'data-action="toggleParentCollapsed"',
            'data-handler="toggleMcpServer"',
            'data-handler="editMcpServer"',
            'data-handler="deleteMcpServer"',
            'data-handler="discoverMcpServer"',
            'data-handler="toggleSkill"',
            'data-checked-arg="true"',
            'data-stop-propagation="true"',
        ):
            self.assertIn(delegated_attr, mcp_skills_js)

    def test_trace_consumes_state_module(self):
        trace_js = (ROOT / 'js' / 'trace.js').read_text(encoding='utf-8')
        trace_code = '\n'.join(
            line for line in trace_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", trace_js)
        self.assertIn('traceState.traces', trace_js)
        self.assertIn('traceState.currentId', trace_js)
        self.assertIn('traceState.settings', trace_js)
        self.assertNotIn('window.state', trace_code)
        self.assertNotIn('state.', trace_code)
        self.assertNotIn('typeof state', trace_code)
        self.assertNotIn('onclick=', trace_js)
        for delegated_attr in (
            'data-handler="copyTraceJson"',
            'data-handler="deleteTrace"',
            'data-handler="toggleTraceExpand"',
            'data-stop-propagation="true"',
        ):
            self.assertIn(delegated_attr, trace_js)

    def test_json_editor_consumes_modules(self):
        json_editor_js = (ROOT / 'js' / 'json-editor.js').read_text(encoding='utf-8')
        json_editor_code = '\n'.join(
            line for line in json_editor_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", json_editor_js)
        self.assertIn("window.AgentApp.require('apiCore')", json_editor_js)
        self.assertIn("window.AgentApp.require('utils')", json_editor_js)
        self.assertIn('jsonEditorState.settings', json_editor_js)
        self.assertIn('jsonEditorCurrentChat()', json_editor_js)
        self.assertIn('jsonEditorBuildRequestBody(', json_editor_js)
        self.assertIn('jsonEditorBuildHeaders()', json_editor_js)
        self.assertIn('jsonEditorBuildFullUrl(', json_editor_js)
        for direct_usage in (
            'state.',
            'currentChat()',
            'persistSettings()',
            'buildRequestBody(',
            'buildHeaders()',
            'buildFullUrl(',
        ):
            self.assertNotIn(direct_usage, json_editor_code)
        for inline_attr in (
            'onclick=',
            'onchange=',
            'oninput=',
            'onblur=',
            'onkeydown=',
            'onkeyup=',
        ):
            self.assertNotIn(inline_attr, json_editor_js)
        for delegated_attr in (
            'data-handler="selectJsonResponse"',
            'data-action="toggleParentCollapsed"',
            'data-toggle-class="expanded"',
            'data-handler="copyHistoryRequest"',
            'data-value-type="number"',
        ):
            self.assertIn(delegated_attr, json_editor_js)

    def test_music_player_consumes_state_module(self):
        music_player_js = (ROOT / 'js' / 'music-player.js').read_text(encoding='utf-8')

        self.assertIn("window.AgentApp.require('state')", music_player_js)
        self.assertIn('musicAppState.settings', music_player_js)
        self.assertIn('musicPersistSettings()', music_player_js)
        self.assertIn('musicIsAnyChatGenerating()', music_player_js)
        self.assertNotIn('state.settings', music_player_js)
        self.assertNotIn('state.isGenerating', music_player_js)
        self.assertNotIn('persistSettings()', music_player_js)
        self.assertNotIn('isAnyChatGenerating()', music_player_js.replace('musicIsAnyChatGenerating()', ''))

    def test_outline_prompts_consumes_state_module(self):
        outline_prompts_js = (ROOT / 'js' / 'outline-prompts.js').read_text(encoding='utf-8')
        outline_prompts_code = '\n'.join(
            line for line in outline_prompts_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", outline_prompts_js)
        self.assertIn('outlinePromptsState.settings', outline_prompts_js)
        self.assertNotIn('state.', outline_prompts_code)
        self.assertNotIn('typeof state', outline_prompts_code)

    def test_pricing_consumes_state_module(self):
        pricing_js = (ROOT / 'js' / 'pricing.js').read_text(encoding='utf-8')
        pricing_code = '\n'.join(
            line for line in pricing_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", pricing_js)
        self.assertIn("window.AgentApp.require('uiService')", pricing_js)
        self.assertIn('pricingState.settings.currentModel', pricing_js)
        self.assertIn('PricingUiService.toast', pricing_js)
        self.assertNotIn('state.', pricing_code)
        self.assertNotIn('typeof state', pricing_code)
        self.assertNotIn('typeof toast', pricing_code)

    def test_pricing_uses_event_delegation(self):
        pricing_js = (ROOT / 'js' / 'pricing.js').read_text(encoding='utf-8')

        for inline_attr in (
            'onclick=',
            'onchange=',
            'oninput=',
            'onblur=',
            'onkeydown=',
            'onkeyup=',
        ):
            self.assertNotIn(inline_attr, pricing_js)

        for delegated_attr in (
            'data-action="closePricingManager"',
            'data-action="savePricingConfigFromUI"',
            'data-action="addPricingRow"',
            'data-action="savePricingListFromUI"',
            'data-action="testPricingMatch"',
            'data-action="resetPricingToDefault"',
            'data-action="valueClick"',
            'data-handler="removePricingRow"',
            'data-value-type="number"',
            'data-action="setPricingCurrency"',
            'data-value="USD"',
            'data-value="CNY"',
        ):
            self.assertIn(delegated_attr, pricing_js)

    def test_security_records_uses_event_delegation_and_ui_service(self):
        security_records_js = (ROOT / 'js' / 'security-records.js').read_text(encoding='utf-8')

        self.assertIn("window.AgentApp.require('uiService')", security_records_js)
        self.assertIn('SecurityRecordsUiService.toast', security_records_js)
        self.assertNotIn('typeof toast', security_records_js)
        for inline_attr in (
            'onclick=',
            'onchange=',
            'oninput=',
            'onblur=',
            'onkeydown=',
            'onkeyup=',
        ):
            self.assertNotIn(inline_attr, security_records_js)

        for delegated_attr in (
            'data-action="closeSecurityRecords"',
            'data-change-action="renderSecurityRecords"',
            'data-action="renderSecurityRecords"',
            'data-action="clearSecurityRecords"',
        ):
            self.assertIn(delegated_attr, security_records_js)

    def test_rate_limiter_consumes_state_module(self):
        rate_limiter_js = (ROOT / 'js' / 'rate-limiter.js').read_text(encoding='utf-8')
        rate_limiter_code = '\n'.join(
            line for line in rate_limiter_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", rate_limiter_js)
        self.assertIn('rateLimiterState.settings', rate_limiter_js)
        self.assertIn('rateLimiterPersistSettings()', rate_limiter_js)
        self.assertNotIn('state.', rate_limiter_code)
        self.assertNotIn('persistSettings()', rate_limiter_code)

    def test_tokens_consumes_state_and_runtime_api_core_modules(self):
        tokens_js = (ROOT / 'js' / 'tokens.js').read_text(encoding='utf-8')
        tokens_code = '\n'.join(
            line for line in tokens_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", tokens_js)
        self.assertIn("window.AgentApp.require('uiService')", tokens_js)
        self.assertIn("return window.AgentApp.require('apiCore')", tokens_js)
        self.assertIn('tokensState.settings', tokens_js)
        self.assertIn('tokensSaveData()', tokens_js)
        self.assertIn('TokensUiService.toast', tokens_js)
        self.assertIn('TokensUiService.renderMessages', tokens_js)
        self.assertIn("window.AgentApp.define('tokens'", tokens_js)
        for direct_usage in (
            'state.',
            'saveData()',
            'currentChat()',
            'chatById(',
            'isCurrentChat(',
            'isChatGenerating(',
            'syncGlobalTaskState(',
            'beginChatTask(',
            'clearChatTask(',
            'await callOnceWithRole(',
            'headers: buildHeaders()',
        ):
            self.assertNotIn(direct_usage, tokens_code)
        for inline_attr in (
            'onclick=',
            'onchange=',
            'oninput=',
            'onblur=',
            'onkeydown=',
            'onkeyup=',
        ):
            self.assertNotIn(inline_attr, tokens_js)
        for delegated_attr in (
            'data-action="manualCompress"',
            'data-action="showTokenDetails"',
            'data-handler="refreshAccurateTokenCount"',
            'data-action="hideModalAndCall"',
            'data-handler="openContextLimitSettings"',
            'data-handler="openPricingManager"',
            'data-action="hideModal"',
            'data-action="resetTokenStats"',
        ):
            self.assertIn(delegated_attr, tokens_js)

    def test_project_context_modules_consume_state_and_runtime_api_core(self):
        project_instructions_js = (ROOT / 'js' / 'project-instructions.js').read_text(encoding='utf-8')
        project_memory_js = (ROOT / 'js' / 'project-memory.js').read_text(encoding='utf-8')
        combined = project_instructions_js + '\n' + project_memory_js
        combined_code = '\n'.join(
            line for line in combined.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", project_instructions_js)
        self.assertIn("return window.AgentApp.require('apiCore')", project_instructions_js)
        self.assertIn('projectInstructionsState.settings', project_instructions_js)
        self.assertIn('projectInstructionsPersistSettings()', project_instructions_js)
        self.assertIn("window.AgentApp.define('projectInstructions'", project_instructions_js)

        self.assertIn("window.AgentApp.require('state')", project_memory_js)
        self.assertIn("return window.AgentApp.require('apiCore')", project_memory_js)
        self.assertIn('projectMemoryState.settings', project_memory_js)
        self.assertIn('projectMemoryPersistSettings()', project_memory_js)
        self.assertIn("window.AgentApp.define('projectMemory'", project_memory_js)

        self.assertNotIn('state.', combined_code)
        self.assertNotIn('persistSettings()', combined_code)
        self.assertNotIn('await callOnceWithRole(', combined_code)

    def test_shell_audit_consumes_modules(self):
        shell_audit_js = (ROOT / 'js' / 'shell-audit.js').read_text(encoding='utf-8')
        shell_audit_code = '\n'.join(
            line for line in shell_audit_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        for module_name in ('state', 'apiProfiles', 'apiCore', 'utils', 'rateLimiter', 'tokens'):
            self.assertIn(f"window.AgentApp.require('{module_name}')", shell_audit_js)
        self.assertIn('shellAuditState.settings', shell_audit_js)
        self.assertIn('shellAuditLoadApiProfiles()', shell_audit_js)
        self.assertIn('shellAuditRecordUsage(chat, usage, meta)', shell_audit_js)
        self.assertIn("window.AgentApp.define('shellAudit'", shell_audit_js)
        for direct_usage in (
            'state.',
            'typeof state',
            'persistSettings()',
            'loadApiProfiles()',
            'buildFullUrl(',
            'recordRequest()',
            'recordUsageFromResponse(',
            'chatById(',
            'currentChat()',
        ):
            self.assertNotIn(direct_usage, shell_audit_code)
        for inline_attr in (
            'onclick=',
            'onchange=',
            'oninput=',
            'onblur=',
            'onkeydown=',
            'onkeyup=',
        ):
            self.assertNotIn(inline_attr, shell_audit_js)
        for delegated_attr in (
            'data-change-action="saveShellAuditSettingsFromUi"',
            'data-change-action="onShellAuditProfileChange"',
            'data-input-action="saveShellAuditSettingsFromUi"',
            'data-action="resetShellAuditPrompt"',
        ):
            self.assertIn(delegated_attr, shell_audit_js)

    def test_plan_core_consumes_state_module(self):
        plan_core_js = (ROOT / 'js' / 'plan-core.js').read_text(encoding='utf-8')
        plan_core_code = '\n'.join(
            line for line in plan_core_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", plan_core_js)
        self.assertIn('planCoreState.settings', plan_core_js)
        self.assertIn('planCoreSaveData()', plan_core_js)
        self.assertIn('planCoreCurrentChat()', plan_core_js)
        self.assertIn('planCoreChatById(', plan_core_js)
        self.assertIn('planCoreBeginChatTask(', plan_core_js)
        self.assertIn('planCoreClearChatTask(', plan_core_js)
        self.assertIn("window.AgentApp.define('planCore'", plan_core_js)
        for direct_usage in (
            'state.',
            'saveData()',
            'persistSettings()',
            'currentChat()',
            'chatById(',
            'isCurrentChat(',
            'isChatGenerating(',
            'beginChatTask(',
            'setChatTaskMode(',
            'updateChatTaskController(',
            'clearChatTask(',
            'requestStopChatTask(',
            'activeTaskChat(',
            'typeof chatById',
            'typeof currentChat',
            'typeof activeTaskChat',
        ):
            self.assertNotIn(direct_usage, plan_core_code)

    def test_plan_ui_consumes_config_and_state_modules(self):
        plan_ui_js = (ROOT / 'js' / 'plan-ui.js').read_text(encoding='utf-8')
        plan_ui_code = '\n'.join(
            line for line in plan_ui_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", plan_ui_js)
        self.assertIn("window.AgentApp.require('config')", plan_ui_js)
        self.assertIn('planUiState.settings', plan_ui_js)
        self.assertIn('planUiSaveData()', plan_ui_js)
        self.assertIn('PLAN_UI_PRESETS', plan_ui_js)
        self.assertIn("window.AgentApp.define('planUi'", plan_ui_js)
        for direct_usage in ('state.', 'saveData()', 'persistSettings()', 'currentChat()', 'PLAN_PRESETS['):
            self.assertNotIn(direct_usage, plan_ui_code)

    def test_reflection_consumes_state_and_config_modules(self):
        reflection_js = (ROOT / 'js' / 'reflection.js').read_text(encoding='utf-8')
        reflection_code = '\n'.join(
            line for line in reflection_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", reflection_js)
        self.assertIn("window.AgentApp.require('uiService')", reflection_js)
        self.assertIn("window.AgentApp.require('config')", reflection_js)
        self.assertIn('reflectionState.settings', reflection_js)
        self.assertIn('reflectionBeginChatTask(', reflection_js)
        self.assertIn('reflectionClearChatTask(', reflection_js)
        self.assertIn('ReflectionUiService.refreshMsgNode', reflection_js)
        self.assertIn('REFLECTION_CONFIG_PRESETS', reflection_js)
        self.assertIn("window.AgentApp.define('reflection'", reflection_js)
        for direct_usage in (
            'state.',
            'saveData()',
            'persistSettings()',
            'currentChat()',
            'chatById(',
            'isChatGenerating(',
            'beginChatTask(',
            'clearChatTask(',
            'setChatTaskMode(',
            'updateChatTaskController(',
            'isCurrentChat(',
            'REFLECTION_PRESETS[',
        ):
            self.assertNotIn(direct_usage, reflection_code)

    def test_backup_consumes_state_config_and_profile_modules(self):
        backup_js = (ROOT / 'js' / 'backup.js').read_text(encoding='utf-8')
        backup_code = '\n'.join(
            line for line in backup_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", backup_js)
        self.assertIn("window.AgentApp.require('config')", backup_js)
        self.assertIn("window.AgentApp.require('apiProfiles')", backup_js)
        self.assertIn('backupState.settings', backup_js)
        self.assertIn('backupPersistSettings()', backup_js)
        self.assertIn('backupPersistTools()', backup_js)
        self.assertIn('backupSaveData()', backup_js)
        self.assertIn('BackupConfigModule.STORE_KEY', backup_js)
        self.assertIn('backupLoadApiProfiles()', backup_js)
        self.assertIn("window.AgentApp.define('backup'", backup_js)
        for direct_usage in (
            'state.',
            'saveData()',
            'persistSettings()',
            'persistTools()',
            '\n  pendingImportData =',
            'loadApiProfiles()',
            'saveApiProfiles(',
            'getActiveProfileId()',
            'setActiveProfileId(',
            'renderApiProfileSelect()',
        ):
            self.assertNotIn(direct_usage, backup_code)

    def test_settings_page_consumes_state_module_without_confusing_local_state(self):
        settings_page_js = (ROOT / 'js' / 'settings-page.js').read_text(encoding='utf-8')
        settings_page_code = '\n'.join(
            line for line in settings_page_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", settings_page_js)
        self.assertIn('settingsPageState.settings', settings_page_js)
        self.assertIn('settingsPagePersistSettings()', settings_page_js)
        self.assertIn('const dockState = SETTINGS_PAGE_STATE', settings_page_js)
        self.assertIn("window.AgentApp.define('settingsPage'", settings_page_js)
        self.assertNotIn('state.settings', settings_page_code)
        self.assertNotIn('persistSettings()', settings_page_code)
        self.assertNotIn('const state = SETTINGS_PAGE_STATE', settings_page_code)

    def test_scheduled_tasks_consumes_state_module(self):
        scheduled_tasks_js = (ROOT / 'js' / 'scheduled-tasks.js').read_text(encoding='utf-8')
        scheduled_tasks_code = '\n'.join(
            line for line in scheduled_tasks_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", scheduled_tasks_js)
        self.assertIn('scheduledTasksState.settings', scheduled_tasks_js)
        self.assertIn('scheduledTasksSaveData()', scheduled_tasks_js)
        self.assertIn('scheduledTasksCurrentChat()', scheduled_tasks_js)
        self.assertIn('scheduledTasksIsCurrentChat(chat.id)', scheduled_tasks_js)
        self.assertIn("window.AgentApp.define('scheduledTasks'", scheduled_tasks_js)
        for direct_usage in (
            'state.',
            'saveData()',
            'currentChat()',
            'isCurrentChat(',
            'isChatGenerating(',
        ):
            self.assertNotIn(direct_usage, scheduled_tasks_code)

    def test_remote_control_consumes_state_module(self):
        remote_control_js = (ROOT / 'js' / 'remote-control.js').read_text(encoding='utf-8')
        remote_control_code = '\n'.join(
            line for line in remote_control_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", remote_control_js)
        self.assertIn('remoteControlState.settings.remoteControl', remote_control_js)
        self.assertIn('remoteControlSaveData()', remote_control_js)
        self.assertIn('remoteControlPersistSettings()', remote_control_js)
        self.assertIn('remoteControlChatById(', remote_control_js)
        self.assertIn('remoteControlIsChatGenerating(', remote_control_js)
        self.assertIn('remoteControlRequestStopChatTask(', remote_control_js)
        self.assertIn("window.AgentApp.define('remoteControl'", remote_control_js)
        for direct_usage in (
            'state.',
            'saveData()',
            'persistSettings()',
            'currentChat()',
            'chatById(',
            'isCurrentChat(',
            'isChatGenerating(',
            'isChatTaskMode(',
            'chatTaskById(',
            'syncGlobalTaskState(',
            'requestStopChatTask(',
            'ensureChatTasks(',
            'setChatTaskGuidance(',
            'typeof chatById',
            'typeof chatTaskById',
            'typeof isChatGenerating',
            'typeof isChatTaskMode',
            'typeof requestStopChatTask',
            'typeof syncGlobalTaskState',
        ):
            self.assertNotIn(direct_usage, remote_control_code)

    def test_debate_mode_consumes_state_module(self):
        debate_mode_js = (ROOT / 'js' / 'debate-mode.js').read_text(encoding='utf-8')
        debate_mode_code = '\n'.join(
            line for line in debate_mode_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", debate_mode_js)
        self.assertIn('debateState.settings', debate_mode_js)
        self.assertIn('debateSaveData()', debate_mode_js)
        self.assertIn('debateCurrentChat()', debate_mode_js)
        self.assertIn('debateChatById(', debate_mode_js)
        self.assertIn('debateBeginChatTask(', debate_mode_js)
        self.assertIn('debateClearChatTask(', debate_mode_js)
        self.assertIn("window.AgentApp.define('debateMode'", debate_mode_js)
        for direct_usage in (
            'state.',
            'saveData()',
            'persistSettings()',
            'currentChat()',
            'chatById(',
            'isCurrentChat(',
            'isChatGenerating(',
            'chatTaskById(',
            'clearChatTask(',
            'beginChatTask(',
            'setChatTaskMode(',
            'typeof isCurrentChat',
            'typeof clearChatTask',
            'typeof beginChatTask',
            'typeof setChatTaskMode',
        ):
            self.assertNotIn(direct_usage, debate_mode_code)

    def test_outline_core_consumes_state_module(self):
        outline_core_js = (ROOT / 'js' / 'outline-core.js').read_text(encoding='utf-8')
        outline_core_code = '\n'.join(
            line for line in outline_core_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", outline_core_js)
        self.assertIn('outlineCoreState.settings', outline_core_js)
        self.assertIn('outlineCoreSaveData()', outline_core_js)
        self.assertIn('outlineCoreCurrentChat()', outline_core_js)
        self.assertIn('outlineCoreChatById(', outline_core_js)
        self.assertIn('outlineCoreBeginChatTask(', outline_core_js)
        self.assertIn('outlineCoreClearChatTask(', outline_core_js)
        self.assertIn("window.AgentApp.define('outlineCore'", outline_core_js)
        for direct_usage in (
            'state.',
            'saveData()',
            'persistSettings()',
            'currentChat()',
            'chatById(',
            'isCurrentChat(',
            'isChatGenerating(',
            'beginChatTask(',
            'setChatTaskMode(',
            'updateChatTaskController(',
            'clearChatTask(',
            'activeTaskChat(',
            'typeof isChatGenerating',
            'typeof beginChatTask',
            'typeof setChatTaskMode',
            'typeof updateChatTaskController',
            'typeof clearChatTask',
            'typeof activeTaskChat',
        ):
            self.assertNotIn(direct_usage, outline_core_code)

    def test_privacy_guard_consumes_state_module(self):
        privacy_guard_js = (ROOT / 'js' / 'privacy-guard.js').read_text(encoding='utf-8')
        privacy_guard_code = '\n'.join(
            line for line in privacy_guard_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", privacy_guard_js)
        self.assertIn('privacyGuardState.settings', privacy_guard_js)
        self.assertIn('privacyGuardPersistSettings()', privacy_guard_js)
        self.assertIn("window.AgentApp.define('privacyGuard'", privacy_guard_js)
        self.assertNotIn('state.settings', privacy_guard_code)
        self.assertNotIn('typeof state', privacy_guard_code)
        self.assertNotIn('persistSettings()', privacy_guard_code)
        for inline_attr in (
            'onclick=',
            'onchange=',
            'oninput=',
            'onblur=',
            'onkeydown=',
            'onkeyup=',
        ):
            self.assertNotIn(inline_attr, privacy_guard_js)
        for delegated_attr in (
            'data-action="closePrivacySettings"',
            'data-action="clearPrivacyRestoreMappings"',
            'data-action="resetPrivacyGuardDefaults"',
            'data-action="savePrivacySettingsFromUi"',
        ):
            self.assertIn(delegated_attr, privacy_guard_js)

    def test_dialog_manager_consumes_state_module(self):
        dialog_manager_js = (ROOT / 'js' / 'dialog-manager.js').read_text(encoding='utf-8')
        dialog_manager_code = '\n'.join(
            line for line in dialog_manager_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", dialog_manager_js)
        self.assertIn('dialogManagerState.settings.dialogManager', dialog_manager_js)
        self.assertIn('dialogManagerSaveData()', dialog_manager_js)
        self.assertIn('dialogManagerCurrentChat()', dialog_manager_js)
        self.assertIn('dialogManagerChatById(', dialog_manager_js)
        self.assertIn("window.AgentApp.define('dialogManager'", dialog_manager_js)
        for direct_usage in (
            'state.',
            'saveData()',
            'persistSettings()',
            'currentChat()',
            'chatById(',
            'isChatGenerating(',
            'syncGlobalTaskState(',
        ):
            self.assertNotIn(direct_usage, dialog_manager_code)

    def test_concurrent_requests_consumes_state_module(self):
        concurrent_requests_js = (ROOT / 'js' / 'concurrent-requests.js').read_text(encoding='utf-8')
        concurrent_requests_code = '\n'.join(
            line for line in concurrent_requests_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", concurrent_requests_js)
        self.assertIn('concurrentRequestsState.settings', concurrent_requests_js)
        self.assertIn('concurrentRequestsSaveData()', concurrent_requests_js)
        self.assertIn('concurrentRequestsCurrentChat()', concurrent_requests_js)
        self.assertIn('concurrentRequestsChatById(', concurrent_requests_js)
        self.assertIn("window.AgentApp.require('uiService')", concurrent_requests_js)
        self.assertIn('ConcurrentRequestsUiService.toast', concurrent_requests_js)
        self.assertIn("window.AgentApp.define('concurrentRequests'", concurrent_requests_js)
        for direct_usage in (
            'state.',
            'saveData()',
            'currentChat()',
            'chatById(',
            'isCurrentChat(',
            'typeof toast',
            'typeof renderMessages',
            'typeof renderChatList',
            'typeof updateSendBtn',
            '\ntoast(',
            '\nrenderMessages();',
            '\nrenderChatList();',
            '\nupdateSendBtn();',
        ):
            self.assertNotIn(direct_usage, concurrent_requests_code)

    def test_task_queue_consumes_state_module(self):
        task_queue_js = (ROOT / 'js' / 'task-queue.js').read_text(encoding='utf-8')
        task_queue_code = '\n'.join(
            line for line in task_queue_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", task_queue_js)
        self.assertIn('taskQueueState.taskQueue', task_queue_js)
        self.assertIn('taskQueueSaveData()', task_queue_js)
        self.assertIn('taskQueueChatById(', task_queue_js)
        self.assertIn('taskQueueIsChatGenerating(', task_queue_js)
        self.assertIn("window.AgentApp.define('taskQueue'", task_queue_js)
        for direct_usage in (
            'state.',
            'saveData()',
            'currentChat()',
            'chatById(',
            'isCurrentChat(',
            'isChatGenerating(',
            'chatTaskById(',
            'requestStopChatTask(',
        ):
            self.assertNotIn(direct_usage, task_queue_code)

    def test_ppt_mode_consumes_state_module(self):
        ppt_mode_js = (ROOT / 'js' / 'ppt-mode.js').read_text(encoding='utf-8')
        ppt_mode_code = '\n'.join(
            line for line in ppt_mode_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", ppt_mode_js)
        self.assertIn('pptModeState.settings', ppt_mode_js)
        self.assertIn('pptModeSaveData()', ppt_mode_js)
        self.assertIn('pptModeCurrentChat()', ppt_mode_js)
        self.assertIn('pptModeChatById(', ppt_mode_js)
        self.assertIn('pptModeBeginChatTask(', ppt_mode_js)
        self.assertIn("window.AgentApp.define('pptMode'", ppt_mode_js)
        for direct_usage in (
            'state.',
            'saveData()',
            'persistSettings()',
            'currentChat()',
            'chatById(',
            'chatTaskById(',
            'clearChatTask(',
            'syncGlobalTaskState(',
            'beginChatTask(',
            'setChatTaskMode(',
        ):
            self.assertNotIn(direct_usage, ppt_mode_code)

    def test_outline_render_consumes_state_module(self):
        outline_render_js = (ROOT / 'js' / 'outline-render.js').read_text(encoding='utf-8')
        outline_render_code = '\n'.join(
            line for line in outline_render_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", outline_render_js)
        self.assertIn('outlineRenderState.settings', outline_render_js)
        self.assertIn('outlineRenderSaveData()', outline_render_js)
        self.assertIn('outlineRenderCurrentChat()', outline_render_js)
        self.assertIn('outlineRenderIsChatGenerating(', outline_render_js)
        self.assertIn('outlineRenderBeginChatTask(', outline_render_js)
        self.assertIn("window.AgentApp.define('outlineRender'", outline_render_js)
        for direct_usage in (
            'state.',
            'saveData()',
            'persistSettings()',
            'currentChat()',
            'chatById(',
            'isCurrentChat(',
            'isChatGenerating(',
            'isChatTaskMode(',
            'chatTaskById(',
            'clearChatTask(',
            'syncGlobalTaskState(',
            'beginChatTask(',
            'setChatTaskMode(',
            'requestStopChatTask(',
        ):
            self.assertNotIn(direct_usage, outline_render_code)

    def test_terminal_consumes_state_module(self):
        terminal_js = (ROOT / 'js' / 'terminal.js').read_text(encoding='utf-8')
        terminal_code = '\n'.join(
            line for line in terminal_js.splitlines()
            if not line.lstrip().startswith('//')
        )

        self.assertIn("window.AgentApp.require('state')", terminal_js)
        self.assertIn('terminalState.settings', terminal_js)
        self.assertIn('terminalSaveData()', terminal_js)
        self.assertIn('terminalCurrentChat()', terminal_js)
        self.assertIn('terminalChatById(', terminal_js)
        self.assertIn('terminalIsChatGenerating(', terminal_js)
        self.assertIn('terminalSyncGlobalTaskState(', terminal_js)
        self.assertIn("window.AgentApp.define('terminal'", terminal_js)
        for direct_usage in (
            'state.',
            'typeof state',
            'saveData()',
            'persistSettings()',
            'currentChat()',
            'chatById(',
            'isCurrentChat(',
            'isChatGenerating(',
            'isChatTaskMode(',
            'chatTaskById(',
            'syncGlobalTaskState(',
            'typeof isChatTaskMode',
            'typeof chatTaskById',
            'typeof isChatGenerating',
            'typeof syncGlobalTaskState',
        ):
            self.assertNotIn(direct_usage, terminal_code)

    def test_terminal_allows_git_clone_passthrough(self):
        terminal_js = (ROOT / 'js' / 'terminal.js').read_text(encoding='utf-8')
        route_idx = terminal_js.index('async function routeGitExecuteCommand')
        control_guard_idx = terminal_js.index('commandHasShellOperators(command)', route_idx)
        tools_available_idx = terminal_js.index('if (!aiGitToolsAvailable())', route_idx)
        clone_idx = terminal_js.index("if (sub === 'clone')")

        self.assertLess(control_guard_idx, tools_available_idx)
        self.assertGreater(clone_idx, control_guard_idx)
        self.assertIn("git_execute: {", terminal_js)
        self.assertIn("function gitExecutePassthrough", terminal_js)
        self.assertIn("permissionCategory: 'git_execute'", terminal_js)
        self.assertRegex(terminal_js, r"if \(sub === 'clone'\) \{\s*return gitExecutePassthrough\(true\);\s*\}")

    def test_terminal_allows_read_only_git_passthrough(self):
        terminal_js = (ROOT / 'js' / 'terminal.js').read_text(encoding='utf-8')

        self.assertIn('function gitReadOnlyPassthroughDecision', terminal_js)
        for command in (
            'rev-parse', 'ls-files', 'show-ref', 'for-each-ref',
            'describe', 'merge-base', 'blame', 'grep', 'ls-tree',
            'branch', 'remote', 'tag', 'reflog', 'cat-file',
            'submodule', 'worktree', 'ls-remote'
        ):
            self.assertIn(f"'{command}'", terminal_js)

        self.assertIn("'--output'", terminal_js)
        self.assertIn("'--ext-diff'", terminal_js)
        self.assertIn("'--open-files-in-pager'", terminal_js)
        self.assertIn("'--upload-pack'", terminal_js)
        self.assertIn("'--help'", terminal_js)
        self.assertIn('if (parsed.passthroughOnly)', terminal_js)
        self.assertRegex(
            terminal_js,
            r"if \(readOnlyDecision && readOnlyDecision\.passthrough\) \{\s*return gitExecutePassthrough\(!!readOnlyDecision\.forceConfirm\);\s*\}",
        )

    def test_terminal_full_access_bypasses_all_git_routing(self):
        terminal_js = (ROOT / 'js' / 'terminal.js').read_text(encoding='utf-8')
        route_start = terminal_js.index('async function routeGitExecuteCommand')
        route_end = terminal_js.index('function normalizeExecuteTimeoutSec', route_start)
        route = terminal_js[route_start:route_end]

        self.assertIn('const fullAccessAllowed = isFullAccessModeEnabled();', route)
        full_access_idx = route.index('if (fullAccessAllowed) return null;')
        control_guard_idx = route.index('commandHasShellOperators(command)')
        first_passthrough_idx = route.index('gitExecutePassthrough(true)')
        self.assertLess(full_access_idx, control_guard_idx)
        self.assertLess(full_access_idx, first_passthrough_idx)

    def test_goal_mode_surfaces_tool_calls_in_main_chat(self):
        goal_core_js = (ROOT / 'js' / 'goal-core.js').read_text(encoding='utf-8')
        config_js = (ROOT / 'js' / 'config.js').read_text(encoding='utf-8')
        tools_js = (ROOT / 'js' / 'tools.js').read_text(encoding='utf-8')
        api_core_js = (ROOT / 'js' / 'api-core.js').read_text(encoding='utf-8')
        html = next(ROOT.glob('AI-Chat-*.html')).read_text(encoding='utf-8')

        self.assertIn('function createGoalChatRecorder', goal_core_js)
        self.assertIn("event.type === 'tool_call'", goal_core_js)
        self.assertIn("event.type === 'tool_result'", goal_core_js)
        self.assertIn("role: 'tool'", goal_core_js)
        self.assertIn('assistant.tool_calls.push', goal_core_js)
        self.assertIn('function goalFinalTextFromUpdateGoalArgs', goal_core_js)
        self.assertIn('function goalFinalTextFromUpdateGoalResult', goal_core_js)
        self.assertIn('function goalTerminalFinalText', goal_core_js)
        self.assertIn('rememberFinalText(goalFinalTextFromUpdateGoalArgs(event.args))', goal_core_js)
        self.assertIn('rememberFinalText(goalFinalTextFromUpdateGoalResult(event.content))', goal_core_js)
        self.assertIn('appendGoalTerminalFinalAssistant()', goal_core_js)
        self.assertIn('appendGoalTurnFinalAssistant()', goal_core_js)
        self.assertIn("nextStep ? '下一步：' + nextStep : ''", goal_core_js)
        self.assertIn('_goalFinal: true', goal_core_js)
        self.assertIn('rememberFinalText(event.finalText)', goal_core_js)
        self.assertIn('function goalChatRecordedTokenTotal', goal_core_js)
        self.assertIn('function goalRecordedTokenUsed', goal_core_js)
        self.assertIn('function syncGoalTokenUsageFromChat', goal_core_js)
        self.assertIn('function goalEstimateTurnTokens', goal_core_js)
        self.assertIn('const messageCountBeforeRun = chat.messages.length', goal_core_js)
        self.assertIn('const turnPrompt = buildGoalTurnPrompt(freshGoal, turnGuidance)', goal_core_js)
        self.assertIn('const contextMessages = buildGoalConversationContext(chat, userMsgIdx)', goal_core_js)
        self.assertIn("initialMessages: [...contextMessages, { role: 'user', content: turnPrompt }]", goal_core_js)
        self.assertIn('const tokenStatsBefore = goalChatRecordedTokenTotal(chat)', goal_core_js)
        self.assertIn('Math.max(0, goalChatRecordedTokenTotal(chat) - tokenStatsBefore)', goal_core_js)
        self.assertIn('goalEstimateTurnTokens(systemPrompt, turnPrompt, chat, messageCountBeforeRun)', goal_core_js)
        self.assertIn('syncGoalTokenUsageFromChat(latestGoal)', goal_core_js)
        update_goal_config_idx = config_js.index("name: 'update_goal'")
        update_goal_config_block = config_js[update_goal_config_idx:config_js.index("code: 'return await updateGoal", update_goal_config_idx)]
        self.assertIn("enum: ['active', 'complete', 'blocked']", update_goal_config_block)
        self.assertIn('AI 不允许暂停或取消目标', update_goal_config_block)
        update_goal_fn = goal_core_js[goal_core_js.index('function updateGoal'):goal_core_js.index('function summarizeGoalForTool')]
        self.assertIn("const toolForbiddenStatus = requestedStatus === 'paused' || requestedStatus === 'cancelled';", update_goal_fn)
        self.assertIn("pushGoalEvent(goal, 'status_rejected'", update_goal_fn)
        self.assertIn("GOAL_TERMINAL_STATUSES.has(goal.status)", update_goal_fn)
        self.assertIn("pushGoalEvent(goal, 'update_rejected'", update_goal_fn)
        self.assertNotIn("Paused by tool", update_goal_fn)
        self.assertNotIn("Cancelled by tool", update_goal_fn)
        self.assertIn("const GOAL_RUNTIME_TOOL_NAMES = new Set(['get_goal', 'update_goal']);", goal_core_js)
        self.assertIn("if (!tool || !GOAL_RUNTIME_TOOL_NAMES.has(tool.name)) continue;", goal_core_js)
        self.assertIn("const TOOLS_GOAL_TOOL_NAMES = new Set(['create_goal', 'get_goal', 'update_goal']);", tools_js)
        self.assertIn("const TOOLS_GOAL_RUNTIME_TOOL_NAMES = new Set(['get_goal', 'update_goal']);", tools_js)
        self.assertIn('function toolVisibleForContext(tool, options = {})', tools_js)
        self.assertIn("return isGoalToolContext(toolContext) && TOOLS_GOAL_RUNTIME_TOOL_NAMES.has(tool.name);", tools_js)
        self.assertIn('if (isGoalToolName(name)) {', tools_js)
        self.assertIn('create_goal 不允许由 AI 工具调用创建', tools_js)
        self.assertIn('buildToolsArray({ force: true, toolContext })', api_core_js)
        self.assertIn('function scheduleGoalChatNodeUpdate', goal_core_js)
        self.assertIn("GoalCoreUiService.has('appendMsgNode')", goal_core_js)
        self.assertIn('GoalCoreUiService.appendMsgNode(item.idx, item.chat)', goal_core_js)
        self.assertIn("GoalCoreUiService.has('updateMsgContentNode')", goal_core_js)
        self.assertIn("GoalCoreUiService.updateMsgContentNode(item.idx, item.chat, { streaming: true })", goal_core_js)
        self.assertIn('GoalCoreUiService.refreshMsgNode(item.idx, item.chat)', goal_core_js)
        self.assertIn("scheduleGoalChatNodeUpdate(chat, recorder.assistantIdx, 'content')", goal_core_js)
        self.assertIn("scheduleGoalChatNodeUpdate(chat, userMsgIdx, 'append')", goal_core_js)
        self.assertIn('const goalCurrentChat = GoalCoreStateModule.currentChat', goal_core_js)
        self.assertIn('function bindGoalToChat(goal, chat)', goal_core_js)
        self.assertIn('if (!chat) chat = goalCurrentChat();', goal_core_js)
        self.assertIn('if (!Array.isArray(chat.goalIds)) chat.goalIds = [];', goal_core_js)
        self.assertIn('const goalTakeChatTaskGuidance = GoalCoreStateModule.takeChatTaskGuidance', goal_core_js)
        self.assertIn('function consumePendingGoalGuidance(chat, goal)', goal_core_js)
        self.assertIn('function queueGoalGuidance(goal, text)', goal_core_js)
        self.assertIn("queueGoalGuidance(goal, '目标已修改，请按新的目标继续：\\n' + goal.objective)", goal_core_js)
        self.assertIn("chatRecorder.finish({ appendFinal: !suppressFinalAssistant })", goal_core_js)
        self.assertIn("setTimeout(() => continueGoal(latestGoal.id), 0)", goal_core_js)
        self.assertIn("return !task.mode || task.mode === 'chat' || task.mode === 'goal';", (ROOT / 'js' / 'chat.js').read_text(encoding='utf-8'))
        self.assertNotIn("const id = 'goal_' + Date.now();", goal_core_js)
        self.assertNotIn('scheduleGoalChatRender', goal_core_js)
        self.assertNotIn('goalChatRenderScheduled', goal_core_js)
        turn_message_idx = goal_core_js.index("content: '目标第 ' + turnNo + ' 轮：继续推进")
        turn_message_block = goal_core_js[turn_message_idx:goal_core_js.index('_goalTurn: turnNo', turn_message_idx)]
        self.assertNotIn('_hiddenFromUI: true', turn_message_block)
        turn_ui_block = goal_core_js[goal_core_js.index('const userMsgIdx = chat.messages.length - 1'):goal_core_js.index('const protocol = { toolCalls: [] };')]
        self.assertNotIn('GoalCoreUiService.renderMessages()', turn_ui_block)
        result_ui_block = goal_core_js[goal_core_js.index('const protocolViolation = applyGoalProtocolAudit'):goal_core_js.index('keepGoing = !!goalSettings().goalAutoContinue')]
        self.assertNotIn('GoalCoreUiService.renderMessages()', result_ui_block)
        self.assertNotIn("content: '目标第 ' + turnNo + ' 轮：\\n\\n' + finalText", goal_core_js)
        self.assertIn('data-action="deleteActiveGoal"', html)
        self.assertIn('data-handler="deleteGoalById"', goal_core_js)

    def test_goal_settings_jump_closes_goal_panel(self):
        settings_page_js = (ROOT / 'js' / 'settings-page.js').read_text(encoding='utf-8')
        event_delegation_js = (ROOT / 'js' / 'event-delegation.js').read_text(encoding='utf-8')

        open_goal_idx = settings_page_js.index('window.openGoalSettings = function()')
        close_panel_idx = settings_page_js.index('window.closeGoalPanel', open_goal_idx)
        open_page_idx = settings_page_js.index("openSettingsPage('goal')", open_goal_idx)

        self.assertLess(close_panel_idx, open_page_idx)
        self.assertIn("goal: { open: 'openGoalSettings', close: 'closeGoalSettings', modalId: 'goalSettingsModal', module: 'goalCore' }", settings_page_js)
        self.assertIn('function getSettingsOriginalFunction(section, name)', settings_page_js)
        self.assertIn('window.AgentApp.optional(moduleName)', settings_page_js)
        self.assertIn('const openFn = getSettingsOriginalFunction(section, config.open);', settings_page_js)
        self.assertIn('getSettingsOriginalFunction(active, config.close)', settings_page_js)
        self.assertIn("'deleteActiveGoal'", event_delegation_js)
        self.assertIn("'deleteGoalById'", event_delegation_js)
        self.assertIn("openGoalPanel: 'goalCore'", event_delegation_js)
        self.assertIn("openGoalSettings: 'goalCore'", event_delegation_js)
        self.assertIn('AgentApp.optional(moduleName)', event_delegation_js)

    def test_goal_topbar_button_is_management_entry_only(self):
        html = next(ROOT.glob('AI-Chat-*.html')).read_text(encoding='utf-8')
        goal_core_js = (ROOT / 'js' / 'goal-core.js').read_text(encoding='utf-8')
        base_css = (ROOT / 'css' / 'base.css').read_text(encoding='utf-8')

        self.assertIn('id="goalBtn" data-action="openGoalPanel" title="目标管理"', html)
        self.assertIn("btn.classList.remove('goal-active')", goal_core_js)
        self.assertNotIn("classList.toggle('goal-active'", goal_core_js)
        self.assertNotIn('.topbar-btn.goal-active', base_css)

    def test_goal_cards_drive_detail_selection(self):
        goal_core_js = (ROOT / 'js' / 'goal-core.js').read_text(encoding='utf-8')
        event_delegation_js = (ROOT / 'js' / 'event-delegation.js').read_text(encoding='utf-8')
        base_css = (ROOT / 'css' / 'base.css').read_text(encoding='utf-8')

        self.assertIn('role="button" tabindex="0" data-action="valueClick"', goal_core_js)
        self.assertIn('data-keydown-action="goalCardSelect"', goal_core_js)
        self.assertIn("const selected = goal.id === goalStore.selectedGoalId", goal_core_js)
        self.assertIn('return goalById(goalStore.selectedGoalId) || goalStore.goals[0] || null;', goal_core_js)
        self.assertNotIn('goalStore.selectedGoalId = goal.id;\n  pushGoalEvent(goal, \'continued\'', goal_core_js)
        self.assertNotIn('selectGoalById(goalId);\n  return continueGoal(goalId);', goal_core_js)
        self.assertIn('goalCardSelect(event, target)', event_delegation_js)
        self.assertIn('.goal-item:hover', base_css)
        self.assertIn('.goal-item:focus-visible', base_css)
        self.assertIn('function goalCardTitle(goal, max = 120)', goal_core_js)
        self.assertIn('const cardTitle = goalCardTitle(goal);', goal_core_js)
        self.assertNotIn('goal-item-title">${escapeGoalHtml(clipGoalText(goal.objective, 76))}</span>', goal_core_js)
        self.assertIn('function goalElapsedText(goal, now = Date.now())', goal_core_js)
        self.assertIn('function startGoalElapsedTimer()', goal_core_js)
        self.assertIn('goalElapsedTimer = setInterval(refreshGoalElapsedStat, 1000);', goal_core_js)
        self.assertIn('stopGoalElapsedTimer();', goal_core_js)
        self.assertIn('<div><strong id="goalElapsedStat">${escapeGoalHtml(goalElapsedText(goal))}</strong><span>任务耗时</span></div>', goal_core_js)
        self.assertNotIn('<div><strong>${goal.maxTurns}</strong><span>轮次上限</span></div>', goal_core_js)
        self.assertIn('.goal-list{display:flex;flex-direction:column;gap:8px;max-height:76vh;', base_css)
        self.assertIn('.goal-item{border:1px solid var(--border);border-radius:9px;background:var(--bg-sidebar);padding:8px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:stretch;', base_css)
        self.assertIn('.goal-item-main{appearance:none;border:0;background:transparent;color:inherit;text-align:left;padding:0;display:flex;flex-direction:column;justify-content:space-between;gap:6px;', base_css)
        self.assertIn('.goal-item-title{font-size:13px;font-weight:650;color:var(--text);line-height:1.35;display:-webkit-box;-webkit-line-clamp:4;', base_css)
        self.assertIn('.goal-item-actions{display:flex;flex-direction:column;gap:5px;flex-wrap:nowrap;', base_css)
        self.assertIn('.goal-item-actions .btn{width:100%;min-width:44px}', base_css)

    def test_service_modules_load_in_dependency_order(self):
        html = (ROOT / 'AI-Chat-大模型对话助手.html').read_text(encoding='utf-8')

        app_idx = html.index('js/app-context.js')
        api_core_idx = html.index('js/api-core.js')
        tools_idx = html.index('js/tools.js')
        reflection_idx = html.index('js/reflection.js')
        plan_core_idx = html.index('js/plan-core.js')
        outline_core_idx = html.index('js/outline-core.js')
        outline_render_idx = html.index('js/outline-render.js')
        orchestration_idx = html.index('js/orchestration-service.js')
        chat_idx = html.index('js/chat.js')
        ui_idx = html.index('js/ui-service.js')
        file_explorer_idx = html.index('js/file-explorer.js')
        git_panel_idx = html.index('js/git-panel.js')
        dialog_manager_idx = html.index('js/dialog-manager.js')
        lms_panel_idx = html.index('js/lms_panel.js')
        scheduled_tasks_idx = html.index('js/scheduled-tasks.js')
        task_queue_idx = html.index('js/task-queue.js')
        main_idx = html.index('js/main.js')
        dom_events_idx = html.index('js/event-delegation.js')

        self.assertLess(app_idx, ui_idx)
        self.assertLess(ui_idx, orchestration_idx)
        self.assertLess(ui_idx, chat_idx)
        self.assertLess(app_idx, orchestration_idx)
        self.assertLess(orchestration_idx, api_core_idx)
        self.assertLess(orchestration_idx, tools_idx)
        self.assertLess(orchestration_idx, reflection_idx)
        self.assertLess(orchestration_idx, plan_core_idx)
        self.assertLess(orchestration_idx, outline_core_idx)
        self.assertLess(orchestration_idx, outline_render_idx)
        self.assertLess(orchestration_idx, chat_idx)
        self.assertLess(ui_idx, file_explorer_idx)
        self.assertLess(ui_idx, git_panel_idx)
        self.assertLess(ui_idx, dialog_manager_idx)
        self.assertLess(ui_idx, lms_panel_idx)
        self.assertLess(ui_idx, scheduled_tasks_idx)
        self.assertLess(ui_idx, task_queue_idx)
        self.assertLess(ui_idx, dom_events_idx)
        self.assertLess(main_idx, dom_events_idx)

    def test_service_module_api_contracts(self):
        contracts = {
            'ui-service.js': (
                'uiService',
                ['has', 'toast', 'renderMessages', 'refreshMsgNode', 'appendMsgNode', 'updateMsgContentNode', 'renderChatList', 'updateSendBtn', 'scrollToBottom']
            ),
            'orchestration-service.js': (
                'orchestrationService',
                ['callAPI', 'callAPIWithPlan', 'callAPIWithOutline', 'callAPIWithPptMode', 'callAPIWithReflection', 'executeTool', 'callOnceWithRole', 'callByMode']
            ),
            'event-delegation.js': (
                'domEvents',
                ['init', 'handleClick', 'handleChange', 'handleInput', 'handleKeydown', 'openSettingsSection', 'openCurrentFileInMainPanel', 'applyPlanPreset', 'applyPreset', 'switchMcpSkillTab', 'initProjectInstructions', 'initProjectMemory', 'taskQueueOpenChat', 'taskQueueUpdateItemText', 'addPresetTool', 'hideModal', 'hideSelf', 'switchJsonTab', 'importFromFile', 'exportDialogManagedChat', 'setDialogExportChat', 'valueClick', 'valueChange', 'valueInput', 'enterGlobal', 'syncMaxToolRoundsRange', 'syncPlanSettingRange', 'syncPlanSettingInput', 'setLabelFromValue', 'directClickActions', 'changeActions', 'keydownActions']
            ),
            'api-core.js': (
                'apiCore',
                ['callAPI', 'callOnceWithRole', 'handleStream', 'handleNonStream']
            ),
            'tools.js': (
                'tools',
                ['executeTool', 'buildToolsArray', 'prepareToolResultForContext']
            ),
            'plan-core.js': (
                'planCore',
                ['callAPIWithPlan', 'approveAndExecutePlan', 'cancelPlan']
            ),
            'outline-core.js': (
                'outlineCore',
                ['callAPIWithOutline', 'executeOutlineToolWithTimeout', 'handleOutlineTool']
            ),
            'security-records.js': (
                'securityRecords',
                ['loadSecurityRecords', 'saveSecurityRecords', 'addSecurityRecord', 'openSecurityRecords', 'renderSecurityRecords']
            ),
            'stats-toggle.js': (
                'statsToggle',
                ['applyStatsBarCollapsed', 'initStatsBarToggle', 'toggleStatsBar']
            ),
            'file-explorer.js': (
                'fileExplorer',
                ['renderFileExplorer', 'loadFileExplorer', 'openFileEditor', 'openPdfViewer', 'openCurrentFileInMainPanel', 'uploadSelectedFilesToExplorer', 'openFileExplorerUploadPicker', 'copyFileExplorerPath', 'copyFileExplorerRelativePath', 'copyFileExplorerAbsolutePath', 'copyFileExplorerItem', 'cutFileExplorerItem', 'pasteFileExplorerItem', 'downloadFileExplorerPath']
            ),
            'git-panel.js': (
                'gitPanel',
                ['openGitPanel', 'closeGitPanel', '_refreshGitPanel', '_doInit', '_onCommit', '_doPush', '_doPull', '_doFetch']
            ),
            'lms.js': (
                'lms',
                ['lmsGetCookie', 'lmsApiGet', 'lmsScoreQuery', 'lmsToolScores', 'lmsToolDownload', 'lmsToolSetCookie']
            ),
            'lms_panel.js': (
                'lmsPanel',
                ['openLmsPanel', 'closeLmsPanel', 'lmsPanelRender', 'lmsPanelFetchAll', 'lmsPanelFetchScores', 'lmsPanelSaveCookie', 'lmsPanelClearCookie']
            ),
            'paper_tools.js': (
                'paperTools',
                ['arxivSearch', 'semanticScholarSearch', 'dblpSearch', 'openAlexSearch', 'crossrefSearch', 'fetchPdfText']
            ),
        }

        for filename, (module_name, exports) in contracts.items():
            js = (ROOT / 'js' / filename).read_text(encoding='utf-8')
            self.assertIn(f"AgentApp.define('{module_name}'", js)
            for export in exports:
                self.assertIn(export, js, f'{filename} should expose {export}')

    def test_file_explorer_exposes_event_delegate_helpers(self):
        file_explorer_js = (ROOT / 'js' / 'file-explorer.js').read_text(encoding='utf-8')

        for helper in (
            'function toggleFileEditorMarkdownPreview()',
            'function toggleFileEditorCodePreview()',
            'window.toggleFileEditorMarkdownPreview = toggleFileEditorMarkdownPreview',
            'window.toggleFileEditorCodePreview = toggleFileEditorCodePreview',
            'window.setFileEditorCodePreview = setFileEditorCodePreview',
        ):
            self.assertIn(helper, file_explorer_js)
        for inline_attr in (
            'onclick=',
            'onchange=',
            'oninput=',
            'onblur=',
            'onkeydown=',
            'onkeyup=',
        ):
            self.assertNotIn(inline_attr, file_explorer_js)
        for delegated_attr in (
            'data-action="copyInlineFileContent"',
            'data-action="toggleInlineMarkdownPreview"',
            'data-action="toggleInlinePythonPreview"',
            'data-action="reloadInlineFilePanel"',
            'data-action="openInlineFileInNewTab"',
        ):
            self.assertIn(delegated_attr, file_explorer_js)

    def test_file_explorer_supports_context_menu_upload(self):
        file_explorer_js = (ROOT / 'js' / 'file-explorer.js').read_text(encoding='utf-8')
        base_css = (ROOT / 'css' / 'base.css').read_text(encoding='utf-8')
        handler_py = (ROOT / 'server' / 'handler.py').read_text(encoding='utf-8')

        for snippet in (
            'data-action="upload-files" data-remote-only="true"',
            'data-action="upload-folder" data-remote-only="true"',
            'data-remote-only="true"',
            'function isFileExplorerRemoteMode()',
            'function requireFileExplorerRemoteAction()',
            'function isFileExplorerRemoteOnlyAction(action)',
            'btn.hidden = !isFileExplorerRemoteMode()',
            "action === 'upload-files'",
            "action === 'upload-folder'",
            "isFileExplorerRemoteOnlyAction(action) && !requireFileExplorerRemoteAction()",
            "openFileExplorerUploadPicker('files', path)",
            "openFileExplorerUploadPicker('folder', path)",
            'function ensureFileExplorerUploadInput(kind)',
            "input.type = 'file'",
            'input.multiple = true',
            "input.setAttribute('webkitdirectory', '')",
            'function handleFileExplorerUploadInputChange(event, kind, targetPath)',
            'function uploadSelectedFilesToExplorer',
            'function fileExplorerItemsFromFileList(files)',
        ):
            self.assertIn(snippet, file_explorer_js)

        for removed in (
            'handleFileExplorerCapturedDragEnter',
            'handleFileExplorerCapturedDragOver',
            'handleFileExplorerCapturedDragLeave',
            'handleFileExplorerCapturedDrop',
            'handleFileExplorerDragEnter',
            'handleFileExplorerDragOver',
            'handleFileExplorerDragLeave',
            'handleFileExplorerDrop',
            'consumeFileExplorerDragEvent',
            'preventBrowserFileDropNavigation',
            'uploadDroppedFilesToExplorer',
            'collectDroppedFiles',
            'webkitGetAsEntry',
        ):
            self.assertNotIn(removed, file_explorer_js)

        self.assertIn('function fileExplorerReadFileAsArrayBuffer', file_explorer_js)
        self.assertIn('const FILE_EXPLORER_UPLOAD_CHUNK_BYTES', file_explorer_js)
        self.assertIn('function uploadExplorerFileInChunks', file_explorer_js)
        self.assertIn('file.slice(offset, end)', file_explorer_js)
        self.assertIn('reader.readAsArrayBuffer(file)', file_explorer_js)
        self.assertNotIn('reader.readAsDataURL(file)', file_explorer_js)
        self.assertNotIn('FILE_EXPLORER_UPLOAD_MAX_BYTES', file_explorer_js)
        self.assertIn("callAgentBackend(\n      'file_upload_chunk'", file_explorer_js)
        self.assertIn('total_chunks: totalChunks', file_explorer_js)
        self.assertIn('checkpoint_id: checkpointId || undefined', file_explorer_js)
        self.assertIn("encoding: 'base64'", file_explorer_js)
        self.assertIn('{ skipConfirm: true }', file_explorer_js)
        self.assertNotIn('.file-explorer-list.is-drag-over', base_css)
        self.assertIn('def _compact_large_write_payload', handler_py)
        self.assertIn("action not in ('write_file', 'file_upload_chunk')", handler_py)

    def test_chat_attachment_reading_avoids_browser_data_url_limit(self):
        chat_js = (ROOT / 'js' / 'chat.js').read_text(encoding='utf-8')

        self.assertIn('function chatReadFileAsDataUrl', chat_js)
        self.assertIn('function chatDropContainsDirectory', chat_js)
        self.assertIn('reader.readAsArrayBuffer(file)', chat_js)
        self.assertIn('文件夹请拖到资源管理器上传', chat_js)
        self.assertNotIn('readAsDataURL(file)', chat_js)

    def test_file_explorer_context_menu_supports_copy_cut_paste_and_download(self):
        file_explorer_js = (ROOT / 'js' / 'file-explorer.js').read_text(encoding='utf-8')
        terminal_js = (ROOT / 'js' / 'terminal.js').read_text(encoding='utf-8')
        concurrent_js = (ROOT / 'js' / 'concurrent-requests.js').read_text(encoding='utf-8')
        routes_py = (ROOT / 'server' / 'routes.py').read_text(encoding='utf-8')
        preview_py = (ROOT / 'server' / 'preview.py').read_text(encoding='utf-8')

        for snippet in (
            'data-action="copy-item"',
            'data-action="cut-item"',
            'data-action="paste"',
            'data-paste-only="true"',
            'data-action="download" data-remote-only="true"',
            'data-action="copy-path"',
            'data-action="copy-absolute-path"',
            "action === 'download' || action === 'upload-files' || action === 'upload-folder'",
            '复制相对路径',
            '复制绝对路径',
            'function copyFileExplorerRelativePath',
            'function copyFileExplorerAbsolutePath',
            'function joinFileExplorerAbsolutePath',
            'function copyFileExplorerItem',
            'function cutFileExplorerItem',
            'function pasteFileExplorerItem',
            'function downloadFileExplorerPath',
            "action === 'copy-absolute-path'",
            'FILE_EXPLORER_STATE.workspaceRoot',
            "'copy_file'",
            "'move_file'",
            "clip.mode === 'cut'",
            'target_dir: normalizedTargetDir',
            '&download=1',
            "&archive=zip",
            "type === 'dir'",
        ):
            self.assertIn(snippet, file_explorer_js)
        self.assertNotIn('data-file-only="true"', file_explorer_js)

        self.assertIn("copy_file: 'write'", terminal_js)
        self.assertIn("move_file: 'edit'", terminal_js)
        self.assertIn("ActionRoute('copy_file', 'handle_copy_file')", routes_py)
        self.assertIn("ActionRoute('move_file', 'handle_move_file')", routes_py)
        self.assertIn("action === 'copy_file'", concurrent_js)
        self.assertIn("action === 'move_file'", concurrent_js)
        self.assertIn("'attachment' if download_mode else 'inline'", preview_py)

    def test_static_shell_controls_use_event_delegation(self):
        html = (ROOT / 'AI-Chat-大模型对话助手.html').read_text(encoding='utf-8')

        for migrated_handler in (
            'onclick="newChat()"',
            'onclick="onSend()"',
            'onclick="toggleSidebar()"',
            'onclick="togglePlan()"',
            'onclick="toggleOutline()"',
            'onclick="toggleTools()"',
            'onclick="toggleTracePanel()"',
            'onclick="document.getElementById(\'fileInput\').click()"',
            'onchange="onPickFiles(event)"',
            'oninput="renderTracePanel()"',
            'onclick="openSettingsSection(',
            'onclick="toggleTheme()"',
            'onclick="toggleCoolMode()"',
            'onclick="toggleSecurityMode()"',
            'onclick="closeSettingsPage()"',
            'onclick="closeSettings()"',
            'onchange="onApiProfileSelectChange()"',
            'onclick="toggleApiProfileMenu()"',
            'onclick="onSaveAsNewProfile()"',
            'onclick="onOverwriteActiveProfile()"',
            'onclick="onRenameActiveProfile()"',
            'onclick="onDuplicateActiveProfile()"',
            'onclick="onDeleteActiveProfile()"',
            'onchange="onProviderChange()"',
            'oninput="updateUrlPreview()"',
            'onchange="updateUrlPreview()"',
            'onclick="toggleKey()"',
            'onclick="onFetchModels()"',
            'oninput="setRetryMaxAttemptsLabel(this.value)"',
            'onclick="testConnection()"',
            'onclick="saveAndClose()"',
            'onclick="closeFileEditor()"',
            'onclick="copyFileEditorContent()"',
            'onclick="setFileEditorMarkdownPreview(',
            'onclick="setFileEditorCodePreview(',
            'onclick="reloadFileEditor()"',
            'onclick="openCurrentFileInMainPanel(',
            'onclick="saveFileEditor()"',
            'onclick="closePdfViewer()"',
            'onclick="reloadPdfViewer()"',
            'onclick="openPdfViewerInNewTab()"',
            'onclick="closeImageViewer()"',
            'onclick="reloadImageViewer()"',
            'onclick="openImageViewerInNewTab()"',
            'onclick="closeMediaViewer()"',
            'onclick="reloadMediaViewer()"',
            'onclick="openMediaViewerInNewTab()"',
            'onclick="closeRemoteConnection()"',
            'onclick="openRemoteDirPicker()"',
            'onclick="remoteDirGoHome()"',
            'onclick="remoteDirGoParent()"',
            'onclick="refreshRemoteDirPicker()"',
            'onclick="selectRemoteDirCurrent()"',
            'onclick="checkRemoteStatus()"',
            'onclick="saveRemoteConnectionFromUi()"',
            'onclick="disconnectRemoteAgent()"',
            'onclick="connectRemoteAgent()"',
            'onclick="closeFetchModelsModal()"',
            'oninput="filterFetchModels()"',
            'onclick="toggleSelectAllFetchModels()"',
            'onclick="confirmAddFetchedModels()"',
            'onclick="closeRemoteControlSettings()"',
            'onclick="saveAndCloseRemoteControlSettings()"',
            'onclick="closePlanSettings()"',
            "oninput=\"syncPlanSettingRange('",
            "oninput=\"syncPlanSettingInput('",
            "onclick=\"applyPlanPreset('",
            'onclick="resetPlanPrompts()"',
            'onclick="savePlanSettings()"',
            'onclick="closeOutlineSettings()"',
            'onclick="resetOutlinePrompt()"',
            'onclick="resetAllOutlinePrompts()"',
            'onclick="saveOutlineSettings()"',
            'onclick="closeReflectionSettings()"',
            "oninput=\"document.getElementById('ref",
            "onclick=\"applyPreset('",
            'onclick="saveReflectionSettings()"',
            'onclick="closeMcpSkillSettings()"',
            "onclick=\"switchMcpSkillTab('",
            'onclick="syncMcpTools()"',
            'onclick="saveMcpServer()"',
            'onclick="clearMcpServerForm()"',
            'onchange="saveSkillRootsFromUi()"',
            'onclick="scanSkills()"',
            'onclick="saveSkillRootsFromUi()"',
            'onclick="closeProjectInstructionsSettings()"',
            'onclick="saveProjectInstructionsSettingsFromUi()"',
            'onclick="initProjectInstructions(false)"',
            'onclick="generateProjectInstructionsDraft()"',
            'onclick="fillDefaultProjectInstructionsDraft()"',
            'onclick="saveProjectInstructionsFromUi()"',
            'onclick="clearLoadedProjectInstructions()"',
            'onclick="closeProjectMemorySettings()"',
            'onclick="saveProjectMemorySettingsFromUi()"',
            'onclick="initProjectMemory(true)"',
            'onclick="generateProjectMemoryDraft()"',
            'onclick="saveProjectMemoryFromUi()"',
            'onclick="clearLoadedProjectMemory()"',
            'onclick="closeTools()"',
            "onclick=\"addPresetTool('",
            'onclick="addCustomTool()"',
            'onclick="toggleLmsTools()"',
            'onclick="toggleGitTools()"',
            'onclick="togglePaperTools()"',
            'onclick="resetBuiltinTools()"',
            'onclick="clearAllTools()"',
            "onclick=\"document.getElementById('toolEditModal').classList.remove('show')\"",
            'onclick="saveToolEdit()"',
            'onclick="closeJsonEditor()"',
            "onclick=\"switchJsonTab('",
            'onclick="refreshJsonPreview()"',
            'onclick="copyJsonPreview()"',
            'onclick="copyJsonBodyOnly()"',
            'onclick="copyAsCurl()"',
            'onclick="refreshJsonResponse()"',
            'onclick="copyJsonResponse()"',
            'onclick="clearJsonResponses()"',
            'onclick="formatJsonTemplate()"',
            'onclick="resetJsonTemplate()"',
            'onclick="saveJsonTemplate()"',
            'onclick="setCodexUserAgentHeader()"',
            'onclick="refreshJsonHistory()"',
            'onclick="clearJsonHistory()"',
            'onclick="closeBackup()"',
            'onclick="exportConfig()"',
            'onclick="copyConfigToClipboard()"',
            'onchange="importFromFile(event)"',
            'onclick="resetAllData()"',
            'onclick="applyImport()"',
            'onclick="closePermissions()"',
            'onclick="onClearAllPerms()"',
            'onclick="onClearAllSecrets()"',
            'onclick="shellAuditConfirmReject(false)"',
            'onclick="shellAuditConfirmAccept()"',
            'onclick="termConfirmReject()"',
            'onclick="termConfirmRejectAll()"',
            'onclick="termConfirmAccept()"',
            'onclick="termConfirmAcceptAll()"',
            'onclick="this.classList.remove(\'show\')"',
            'onclick="closeDialogManager()"',
            'onclick="saveDialogManagerSettings()"',
            'onchange="setDialogExportChat(this.value)"',
            "onclick=\"exportDialogManagedChat('",
            'onclick="savePromptFromUi()"',
            'onclick="clearPromptEditor()"',
        ):
            self.assertNotIn(migrated_handler, html)

        for delegated_attr in (
            'data-action="newChat"',
            'data-action="onSend"',
            'data-action="toggleSidebar"',
            'data-action="togglePlan"',
            'data-action="toggleOutline"',
            'data-action="toggleTools"',
            'data-action="toggleTracePanel"',
            'data-action="openFilePicker"',
            'data-change-action="onPickFiles"',
            'data-input-action="renderTracePanel"',
            'data-action="openSettingsSection"',
            'data-action="toggleTheme"',
            'data-action="toggleCoolMode"',
            'data-action="toggleSecurityMode"',
            'data-action="closeSettingsPage"',
            'data-action="closeSettings"',
            'data-change-action="onApiProfileSelectChange"',
            'data-action="toggleApiProfileMenu"',
            'data-action="onSaveAsNewProfile"',
            'data-change-action="onProviderChange"',
            'data-input-action="updateUrlPreview"',
            'data-action="toggleKey"',
            'data-action="onFetchModels"',
            'data-input-action="setLabelFromValue"',
            'data-input-action="syncMaxToolRoundsRange"',
            'data-input-action="syncMaxToolRoundsInput"',
            'data-input-action="setRetryMaxAttemptsLabel"',
            'data-action="testConnection"',
            'data-action="saveAndClose"',
            'data-action="closeFileEditor"',
            'data-action="copyFileEditorContent"',
            'data-action="toggleFileEditorMarkdownPreview"',
            'data-action="toggleFileEditorCodePreview"',
            'data-action="openCurrentFileInMainPanel"',
            'data-kind="text"',
            'data-kind="pdf"',
            'data-action="closePdfViewer"',
            'data-action="closeImageViewer"',
            'data-action="closeMediaViewer"',
            'data-action="closeRemoteConnection"',
            'data-action="openRemoteDirPicker"',
            'data-action="connectRemoteAgent"',
            'data-action="closeFetchModelsModal"',
            'data-input-action="filterFetchModels"',
            'data-action="toggleSelectAllFetchModels"',
            'data-action="confirmAddFetchedModels"',
            'data-action="closeRemoteControlSettings"',
            'data-action="saveAndCloseRemoteControlSettings"',
            'data-action="closePlanSettings"',
            'data-input-action="syncPlanSettingRange"',
            'data-input-action="syncPlanSettingInput"',
            'data-action="applyPlanPreset"',
            'data-action="resetPlanPrompts"',
            'data-action="savePlanSettings"',
            'data-action="closeOutlineSettings"',
            'data-action="resetOutlinePrompt"',
            'data-action="resetAllOutlinePrompts"',
            'data-action="saveOutlineSettings"',
            'data-action="closeReflectionSettings"',
            'data-action="applyPreset"',
            'data-action="saveReflectionSettings"',
            'data-action="closeMcpSkillSettings"',
            'data-action="switchMcpSkillTab"',
            'data-action="syncMcpTools"',
            'data-action="saveMcpServer"',
            'data-action="clearMcpServerForm"',
            'data-change-action="saveSkillRootsFromUi"',
            'data-action="scanSkills"',
            'data-action="saveSkillRootsFromUi"',
            'data-action="closeProjectInstructionsSettings"',
            'data-action="saveProjectInstructionsSettingsFromUi"',
            'data-action="initProjectInstructions"',
            'data-action="generateProjectInstructionsDraft"',
            'data-action="fillDefaultProjectInstructionsDraft"',
            'data-action="saveProjectInstructionsFromUi"',
            'data-action="clearLoadedProjectInstructions"',
            'data-action="closeProjectMemorySettings"',
            'data-action="saveProjectMemorySettingsFromUi"',
            'data-action="initProjectMemory"',
            'data-action="generateProjectMemoryDraft"',
            'data-action="saveProjectMemoryFromUi"',
            'data-action="clearLoadedProjectMemory"',
            'data-action="closeTools"',
            'data-action="addPresetTool"',
            'data-action="addCustomTool"',
            'data-action="toggleLmsTools"',
            'data-action="toggleGitTools"',
            'data-action="togglePaperTools"',
            'data-action="resetBuiltinTools"',
            'data-action="clearAllTools"',
            'data-action="hideModal"',
            'data-target="toolEditModal"',
            'data-action="saveToolEdit"',
            'data-action="closeJsonEditor"',
            'data-action="switchJsonTab"',
            'data-action="refreshJsonPreview"',
            'data-action="copyJsonPreview"',
            'data-action="copyJsonBodyOnly"',
            'data-action="copyAsCurl"',
            'data-action="refreshJsonResponse"',
            'data-action="copyJsonResponse"',
            'data-action="clearJsonResponses"',
            'data-action="formatJsonTemplate"',
            'data-action="resetJsonTemplate"',
            'data-action="saveJsonTemplate"',
            'data-action="setCodexUserAgentHeader"',
            'data-action="refreshJsonHistory"',
            'data-action="clearJsonHistory"',
            'data-action="closeBackup"',
            'data-action="exportConfig"',
            'data-action="copyConfigToClipboard"',
            'data-change-action="importFromFile"',
            'data-action="resetAllData"',
            'data-action="applyImport"',
            'data-action="closePermissions"',
            'data-action="onClearAllPerms"',
            'data-action="onClearAllSecrets"',
            'data-action="shellAuditConfirmReject"',
            'data-action="shellAuditConfirmAccept"',
            'data-action="termConfirmReject"',
            'data-action="termConfirmRejectAll"',
            'data-action="termConfirmAccept"',
            'data-action="termConfirmAcceptAll"',
            'data-action="hideSelf"',
            'data-action="closeDialogManager"',
            'data-action="saveDialogManagerSettings"',
            'data-change-action="setDialogExportChat"',
            'data-action="exportDialogManagedChat"',
            'data-action="savePromptFromUi"',
            'data-action="clearPromptEditor"',
        ):
            self.assertIn(delegated_attr, html)

    def test_orchestration_consumers_use_service(self):
        consumers = {
            'api-core.js': 'ApiCoreOrchestrationService',
            'chat.js': 'ChatOrchestrationService',
            'scheduled-tasks.js': 'ScheduledTasksOrchestrationService',
            'task-queue.js': 'TaskQueueOrchestrationService',
            'remote-control.js': 'RemoteControlOrchestrationService',
            'terminal.js': 'TerminalOrchestrationService',
            'outline-render.js': 'OutlineRenderOrchestrationService',
            'ppt-mode.js': 'PptModeOrchestrationService',
            'debate-mode.js': 'DebateOrchestrationService',
            'plan-core.js': 'PlanCoreOrchestrationService',
            'outline-core.js': 'OutlineCoreOrchestrationService',
        }

        for filename, service_name in consumers.items():
            js = (ROOT / 'js' / filename).read_text(encoding='utf-8')
            self.assertIn("window.AgentApp.require('orchestrationService')", js)
            self.assertIn(service_name, js)
            forbidden_calls = [
                'await callAPI(',
                'await callAPIWithPlan(',
                'await callAPIWithOutline(',
                'await callAPIWithPptMode(',
                'await callAPIWithReflection(',
                'await callOnceWithRole(',
                'await executeTool(',
            ]
            if filename == 'outline-core.js':
                forbidden_calls.remove('await callAPIWithOutline(')
            for direct_call in forbidden_calls:
                self.assertNotIn(direct_call, js)

    def test_direct_orchestration_calls_stay_in_orchestration_implementation_modules(self):
        allowed_implementation_files = {
            'api-core.js',
            'orchestration-service.js',
            'outline-core.js',
            'plan-core.js',
            'ppt-mode.js',
            'reflection.js',
            'tools.js',
        }
        direct_orchestration_pattern = (
            r'(?<![.$\w])'
            r'(executeTool|callAPI|callAPIWithPlan|callAPIWithOutline|callAPIWithPptMode|callAPIWithReflection)'
            r'\s*\('
        )

        for path in (ROOT / 'js').glob('*.js'):
            if path.name in allowed_implementation_files:
                continue
            js = path.read_text(encoding='utf-8')
            self.assertNotRegex(js, direct_orchestration_pattern, f'{path.name} should route orchestration through orchestrationService')

    def test_task_queue_dynamic_controls_use_event_delegation(self):
        task_queue_js = (ROOT / 'js' / 'task-queue.js').read_text(encoding='utf-8')

        for migrated_handler in (
            'onclick="closeTaskQueue()"',
            'onchange="taskQueueSaveDefaults()"',
            'onclick="taskQueueAddTasks()"',
            'onclick="taskQueueAutoSchedule()"',
            'onclick="startTaskQueue()"',
            'onclick="taskQueueTogglePauseAll()"',
            'onclick="taskQueueStopAll()"',
            'onclick="openTaskQueueTree()"',
            'onclick="taskQueueClearSettled()"',
            'onclick="taskQueueClearAll()"',
            'onclick="closeTaskQueueTree()"',
            'onclick="renderTaskQueueTree()"',
            'onclick="taskQueueOpenChat(',
            'onclick="taskQueueRetryItem(',
            'onclick="taskQueueRemoveItem(',
            'onchange="taskQueueUpdateItemOrder(',
            'onchange="taskQueueUpdateItemExpose(',
            'oninput="taskQueueUpdateItemText(',
            'onchange="taskQueueUpdateItemMode(',
            'onchange="taskQueueUpdateItemTools(',
            'onchange="taskQueueUpdateItemDepends(',
            'onclick="taskQueuePauseItem(',
            'onclick="taskQueueStopItem(',
            'onclick="taskQueueSkipItem(',
        ):
            self.assertNotIn(migrated_handler, task_queue_js)

        for delegated_attr in (
            'data-action="closeTaskQueue"',
            'data-change-action="taskQueueSaveDefaults"',
            'data-action="taskQueueAddTasks"',
            'data-action="taskQueueAutoSchedule"',
            'data-action="startTaskQueue"',
            'data-action="taskQueueTogglePauseAll"',
            'data-action="taskQueueStopAll"',
            'data-action="openTaskQueueTree"',
            'data-action="taskQueueClearSettled"',
            'data-action="taskQueueClearAll"',
            'data-action="closeTaskQueueTree"',
            'data-action="renderTaskQueueTree"',
            'data-action="taskQueueOpenChat"',
            'data-action="taskQueueRetryItem"',
            'data-action="taskQueueRemoveItem"',
            'data-change-action="taskQueueUpdateItemOrder"',
            'data-change-action="taskQueueUpdateItemExpose"',
            'data-input-action="taskQueueUpdateItemText"',
            'data-change-action="taskQueueUpdateItemMode"',
            'data-change-action="taskQueueUpdateItemTools"',
            'data-change-action="taskQueueUpdateItemDepends"',
            'data-action="taskQueuePauseItem"',
            'data-action="taskQueueStopItem"',
            'data-action="taskQueueSkipItem"',
            'data-task-id="${escapeHtml(item.id)}"',
        ):
            self.assertIn(delegated_attr, task_queue_js)

    def test_main_html_and_lms_panel_use_event_delegation(self):
        html = next(ROOT.glob('AI-Chat-*.html')).read_text(encoding='utf-8')
        lms_panel_js = (ROOT / 'js' / 'lms_panel.js').read_text(encoding='utf-8')

        for source in (html, lms_panel_js):
            for inline_attr in (
                'onclick=',
                'onchange=',
                'oninput=',
                'onkeydown=',
                'onkeyup=',
                'onmousedown=',
                'onmouseup=',
            ):
                self.assertNotIn(inline_attr, source)

        for delegated_attr in (
            'data-action="closeLmsPanel"',
            'data-action="valueClick"',
            'data-handler="lmsPanelSetTab"',
            'data-handler="useSuggestion"',
            'data-action="lmsPanelLoginWithPassword"',
            'data-keydown-action="enterGlobal"',
            'data-input-action="lmsPanelCookieParse"',
            'data-action="lmsPanelCloseModal"',
        ):
            self.assertIn(delegated_attr, html)

        for delegated_attr in (
            'data-handler="lmsPanelOpenCookieEditor"',
            'data-handler="lmsPanelSetPage"',
            'data-change-action="valueChange"',
            'data-input-action="valueInput"',
            'data-action="lmsPanelFetchScores"',
            'data-action="lmsPanelFetchAttendance"',
            'data-handler="lmsPanelDownload"',
            'data-extra-value="${nameForAttr}"',
        ):
            self.assertIn(delegated_attr, lms_panel_js)

    def test_git_panel_uses_event_delegation(self):
        git_panel_js = (ROOT / 'js' / 'git-panel.js').read_text(encoding='utf-8')

        for inline_attr in (
            'onclick=',
            'onchange=',
            'oninput=',
            'onblur=',
            'onkeydown=',
            'onkeyup=',
        ):
            self.assertNotIn(inline_attr, git_panel_js)

        for delegated_attr in (
            'data-action="_toggleBranchMenu"',
            'data-action="_openRemotePanel"',
            'data-action="closeGitPanel"',
            'data-action="_showGitConfigInline"',
            'data-action="_undoLastReset"',
            'data-action="_toggleReflogPanel"',
            'data-action="_onCommitAndPush"',
            'data-action="_onCommit"',
            'data-action="_doInit"',
            'data-action="_unstageAll"',
            'data-action="_stageAll"',
            'data-action="_stageUntracked"',
            'data-action="valueClick"',
            'data-handler="_selectFile"',
            'data-handler="_stageOne"',
            'data-handler="_unstageOne"',
            'data-handler="_checkoutOne"',
            'data-handler="_selectCommit"',
            'data-handler="_restoreReflogHash"',
            'data-handler="_doRevert"',
            'data-handler="_doResetMixed"',
            'data-handler="_doResetHard"',
            'data-action="hideTarget"',
            'data-action="_doBranchCreate"',
            'data-action="_doBranchRename"',
            'data-action="removeTarget"',
            'data-action="_savePanelUser"',
            'data-action="_addRemote"',
            'data-change-action="updateGitProxyPreview"',
            'data-input-action="updateGitProxyPreview"',
            'data-input-action="valueInputTarget"',
            'data-input-handler="_onRemoteTargetBranchInput"',
            'data-blur-action="valueBlurTarget"',
            'data-blur-handler="_normalizeRemoteTargetBranchInput"',
            'data-handler="_doPush"',
            'data-value-type="boolean"',
            'data-action="_doPull"',
            'data-action="_doFetch"',
            'data-action="_showCredHelp"',
            'data-action="removeClosest"',
            'data-stop-propagation="true"',
        ):
            self.assertIn(delegated_attr, git_panel_js)

    def test_music_player_uses_event_delegation(self):
        music_player_js = (ROOT / 'js' / 'music-player.js').read_text(encoding='utf-8')

        for inline_attr in (
            'onclick=',
            'onchange=',
            'oninput=',
            'onblur=',
            'onkeydown=',
            'onkeyup=',
        ):
            self.assertNotIn(inline_attr, music_player_js)
        self.assertNotIn('select[onchange="musicSetCompletionMode(this.value)"]', music_player_js)

        for delegated_attr in (
            'data-action="closeMusicPlayer"',
            'data-action="musicPrevTrack"',
            'data-action="musicTogglePlay"',
            'data-action="musicNextTrack"',
            'data-handler="refreshMusicLibrary"',
            'data-change-action="musicImportFiles"',
            'data-change-action="musicOpenLocalFiles"',
            'data-action="openFilePicker"',
            'data-target="musicImportInput"',
            'data-input-action="valueInput"',
            'data-handler="musicSetVolume"',
            'data-change-action="valueChange"',
            'data-handler="musicSetPlaybackRate"',
            'data-handler="musicSetLoopMode"',
            'data-handler="musicSetShuffle"',
            'data-handler="musicSetMuted"',
            'data-handler="musicSetCompletionEnabled"',
            'id="musicCompletionModeSelect"',
            'data-handler="musicSetCompletionMode"',
            'data-handler="musicSetCompletionTrack"',
            'data-handler="musicSetGenerationBgmEnabled"',
            'data-handler="musicSetGenerationBgmTrack"',
            'data-handler="musicSetGenerationBgmVolume"',
            'data-handler="musicSetGenerationBgmLoop"',
            'data-action="musicPreviewCompletionSound"',
            'data-action="musicPreviewGenerationBgm"',
            'data-handler="musicSetTrackSearch"',
            'data-action="musicToggleTrackList"',
            'data-handler="musicPlayIndex"',
            'document.getElementById(\'musicCompletionModeSelect\')',
        ):
            self.assertIn(delegated_attr, music_player_js)

    def test_rate_limiter_uses_event_delegation(self):
        rate_limiter_js = (ROOT / 'js' / 'rate-limiter.js').read_text(encoding='utf-8')

        for inline_attr in (
            'onclick=',
            'onchange=',
            'oninput=',
            'onblur=',
            'onkeydown=',
            'onkeyup=',
        ):
            self.assertNotIn(inline_attr, rate_limiter_js)

        for delegated_attr in (
            'data-action="toggleRatePause"',
            'data-action="openRateSettings"',
            'data-action="closeRateSettings"',
            'data-input-action="setLabelFromValue"',
            'data-label-target="rateMaxPerMinVal"',
            'data-label-target="rateMinIntervalVal"',
            'data-label-target="rateRandomMinVal"',
            'data-label-target="rateRandomMaxVal"',
            'data-suffix="ms"',
            'data-action="valueClick"',
            'data-handler="applyRatePreset"',
            'data-value="humanlike"',
            'data-action="resetRateStats"',
            'data-action="saveRateSettings"',
        ):
            self.assertIn(delegated_attr, rate_limiter_js)

    def test_plan_ui_uses_event_delegation(self):
        plan_ui_js = (ROOT / 'js' / 'plan-ui.js').read_text(encoding='utf-8')

        for inline_attr in (
            'onclick=',
            'onchange=',
            'oninput=',
            'onblur=',
            'onkeydown=',
            'onkeyup=',
        ):
            self.assertNotIn(inline_attr, plan_ui_js)

        for delegated_attr in (
            'data-action="valueClick"',
            'data-handler="editPlanStep"',
            'data-handler="retryPlanStep"',
            'data-handler="skipPlanStep"',
            'data-handler="markPlanStepDone"',
            'data-handler="deletePlanStep"',
            'data-handler="approveAndExecutePlan"',
            'data-handler="regeneratePlan"',
            'data-handler="cancelPlan"',
            'data-handler="continuePlanImprovement"',
            'data-handler="acceptPlanWithFailedVerification"',
            'data-handler="togglePlanPanel"',
            'data-stop-propagation="true"',
            'data-extra-value="${si}"',
        ):
            self.assertIn(delegated_attr, plan_ui_js)

    def test_debate_mode_uses_event_delegation(self):
        debate_mode_js = (ROOT / 'js' / 'debate-mode.js').read_text(encoding='utf-8')

        for inline_attr in (
            'onclick=',
            'onchange=',
            'oninput=',
            'onblur=',
            'onkeydown=',
            'onkeyup=',
        ):
            self.assertNotIn(inline_attr, debate_mode_js)

        for delegated_attr in (
            'data-input-action="valueInput"',
            'data-handler="debateTimeoutSliderChanged"',
            'data-handler="debateTimeoutInputChanged"',
            'data-change-action="valueChange"',
            'data-handler="debateProfileChanged"',
            'data-action="closeDebateMode"',
            'data-action="startDebateFromUi"',
            'data-action="stopCurrentDebate"',
            'data-action="continueCurrentDebate"',
            'data-handler="openDebateChat"',
            'data-handler="continueDebate"',
            'data-handler="requestStopDebate"',
            'data-handler="debateManualPass"',
            'data-handler="debateManualWin"',
            'data-extra-value="pro"',
            'data-extra-value="con"',
            'data-handler="copyMsg"',
            'data-value-type="number"',
        ):
            self.assertIn(delegated_attr, debate_mode_js)

    def test_dialog_manager_click_controls_use_event_delegation(self):
        dialog_manager_js = (ROOT / 'js' / 'dialog-manager.js').read_text(encoding='utf-8')

        for inline_attr in (
            'onclick=',
            'onchange=',
            'oninput=',
            'onblur=',
            'onkeydown=',
            'onkeyup=',
            'oncontextmenu=',
            'ondragstart=',
            'ondragend=',
            'ondragover=',
            'ondragleave=',
            'ondrop=',
        ):
            self.assertNotIn(inline_attr, dialog_manager_js)

        for delegated_attr in (
            'data-handler="jumpToDialogMessage"',
            'data-handler="renameTimelineNode"',
            'data-stop-propagation="true"',
            'data-action="dialogExplorerGoUp"',
            'data-handler="dialogExplorerEnterFolder"',
            'data-change-action="valueChange"',
            'data-handler="dialogExplorerToggleSort"',
            'data-handler="dialogExplorerToggleView"',
            'data-value="icons"',
            'data-value="list"',
            'data-handler="switchDialogManagerChat"',
            'data-handler="applyPromptToChat"',
            'data-handler="editPrompt"',
            'data-handler="deletePrompt"',
            'data-contextmenu-action="dialogExplorerContextMenu"',
            'data-contextmenu-value="chat"',
            'data-dragstart-action="dialogExplorerDragStart"',
            'data-dragstart-value="folder"',
            'data-dragover-action="dialogExplorerItemDragOver"',
            'data-dragleave-action="dialogExplorerItemDragLeave"',
            'data-drop-action="dialogExplorerItemDrop"',
            'data-drop-value="${escapeHtml(folder.id)}"',
        ):
            self.assertIn(delegated_attr, dialog_manager_js)

    def test_outline_render_uses_event_delegation(self):
        outline_render_js = (ROOT / 'js' / 'outline-render.js').read_text(encoding='utf-8')

        self.assertIn("window.AgentApp.require('uiService')", outline_render_js)
        self.assertIn('OutlineRenderUiService.toast', outline_render_js)
        self.assertIn('outlineRenderRefreshMessage', outline_render_js)
        for inline_attr in (
            'onclick=',
            'onchange=',
            'oninput=',
            'onblur=',
            'onkeydown=',
            'onkeyup=',
        ):
            self.assertNotIn(inline_attr, outline_render_js)

        for delegated_attr in (
            'data-handler="finishOutlineNow"',
            'data-handler="resumeOutline"',
            'data-handler="cancelOutline"',
            'data-handler="toggleOutlinePanel"',
            'data-handler="redoOutlineCheckpoint"',
            'data-handler="restoreOutlineCheckpoint"',
            'data-handler="toggleOutlineDiffSummary"',
            'data-value-type="number"',
        ):
            self.assertIn(delegated_attr, outline_render_js)

    def test_concurrent_requests_uses_event_delegation(self):
        concurrent_requests_js = (ROOT / 'js' / 'concurrent-requests.js').read_text(encoding='utf-8')

        for inline_attr in (
            'onclick=',
            'onchange=',
            'oninput=',
            'onblur=',
            'onkeydown=',
            'onkeyup=',
        ):
            self.assertNotIn(inline_attr, concurrent_requests_js)

        for delegated_attr in (
            'data-action="closeConcurrentRequests"',
            'data-change-action="concurrentSelectTargetChanged"',
            'data-action="startConcurrentRequestFromUi"',
            'data-action="stopSelectedConcurrentRequest"',
            'data-action="stopAllConcurrentRequests"',
            'data-handler="openConcurrentChat"',
            'data-handler="chooseConcurrentChat"',
            'data-handler="requestStopConcurrentChat"',
            'data-action="toggleParentCollapsed"',
        ):
            self.assertIn(delegated_attr, concurrent_requests_js)

    def test_token_usage_uses_event_delegation(self):
        token_usage_js = (ROOT / 'js' / 'token-usage.js').read_text(encoding='utf-8')

        for inline_attr in (
            'onclick=',
            'onchange=',
            'oninput=',
            'onblur=',
            'onkeydown=',
            'onkeyup=',
        ):
            self.assertNotIn(inline_attr, token_usage_js)

        for delegated_attr in (
            'data-action="closeTokenUsageStats"',
            'data-action="renderTokenUsageStats"',
            'data-action="resetTokenUsageLedger"',
            'data-change-action="tokenUsageDateChange"',
            'data-change-action="tokenUsageRangeChange"',
            'data-field="start"',
            'data-field="end"',
            'data-handler="setTokenUsageQuickRange"',
            'data-value="today"',
            'data-value="7d"',
            'data-value="30d"',
            'data-value="all"',
        ):
            self.assertIn(delegated_attr, token_usage_js)

    def test_ppt_mode_uses_event_delegation(self):
        ppt_mode_js = (ROOT / 'js' / 'ppt-mode.js').read_text(encoding='utf-8')

        self.assertIn("window.AgentApp.require('uiService')", ppt_mode_js)
        self.assertIn('PptModeUiService.toast', ppt_mode_js)
        self.assertIn('pptModeRefreshMessage', ppt_mode_js)
        for inline_attr in (
            'onclick=',
            'onchange=',
            'oninput=',
            'onblur=',
            'onkeydown=',
            'onkeyup=',
            'onpaste=',
            'ondragover=',
            'ondrop=',
        ):
            self.assertNotIn(inline_attr, ppt_mode_js)

        for delegated_attr in (
            'data-action="closePptSettings"',
            'data-action="resetPptPromptsToDefault"',
            'data-action="savePptSettings"',
            'data-input-action="setLabelFromValue"',
            'data-label-target="pptTemperatureVal"',
            'data-paste-action="handlePptGuidancePaste"',
            'data-dragover-action="handlePptGuidanceDragOver"',
            'data-drop-action="handlePptGuidanceDrop"',
            'data-handler="resumePptTaskFromPanel"',
            'data-handler="pausePptTaskFromPanel"',
            'data-handler="cancelPptTaskFromPanel"',
            'data-handler="togglePptPanel"',
            'data-value-type="number"',
            'data-extra-value="true"',
            'data-extra-type="boolean"',
        ):
            self.assertIn(delegated_attr, ppt_mode_js)

    def test_chat_message_controls_use_event_delegation(self):
        chat_js = (ROOT / 'js' / 'chat.js').read_text(encoding='utf-8')

        for inline_attr in (
            'onclick=',
            'onchange=',
            'oninput=',
            'onblur=',
            'onkeydown=',
            'onkeyup=',
        ):
            self.assertNotIn(inline_attr, chat_js)

        for delegated_attr in (
            'data-handler="copyMsg"',
            'data-handler="editResendUserMsg"',
            'data-handler="undoCompressionSnapshot"',
            'data-action="toggleParentCollapsed"',
            'data-handler="showImagePreview"',
            'data-handler="toggleReflectionPanel"',
            'data-handler="regenerate"',
            'data-handler="deleteMessageTurn"',
            'data-handler="removeAttachment"',
            'data-value-type="number"',
        ):
            self.assertIn(delegated_attr, chat_js)

    def test_ui_side_effect_consumers_use_service(self):
        consumers = {
            'api-core.js': 'ApiCoreUiService',
            'state.js': 'StateUiService',
            'api-profiles.js': 'ApiProfilesUiService',
            'tokens.js': 'TokensUiService',
            'reflection.js': 'ReflectionUiService',
            'outline-render.js': 'OutlineRenderUiService',
            'ppt-mode.js': 'PptModeUiService',
            'permissions.js': 'PermissionsUiService',
            'markdown.js': 'MarkdownUiService',
            'mcp-skills.js': 'McpSkillsUiService',
            'json-editor.js': 'JsonEditorUiService',
            'plan-ui.js': 'PlanUiUiService',
            'theme.js': 'ThemeUiService',
            'project-instructions.js': 'ProjectInstructionsUiService',
            'project-memory.js': 'ProjectMemoryUiService',
            'settings.js': 'SettingsUiService',
            'main.js': 'MainUiService',
            'tools.js': 'ToolsUiService',
            'backup.js': 'BackupUiService',
            'privacy-guard.js': 'PrivacyGuardUiService',
            'music-player.js': 'MusicUiService',
            'remote-connection.js': 'RemoteConnectionUiService',
            'terminal.js': 'TerminalUiService',
            'file-explorer.js': 'FileExplorerUiService',
            'terminal-launcher.js': 'TerminalLauncherUiService',
            'git-panel.js': 'GitPanelUiService',
            'dialog-manager.js': 'DialogManagerUiService',
            'lms_panel.js': 'LmsPanelUiService',
            'pricing.js': 'PricingUiService',
            'security-records.js': 'SecurityRecordsUiService',
            'concurrent-requests.js': 'ConcurrentRequestsUiService',
            'rate-limiter.js': 'RateLimiterUiService',
            'token-usage.js': 'TokenUsageUiService',
            'trace.js': 'TraceUiService',
            'shell-audit.js': 'ShellAuditUiService',
            'beacon.js': 'BeaconUiService',
            'remote-control.js': 'RemoteControlUiService',
            'debate-mode.js': 'DebateUiService',
            'scheduled-tasks.js': 'ScheduledTasksUiService',
            'task-queue.js': 'TaskQueueUiService',
            'plan-core.js': 'PlanCoreUiService',
            'outline-core.js': 'OutlineCoreUiService',
        }

        for filename, service_name in consumers.items():
            js = (ROOT / 'js' / filename).read_text(encoding='utf-8')
            self.assertIn("window.AgentApp.require('uiService')", js)
            self.assertIn(service_name, js)
            for direct_usage in (
                'typeof toast',
                'typeof renderMessages',
                'typeof refreshMsgNode',
                'typeof updateMsgContentNode',
                'typeof renderChatList',
                'typeof updateSendBtn',
            ):
                self.assertNotIn(direct_usage, js)
            self.assertNotRegex(
                js,
                r'(?<![.$\w])(toast|renderMessages|refreshMsgNode|updateMsgContentNode|renderChatList|updateSendBtn)\s*\('
            )

    def test_direct_ui_side_effect_calls_stay_in_ui_implementation_modules(self):
        allowed_implementation_files = {
            'api-stream.js',
            'chat.js',
            'ui-service.js',
            'utils.js',
        }
        direct_call_pattern = r'(?<![.$\w])(toast|renderMessages|refreshMsgNode|updateMsgContentNode|renderChatList|updateSendBtn)\s*\('
        direct_typeof_checks = (
            'typeof toast',
            'typeof renderMessages',
            'typeof refreshMsgNode',
            'typeof updateMsgContentNode',
            'typeof renderChatList',
            'typeof updateSendBtn',
        )

        for path in (ROOT / 'js').glob('*.js'):
            if path.name in allowed_implementation_files:
                continue
            js = path.read_text(encoding='utf-8')
            self.assertNotRegex(js, direct_call_pattern, f'{path.name} should route UI side effects through uiService')
            for direct_usage in direct_typeof_checks:
                self.assertNotIn(direct_usage, js, f'{path.name} should not probe UI globals directly')

    def test_web_tools_share_proxy_settings(self):
        config_js = (ROOT / 'js' / 'config.js').read_text(encoding='utf-8')
        terminal_js = (ROOT / 'js' / 'terminal.js').read_text(encoding='utf-8')

        self.assertRegex(config_js, r"name: 'web_search'[\s\S]+proxy_enabled[\s\S]+proxy_url")
        self.assertRegex(config_js, r"name: 'fetch_url'[\s\S]+proxy_enabled[\s\S]+proxy_url")
        self.assertIn("code: 'return await webSearch(args.query, args.max_results, args.region, args);'", config_js)
        self.assertIn("code: 'return await fetchUrl(args.url, args.extract_text, args.max_chars, args);'", config_js)

        self.assertRegex(terminal_js, r"async function webSearch[\s\S]+proxy_enabled: proxyEnabled[\s\S]+proxy_url: proxyUrl")
        self.assertRegex(terminal_js, r"async function fetchUrl[\s\S]+proxy_enabled: proxyEnabled[\s\S]+proxy_url: proxyUrl")

    def test_execute_action_exposes_timeout_parameter(self):
        config_js = (ROOT / 'js' / 'config.js').read_text(encoding='utf-8')
        terminal_js = (ROOT / 'js' / 'terminal.js').read_text(encoding='utf-8')
        state_js = (ROOT / 'js' / 'state.js').read_text(encoding='utf-8')

        self.assertRegex(config_js, r"name: 'execute_action'[\s\S]+timeout: \{ type: 'number'")
        self.assertIn("code: 'return await executeTerminalCommand(args.command, args.cwd, args.new_window, args.timeout);'", config_js)
        self.assertIn('function normalizeExecuteTimeoutSec(timeout)', terminal_js)
        self.assertIn("timeout: timeoutSec", terminal_js)
        self.assertIn("const BUILTIN_TOOL_REFRESH_NAMES = new Set(['execute_action']);", state_js)

    def test_file_explorer_delete_uses_recursive_directory_delete(self):
        file_explorer_js = (ROOT / 'js' / 'file-explorer.js').read_text(encoding='utf-8')

        self.assertIn(
            "callAgentBackend('delete_file', { path: normalizedPath, recursive: true }, { skipConfirm: true })",
            file_explorer_js
        )


if __name__ == '__main__':
    unittest.main()
