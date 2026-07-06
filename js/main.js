// ============ 鍒濆鍖栧叆鍙?============

const MainStateModule = window.AgentApp.require('state');
const MainUiService = window.AgentApp.require('uiService');
const mainStateRef = MainStateModule.state;
const mainLoadDataFromState = MainStateModule.loadData;
const mainSaveDataFromState = MainStateModule.saveData;

function mainState() {
  return mainStateRef;
}

function mainLoadData() {
  return mainLoadDataFromState();
}

function mainSaveData() {
  return mainSaveDataFromState();
}

async function init() {
  // 猸?0. 鍏堟妸 IndexedDB 鐏屽叆鍐呭瓨缂撳瓨锛堝惈 localStorage 鏃ф暟鎹嚜鍔ㄨ縼绉伙級
  //    鎵€鏈夊悗缁?storage.get/set 閮芥槸鍚屾璧板唴瀛橈紝浣嗗繀椤荤瓑杩欐寮傛鍔犺浇瀹屾垚
  if (typeof idbInit === 'function') {
    try { await idbInit(); }
    catch (e) { console.error('[init] idbInit 澶辫触锛屽皢缁х画浣跨敤 localStorage 鍏滃簳', e); }
  }

  // 猸?0.1 trace.js 鍦ㄦā鍧楀姞杞芥椂宸?loadTraces() 杩囦竴娆★紙閭ｆ椂 IDB 杩樻病灏辩华锛夛紝
  //       杩欓噷 IDB 灏辩华鍚庡啀 load 涓€娆★紝纭繚鎷垮埌 IndexedDB 閲岀殑鐪熷疄鏁版嵁
  if (typeof loadTraces === 'function') {
    try { loadTraces(); } catch (e) {}
  }

  // 猸?0.2 terminal.js 鍦ㄦā鍧楀姞杞芥椂宸茶杩?token/perms锛堝悓鏍峰湪 IDB 灏辩华鍓嶏級锛?
  //       杩欓噷 IDB 灏辩华鍚庡己鍒跺埛涓€閬?
  if (typeof TERMINAL_CONFIG !== 'undefined' && typeof storage !== 'undefined') {
    try {
      const permsRaw = storage.get('aichat_terminal_perms_v1');
      if (permsRaw) {
        try { TERMINAL_CONFIG.permanentAllow = JSON.parse(permsRaw) || {}; } catch (e) {}
      }
    } catch (e) {}
  }

  // 1. 鍔犺浇鏈湴鏁版嵁
  mainLoadData();
  const recoveredTimers = (typeof recoverInterruptedMsgTimers === 'function') ? recoverInterruptedMsgTimers() : false;
  const recoveredConcurrent = (typeof recoverInterruptedConcurrentRequests === 'function') ? recoverInterruptedConcurrentRequests() : false;
  const recoveredDebates = (typeof recoverInterruptedDebates === 'function') ? recoverInterruptedDebates() : false;
  if (typeof registerMsgTimerExitRecovery === 'function') registerMsgTimerExitRecovery();
  if (recoveredTimers || recoveredConcurrent || recoveredDebates) mainSaveData();
  if (typeof loadTaskQueue === 'function') {
    loadTaskQueue();
  }
  if (typeof loadGoals === 'function') {
    loadGoals();
  }
  
  // 2. 搴旂敤涓婚
  applyTheme();
  
  // 3. 鍒锋柊妯″瀷涓嬫媺妗?
  refreshModelSelect();
  
  // 4. 娓叉煋鑱婂ぉ鍒楄〃鍜屾秷鎭?
  MainUiService.renderChatList();
  MainUiService.renderMessages();
  if (typeof initDialogManager === 'function') initDialogManager();
  
  // 5. 鎭㈠鍚勬寜閽殑婵€娲荤姸鎬?
  const appState = mainState();
  if (appState.settings.useTools) {
    const btn = document.getElementById('toolsBtn');
    if (btn) btn.classList.add('tool-active');
  }
  if (appState.settings.useReflection) {
    const btn = document.getElementById('reflectBtn');
    if (btn) btn.classList.add('reflect-active');
  }
  if (appState.settings.usePlan) {
    const btn = document.getElementById('planBtn');
    if (btn) btn.classList.add('plan-active');
  }
  if (appState.settings.useOutline) {
    const btn = document.getElementById('outlineBtn');
    if (btn) btn.classList.add('outline-active');
  }
  if (appState.settings.usePpt) {
    const btn = document.getElementById('pptModeBtn');
    if (btn) btn.classList.add('ppt-active');
    if (typeof syncPptToolsWithMode === 'function') syncPptToolsWithMode(true, { render: false });
  }
  if (typeof updatePrivacyGuardButton === 'function') updatePrivacyGuardButton();
  if (typeof initScheduledSend === 'function') initScheduledSend();
  if (typeof initRemoteControl === 'function') {
    try { initRemoteControl(); } catch (e) { console.warn('[remote-control] init failed:', e); }
  }
  if (typeof initRemoteConnection === 'function') {
    try {
      const remoteInit = initRemoteConnection();
      if (remoteInit && typeof remoteInit.catch === 'function') {
        remoteInit.catch(e => console.warn('[remote] init failed:', e));
      }
    } catch (e) {
      console.warn('[remote] init failed:', e);
    }
  }
  
  // 6. 鏇存柊搴曢儴鐘舵€佷俊鎭?
  MainUiService.updateSendBtn();
  
  // 7. 鏇存柊 URL 棰勮
  updateTopUrlPreview();
  
  // 猸?7.5 鍚姩鏃舵娴嬫矙绠辩洰褰曪紝骞舵瘡 30s 蹇冭烦涓€娆?
  if (typeof refreshWorkspaceInfo === 'function') {
    refreshWorkspaceInfo();
    setInterval(refreshWorkspaceInfo, 30000);
  }

  // 7.6 鎭㈠ Token / 璇锋眰閫熷害缁熻鏍忔敹璧风姸鎬?
  if (typeof initStatsBarToggle === 'function') initStatsBarToggle();
  
  // 猸?7.5.1 鏈湴浠ｇ悊鑷锛氬弻鍑?HTML 鎵撳紑锛坒ile://锛夋椂锛屾祻瑙堝櫒瀵?https 璺ㄥ煙鍑犱箮蹇呮
  //         鈫?鍚姩鏃朵富鍔ㄦ祴涓€涓嬶細鈶?鏈湴鏈嶅姟鍦ㄤ笉鍦紵鈶?鏈夋病鏈?token锛熲憿 浠ｇ悊寮€鍏虫湁娌℃湁寮€锛?
  //         涓夋牱榻愬叏鎵嶈兘淇濊瘉 fetch 鐪熺殑涓嶄細鎾?CORS銆備换浣曚竴椤圭己澶遍兘鐩存帴甯敤鎴疯ˉ涓娿€?
  (async function autoSetupLocalProxy() {
    try {
      const tc = (typeof TERMINAL_CONFIG !== 'undefined') ? TERMINAL_CONFIG : null;
      if (!tc || !tc.serverUrl) return;
      // 鈶?鏈嶅姟鍦ㄤ笉鍦?
      let serverAlive = false;
      try {
        const r = await fetch(tc.serverUrl + '/workspace', { method: 'GET' });
        serverAlive = r.ok;
      } catch (e) { serverAlive = false; }
      if (!serverAlive) {
        console.warn('[self-check] Local service is not running; LLM CORS fallback will be unavailable.');
        MainUiService.toast('本地服务未启动，遇到 CORS 时无法绕过\n请运行 python local_terminal_server.py', 5000);
        return;
      }
      // 鈶?浠ｇ悊寮€鍏抽粯璁ゅ紑鍚紙state.js 閲岄粯璁ゅ氨鏄?true锛屼絾鐢ㄦ埛鍙兘鎵嬪姩鍏宠繃 鈫?涓嶅己鏀癸級
      if (mainState().settings.useLocalProxy) {
        console.log('[self-check] Local proxy is ready');
      } else if (!mainState().settings.useLocalProxy) {
        console.log('[self-check] Local proxy is disabled in settings');
      } else if (!tc.token) {
        console.warn('[self-check] Local proxy is enabled but token is missing');
      }
    } catch (e) {
      console.warn('[鑷] 寮傚父:', e);
    }
  })();
  
  // 猸?7.6 娑堟伅璁℃椂鍣ㄥ績璺筹細姣?250ms 鍒锋柊涓€娆¤繘琛屼腑娑堟伅鐨勭瓑寰?鑰楁椂鏄剧ず
  // 鍙敼 timer 鑺傜偣鐨?textContent锛屼笉閲嶆覆鏌撴暣鏉℃秷鎭紝闆跺崱椤?
  if (typeof tickMsgTimers === 'function') {
    setInterval(tickMsgTimers, 250);
  }
  
  // 8. 鏇存柊 Token 鏄剧ず
  if (typeof updateTokenDisplay === 'function') updateTokenDisplay();

  // 猸?8.4 椤圭洰鎸囦护锛氶粯璁よ鍙栧凡瀛樺湪鐨?AGENTS.md锛屽苟浣滀负浜哄伐缁存姢瑙勫垯娉ㄥ叆
  if (typeof initProjectInstructions === 'function') {
    setTimeout(() => initProjectInstructions(false), 500);
  }

  // 猸?8.5 椤圭洰璁板繂锛氬彧鏈夋樉寮忓紑鍚悗鎵嶆娴?璇诲彇/鐢熸垚
  if (typeof initProjectMemory === 'function') {
    setTimeout(() => initProjectMemory(false), 800);
  }
  
  // 猸?9. 鍒濆鍖栬姹傞鐜囩鐞?
  if (typeof loadRateLimiter === 'function') {
    loadRateLimiter();
    updateRateDisplay();
  }
  
  // 10. 杈撳叆妗嗚嚜閫傚簲楂樺害
  const input = document.getElementById('input');
  if (input) {
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
      MainUiService.updateSendBtn();
      clearTimeout(window._tokenUpdateTimer);
      window._tokenUpdateTimer = setTimeout(() => {
        if (typeof updateTokenDisplay === 'function') updateTokenDisplay();
      }, 300);
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSend();
      }
    });
  }
  
  // 11. 鐩戝惉瀵煎叆鏂囨湰妗嗗彉鍖?
  const importTa = document.getElementById('importText');
  if (importTa) importTa.addEventListener('input', parseAndPreviewImport);
  
  // 12. ESC 閿叧闂ā鎬佹
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      // 猸?椤哄簭锛氬厛鍏虫渶涓婂眰锛堝浘鐗囬瑙堛€佺粓绔‘璁わ級鈫?鏅€氭ā鎬?鈫?LMS 鎶藉眽
      const modals = [
        'imgPreview', 'termConfirmMask',
        'goalModal', 'goalSettingsModal',
        'toolEditModal', 'dialogManagerModal', 'backupModal', 'projectInstructionsModal', 'projectMemoryModal', 'mcpSkillModal', 'toolsModal', 'reflectionModal',
        'planModal', 'outlineModal', 'privacyModal', 'taskQueueModal', 'concurrentRequestsModal', 'settingsModal', 'jsonEditorModal',
        'rateSettingsModal', 'tokenDetailModal', 'permissionsModal',
        'lmsCookieModal', 'lmsModal'
      ];
      for (const id of modals) {
        const el = document.getElementById(id);
        if (el && el.classList.contains('show')) {
          el.classList.remove('show');
          return;
        }
      }
      // 涓婇潰娌″叧鎺変换浣曟ā鎬?鈫?鍐嶅皾璇曞叧 LMS 鎶藉眽
      const lmsPanel = document.getElementById('lmsPanel');
      if (lmsPanel && lmsPanel.classList.contains('show')) {
        lmsPanel.classList.remove('show');
      }
    }
  });
  
  // 13. 绉诲姩绔?鏇村"鑿滃崟鍒囨崲
  document.addEventListener('click', e => {
    const wrap = document.querySelector('.more-menu-wrap');
    if (!wrap) return;
    if (e.target.closest('.more-btn')) {
      wrap.classList.toggle('open');
    } else if (!e.target.closest('.more-menu')) {
      wrap.classList.remove('open');
    }
  });
  
  // 14. 鎷栨嫿鍜岀矘璐存敮鎸?
  setupDrag();
  setupPaste();
  
  // 猸?15. 瀹夎 Trace 閽╁瓙锛坒etch + executeTool 鑷姩鎻掓々锛?
  if (typeof installTraceHooks === 'function') {
    installTraceHooks();
    if (typeof renderTracePanel === 'function') renderTracePanel();
  }
  
  console.log('[init] AI Chat started');
  console.log('[init] tools loaded:', mainState().tools.length);
  console.log('[init] chats:', mainState().chats.length);
}

// 鍚姩搴旂敤
window.AgentApp.define('main', {
  mainState,
  mainLoadData,
  mainSaveData,
  init
});

init();

// ============ 馃┖ 娴忚鍣ㄦ帶鍒跺彴璋冭瘯宸ュ叿 ============
// 鐢ㄦ硶锛氬湪娴忚鍣?F12 鎺у埗鍙拌緭鍏? debugLLM()  鍗冲彲鏌ョ湅瀹屾暣閾捐矾鐘舵€?
window.debugLLM = async function() {
  const log = (...a) => console.log('%c[debugLLM]', 'color:#0a7', ...a);
  const err = (...a) => console.log('%c[debugLLM]', 'color:#c33', ...a);
  console.log('[debugLLM] LLM chain self-check');
  
  // 1. 褰撳墠椤甸潰鐜
  log('1. page origin:', location.origin, location.protocol === 'file:' ? '(file://)' : '');
  
  // 2. 璁剧疆
  const s = mainState().settings;
  log('2. baseUrl:', s.baseUrl);
  log('   apiPath:', s.apiPath);
  log('   model  :', s.currentModel);
  log('   stream :', s.stream);
  log('   useLocalProxy:', s.useLocalProxy ? 'enabled' : 'disabled');
  log('   apiKey :', s.apiKey ? s.apiKey.slice(0, 8) + '...' + s.apiKey.slice(-4) : 'missing');
  
  // 3. 鏈湴鏈嶅姟
  const tc = (typeof TERMINAL_CONFIG !== 'undefined') ? TERMINAL_CONFIG : null;
  if (!tc) { err('TERMINAL_CONFIG is not defined'); return; }
  log('3. local service URL:', tc.serverUrl);
  log('   local service config: ready');
  try {
    const r = await fetch(tc.serverUrl + '/workspace');
    if (r.ok) {
      const j = await r.json();
      log('   service status: online, workspace=' + j.workspace);
    } else {
      err('   service status: HTTP ' + r.status);
    }
  } catch (e) {
    err('   service status: unreachable. Run python local_terminal_server.py');
    err('   error:', e.message);
    return;
  }
  
  // 5. 璧颁唬鐞嗗疄闄呭彂涓€鏉?
  log('5. sending test request through local proxy');
  const url = buildFullUrl(s.baseUrl, s.apiPath);
  const headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.apiKey };
  const body = { model: s.currentModel, messages: [{ role: 'user', content: 'reply OK' }], max_tokens: 10, stream: false };
  try {
    const r = await fetch(tc.serverUrl + '/llm-proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Target-Url': url,
        'X-Target-Headers': JSON.stringify(headers)
      },
      body: JSON.stringify(body)
    });
    const txt = await r.text();
    log('   HTTP:', r.status);
    log('   response:', txt.slice(0, 300));
    if (r.ok) {
      log('chain ok. If the frontend still fails, refresh the browser cache.');
    } else {
      err('proxy returned non-200');
    }
  } catch (e) {
    err('proxy request failed:', e.message);
  }
  console.log('[debugLLM] done');
};
console.log('%c馃挕 璋冭瘯鎻愮ず: 閬囧埌闂鍦ㄦ帶鍒跺彴杈撳叆 debugLLM() 鍗冲彲鑷', 'color:#888');

