// ============ 🔌 API - 流式渲染节流 + 停止/发送按钮 ============
// 【模块定位】updateLastMsg 的 RAF 节流 + stopGenerate + updateSendBtn
// 依赖：state.js / chat.js（renderMessages / scrollToBottom）
// 加载顺序：随便，但建议放 api-core.js 之后保持习惯

function updateLastMsg() {
  // ⭐ 节流：连续 chunk 一帧只渲染一次，避免每个 chunk 都重做 markdown 解析 + DOM 重建
  if (_updateLastMsgScheduled) return;
  _updateLastMsgScheduled = true;
  _updateLastMsgRafId = requestAnimationFrame(() => {
    _updateLastMsgScheduled = false;
    _updateLastMsgRafId = null;
    _flushLastMsg();
  });
}

let _updateLastMsgScheduled = false;
let _updateLastMsgRafId = null;

// ⭐ 取消任何待执行的流式刷新，并清除残留光标
// 必须在流式结束、错误、abort、refreshMsgNode 之前调用
function cancelPendingStreamFlush() {
  if (_updateLastMsgRafId != null) {
    cancelAnimationFrame(_updateLastMsgRafId);
    _updateLastMsgRafId = null;
  }
  _updateLastMsgScheduled = false;
  // 清掉 DOM 里任何残留的 .cursor 节点（保险措施）
  document.querySelectorAll('.msg-content .cursor').forEach(el => el.remove());
}

function _flushLastMsg() {
  const c = currentChat();
  if (!c) return;
  const lastIdx = c.messages.length - 1;
  const m = c.messages[lastIdx];
  if (!m) return;
  
  // ⭐ 如果消息已结束（_endTime 已被设置），不再追加光标
  // 避免 rAF 延迟触发与"流式完成"的时序竞争导致光标残留
  if (m._endTime) return;
  
  // 兜底：若 content 已存在但 _firstTokenAt 未设置（非流式分支），补上
  if (!m._firstTokenAt && (m.content || (m.tool_calls && m.tool_calls.length))) {
    m._firstTokenAt = Date.now();
  }
  
  const wrap = document.querySelector(`.message[data-idx="${lastIdx}"] .msg-content`);
  if (wrap) {
    // ⭐ 关键：必须在改 innerHTML 之前判断是否处于底部
    // 否则新内容把 scrollHeight 推高，diff 立刻变大，isNearBottom 会误判
    const shouldFollow = (typeof isNearBottom !== 'function' || isNearBottom());
    
    // ⭐ 用流式版渲染函数：自动补全未闭合的 ``` / $$ / ` 围栏
    // 解决"代码块断成两截"的问题
    const renderFn = (typeof renderMarkdownStreaming === 'function')
      ? renderMarkdownStreaming
      : renderMarkdown;
    wrap.innerHTML = renderFn(m.content || '') + '<span class="cursor"></span>';
    // ⭐ 流式过程中跳过 KaTeX（公式可能写一半），完成后再统一渲染
    // 只在当前消息节点范围内做 hljs
    const msgNode = wrap.closest('.message');
    if (msgNode) postRender(msgNode, { skipMath: true });
    
    // ⭐ 跟随底部：每次都贴底（scrollBottom 本身很轻，innerHTML 已经触发过 reflow 了）
    if (shouldFollow) scrollBottom();
  }
}

function stopGenerate() {
  if (state.abortCtrl) {
    try {
      state.abortCtrl.abort();
    } catch (e) {
      console.error('[stopGenerate] 错误:', e);
    }
  }
  // ⭐ 清掉流式刷新与残留光标
  if (typeof cancelPendingStreamFlush === 'function') cancelPendingStreamFlush();
  state.isGenerating = false;
  state.abortCtrl = null;
  if (typeof updateSendBtn === 'function') updateSendBtn();
}

function updateSendBtn() {
  const btn = document.getElementById('sendBtn');
  if (!btn) return;
  if (state.isGenerating) {
    btn.textContent = '■';
    btn.classList.add('stop');
    document.getElementById('inputInfo').textContent = '生成中...';
  } else {
    btn.textContent = '↑';
    btn.classList.remove('stop');
    let info = `${state.settings.apiFormat === 'anthropic' ? '🟠 Anthropic' : '🟢 OpenAI'}`;
    if (state.settings.usePlan) info += ` · 📋 Plan(${state.settings.planMaxSteps}步)`;
    if (state.settings.useReflection) info += ` · 🎭 师生(${state.settings.refRounds}轮)`;
    if (state.settings.useOutline) info += ` · 📑 大纲(${state.settings.outlineMaxRounds || 30}轮)`;
    if (state.settings.useTools && state.tools.length) info += ` · 🛠 ${state.tools.length}工具`;
    if (state.settings.compressAutoEnabled) info += ` · 🗜️ 自动压缩`;
    document.getElementById('inputInfo').textContent = info;
  }
}
