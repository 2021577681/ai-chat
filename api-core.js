// ============ 🔌 API - 请求构造 + 核心调用 + 响应处理 ============
// 【模块定位】buildRequestBody/Headers + callAPI + handleStream/NonStream + callOnceWithRole
// 依赖：api-adapters.js（buildOpenAIMessages / buildAnthropicMessages / fixAnthropicMessageSequence）
//       state.js / chat.js / tools.js / api-stream.js（updateLastMsg）
// 加载顺序：在 api-adapters.js 之后

function buildRequestBody(history, modelOverride, streamOverride) {
  const s = state.settings;
  const model = modelOverride || s.currentModel;
  const stream = streamOverride !== undefined ? streamOverride : !!s.stream;
  
  // ⭐ system 保持稳定（不混入动态摘要），最大化 prompt cache 命中率
  // 摘要由各适配器自行注入到 messages 数组中（OpenAI: 作为 system message；Anthropic: prepend 到首条 user）
  const systemContent = s.systemPrompt || '';
  
  // 准备所有占位符的值
  const apiMessages = s.apiFormat === 'anthropic' 
    ? buildAnthropicMessages(history) 
    : buildOpenAIMessages(history);
  const tools = buildToolsArray();
  
  // ⭐ 先构造默认请求体
  let body;
  if (s.apiFormat === 'anthropic') {
    body = {
      model,
      messages: apiMessages,
      max_tokens: parseInt(s.maxTokens),
      temperature: parseFloat(s.temperature),
      stream
    };
    if (systemContent) body.system = systemContent;
    if (tools) body.tools = tools;
  } else {
    body = {
      model,
      messages: apiMessages,
      temperature: parseFloat(s.temperature),
      max_tokens: parseInt(s.maxTokens),
      stream
    };
    if (tools) body.tools = tools;
    if (stream) {
      body.stream_options = { include_usage: true };
    }
  }
  
  // ⭐ 关键改造：如果启用自定义模板，合并额外字段
  if (s.useCustomJson && s.jsonTemplate && s.jsonTemplate.trim()) {
    try {
      // 1. 用占位符字符串替换法解析模板，但只用"小数据"占位符（避免大数据导致解析失败）
      let tpl = s.jsonTemplate;
      
      // 用占位符替换（先用安全的字符串替换，不带真实大数据）
      tpl = tpl
        .replace(/"\{\{messages\}\}"/g, 'null')
        .replace(/\{\{messages\}\}/g, 'null')
        .replace(/"\{\{model\}\}"/g, JSON.stringify(model))
        .replace(/\{\{model\}\}/g, JSON.stringify(model))
        .replace(/"\{\{system\}\}"/g, 'null')
        .replace(/\{\{system\}\}/g, 'null')
        .replace(/"\{\{temperature\}\}"/g, JSON.stringify(parseFloat(s.temperature)))
        .replace(/\{\{temperature\}\}/g, JSON.stringify(parseFloat(s.temperature)))
        .replace(/"\{\{max_tokens\}\}"/g, JSON.stringify(parseInt(s.maxTokens)))
        .replace(/\{\{max_tokens\}\}/g, JSON.stringify(parseInt(s.maxTokens)))
        .replace(/"\{\{stream\}\}"/g, JSON.stringify(!!stream))
        .replace(/\{\{stream\}\}/g, JSON.stringify(!!stream))
        .replace(/"\{\{tools\}\}"/g, 'null')
        .replace(/\{\{tools\}\}/g, 'null');
      
      // 2. 解析模板（此时模板里都是小数据，安全）
      const templateObj = JSON.parse(tpl);
      
      // 3. 把真实的大数据填回去
      templateObj.messages = apiMessages;
      if (systemContent) {
        templateObj.system = systemContent;
      } else {
        delete templateObj.system;
      }
      if (tools) {
        templateObj.tools = tools;
      } else {
        delete templateObj.tools;
      }
      
      // 4. 清理 null 字段
      Object.keys(templateObj).forEach(k => {
        if (templateObj[k] === null) delete templateObj[k];
      });
      
      // 5. OpenAI 流式自动加 stream_options
      if (s.apiFormat === 'openai' && templateObj.stream) {
        templateObj.stream_options = templateObj.stream_options || { include_usage: true };
      }
      
      console.log('[自定义模板] ✓ 已应用自定义字段');
      return templateObj;
      
    } catch (e) {
      console.error('[自定义模板] 解析失败:', e);
      if (typeof toast === 'function') {
        toast('❌ 自定义 JSON 模板格式错误，已回退到默认：' + e.message, 4000);
      }
      // 失败则继续走默认逻辑（返回上面构造好的 body）
    }
  }
  
  return body;
}

function buildHeaders() {
  const s = state.settings;
  const h = { 'Content-Type': 'application/json' };
  if (s.apiFormat === 'anthropic') {
    h['x-api-key'] = s.apiKey;
    h['anthropic-version'] = '2023-06-01';
    h['Authorization'] = 'Bearer ' + s.apiKey;
  } else {
    h['Authorization'] = 'Bearer ' + s.apiKey;
  }
  if (s.jsonHeaders && s.jsonHeaders.trim()) {
    try {
      const extra = JSON.parse(s.jsonHeaders);
      Object.assign(h, extra);
    } catch (e) {}
  }
  return h;
}

// ⭐ 单次 fetch 硬超时（毫秒）
// 即使外部 abort 失灵（某些浏览器/代理在 TCP 阶段卡死），到点也会强行抛错
const API_FETCH_TIMEOUT_MS = 5 * 60 * 1000;  // 5 分钟

// ============ 🔁 自动重试机制 ============
// 判定一个错误是否值得重试
function _isRetryableError(e, httpStatus) {
  if (!e && !httpStatus) return false;
  // 用户主动中止：绝不重试
  if (e && e.name === 'AbortError') return false;
  if (state.abortCtrl && state.abortCtrl.signal && state.abortCtrl.signal.aborted) return false;
  // Token 拿不到这种本地配置错，重试也没用
  if (e && e.name === 'LocalProxyAuthError') return false;
  
  // HTTP 状态码：5xx 服务端临时错 + 429 限流 + 408 超时 + 502/503/504 网关错都重试
  if (httpStatus) {
    if (httpStatus === 408 || httpStatus === 429) return true;
    if (httpStatus >= 500 && httpStatus < 600) return true;
    // 其他 4xx（鉴权 / 参数错）重试无意义
    return false;
  }
  
  // 网络层错误：fetch 没拿到响应 / 流读到一半断开 / 硬超时
  if (e) {
    if (e.name === 'NetworkError' || e.name === 'TimeoutError') return true;
    const msg = (e.message || '') + ' ' + (e.name || '');
    if (/Failed to fetch|NetworkError|network|ECONN|ETIMEDOUT|ENOTFOUND|stream|chunk|aborted/i.test(msg)) {
      // 但如果是用户 abort 触发的 AbortError，上面已经拦了
      return true;
    }
  }
  return false;
}

// 退避等待，支持 Retry-After 头（秒数或 HTTP-date）
function _retryDelay(attempt, retryAfter, baseMs) {
  if (retryAfter) {
    const n = parseInt(retryAfter);
    if (!isNaN(n) && n > 0 && n < 120) return n * 1000; // 1~120s 之间才信
    const t = Date.parse(retryAfter);
    if (!isNaN(t)) {
      const ms = t - Date.now();
      if (ms > 0 && ms < 120000) return ms;
    }
  }
  const base = baseMs || 1000;
  const exp = base * Math.pow(2, Math.max(0, attempt - 1));  // 1s, 2s, 4s...
  const jitter = Math.floor(Math.random() * 500);            // 0~500ms 抖动
  return Math.min(exp + jitter, 30000);                       // 上限 30s
}

// 可被 abort 中断的 sleep
function _sleepAbortable(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(new DOMException('aborted', 'AbortError'));
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('aborted', 'AbortError'));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

// 与 outline-core.js 中 _outlineFetchWithTimeout 同理：合并外部 signal 和内部超时
async function _apiFetchWithTimeout(url, init, externalSignal, timeoutMs) {
  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), timeoutMs || API_FETCH_TIMEOUT_MS);
  
  let externalAbortHandler = null;
  if (externalSignal) {
    if (externalSignal.aborted) {
      timeoutCtrl.abort();
    } else {
      externalAbortHandler = () => timeoutCtrl.abort();
      externalSignal.addEventListener('abort', externalAbortHandler, { once: true });
    }
  }
  
  // ⭐ 跨域代理：如果开启了 useLocalProxy 且目标不是 localhost，则改走本地服务转发
  //    浏览器 → http://localhost:8765/llm-proxy → 上游 LLM（服务端转发，无 CORS）
  let realUrl = url;
  let realInit = { ...(init || {}), signal: timeoutCtrl.signal };
  try {
    const s = (typeof state !== 'undefined') && state.settings;
    const tc = (typeof TERMINAL_CONFIG !== 'undefined') ? TERMINAL_CONFIG : null;
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(url);
    if (s && s.useLocalProxy && tc && tc.serverUrl && !isLocal) {
      // ⭐ 没 token 就自动静默拉取（服务端已对本机来源免确认放行）
      if (!tc.token && typeof fetchTerminalToken === 'function') {
        try { await fetchTerminalToken(true); } catch (e) { /* 失败也继续，下面 fetch 会自然报错 */ }
      }
      const proxyHeaders = {
        'Content-Type': 'application/json',
        'X-Token': tc.token || '',
        'X-Target-Url': url,
        'X-Target-Headers': JSON.stringify(init && init.headers ? init.headers : {})
      };
      realUrl = tc.serverUrl.replace(/\/+$/, '') + '/llm-proxy';
      realInit = {
        ...realInit,
        method: (init && init.method) || 'POST',
        headers: proxyHeaders,
        body: init && init.body // 原样转发
      };
    }
  } catch (e) {
    console.warn('[apiFetch] 代理改写失败，回退到直连:', e);
  }
  
  return fetch(realUrl, realInit).finally(() => {
    clearTimeout(timer);
    if (externalSignal && externalAbortHandler) {
      externalSignal.removeEventListener('abort', externalAbortHandler);
    }
  }).catch(e => {
    if (e.name === 'AbortError' && externalSignal && !externalSignal.aborted) {
      const err = new Error(`⏱ 请求超时（${Math.round((timeoutMs || API_FETCH_TIMEOUT_MS) / 1000)}s 无响应）`);
      err.name = 'TimeoutError';
      throw err;
    }
    // ⭐ TypeError: Failed to fetch / NetworkError 这种"瞎报错"翻译成人话
    if (e instanceof TypeError || /Failed to fetch|NetworkError|Network request failed/i.test(e.message || '')) {
      const usingProxy = realUrl !== url;
      const hints = usingProxy ? [
        '⚠️ 已开启「本地代理」但请求失败，请检查：',
        '  1) 本地服务是否在跑？  python local_terminal_server.py',
        `  2) 服务地址是否正确？  当前：${realUrl}`,
        `目标 URL：${url}`
      ].join('\n') : [
        '可能原因：',
        '  1) URL 错误或域名无法访问（检查 baseUrl/apiPath）',
        '  2) 跨域被浏览器拦截（CORS）',
        '     👉 设置 → 勾选「通过本地服务代理」并启动 python local_terminal_server.py',
        '  3) 网络不通 / 代理未开',
        `目标 URL：${url}`
      ].join('\n');
      const err = new Error(`🌐 网络请求失败（fetch 未拿到任何响应）\n${hints}\n\n原始错误：${e.message || e.name}`);
      err.name = 'NetworkError';
      throw err;
    }
    throw e;
  });
}

async function callAPI(roundLimit) {
  const c = currentChat();
  if (!c) {
    console.error('[callAPI] 没有当前对话');
    state.isGenerating = false;
    updateSendBtn();
    return;
  }
  
  const s = state.settings;
  
  // 如果未显式传入 roundLimit，则使用设置中的值（首次调用）
  if (typeof roundLimit !== 'number') {
    const cfg = parseInt(s.maxToolRounds);
    roundLimit = (isNaN(cfg) || cfg < 0) ? 15 : cfg;
  }
  
  state.isGenerating = true;
  updateSendBtn();
  
  c.messages.push({ role: 'assistant', content: '', _startTime: Date.now() });
  // ⭐ 增量追加新的 assistant 占位（不重建整个列表）
  if (typeof appendMsgNode === 'function') {
    appendMsgNode(c.messages.length - 1);
  } else {
    renderMessages();
  }
  let lastIdx = c.messages.length - 1;
  
  const url = buildFullUrl(s.baseUrl, s.apiPath);
  let body;
  try {
    body = buildRequestBody(c.messages.slice(0, -1));
  } catch (e) {
    c.messages[lastIdx].content = `❌ 构造请求失败：${e.message}`;
    renderMessages();
    saveData();
    state.isGenerating = false;
    state.abortCtrl = null;
    updateSendBtn();
    return;
  }
  
  const requestHeaders = buildHeaders();
  state.abortCtrl = new AbortController();
  
  // ⭐ 自动重试：把"发请求 + 读响应"包成可重试单元
  const maxAttempts = Math.max(1, (parseInt(s.retryMaxAttempts) || 3) + 1);  // 总尝试次数 = 重试次数+1
  const baseDelay = Math.max(100, parseInt(s.retryBaseDelayMs) || 1000);
  let lastError = null;
  let succeeded = false;
  
  try {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // 重试前清空上次的部分内容（避免半截回复和重试结果拼接）
      if (attempt > 1) {
        const m = c.messages[lastIdx];
        if (m) {
          m.content = '';
          delete m.tool_calls;
          delete m._firstTokenAt;
          m._startTime = Date.now();
          if (typeof refreshMsgNode === 'function') refreshMsgNode(lastIdx);
        }
      }
      
      let httpStatus = 0;
      let retryAfter = null;
      try {
        if (typeof applyRateLimit === 'function') {
          await applyRateLimit();
        }
        
        const resp = await _apiFetchWithTimeout(url, {
          method: 'POST',
          headers: requestHeaders,
          body: JSON.stringify(body)
        }, state.abortCtrl.signal, API_FETCH_TIMEOUT_MS);
        
        if (typeof recordRequest === 'function') {
          recordRequest();
        }
        
        const ct = resp.headers.get('content-type') || '';
        if (!resp.ok) {
          httpStatus = resp.status;
          retryAfter = resp.headers.get('retry-after');
          const t = await resp.text();
          if (typeof saveRequestToHistory === 'function') {
            saveRequestToHistory(url, requestHeaders, body, t, `HTTP ${resp.status}`);
          }
          const err = new Error(`HTTP ${resp.status}: ${t.slice(0, 500)}`);
          err.httpStatus = resp.status;
          err.retryAfter = retryAfter;
          throw err;
        }
        // ⭐ 兼容更多服务：
        //   - 标准：text/event-stream
        //   - 某些中转：application/stream+json / text/plain / 缺失 content-type
        const ctLower = ct.toLowerCase();
        const looksLikeStream = ctLower.includes('event-stream')
                             || ctLower.includes('stream+json')
                             || (body.stream && !ctLower.includes('json') && !ctLower.includes('html'));
        if (body.stream && looksLikeStream && resp.body && typeof resp.body.getReader === 'function') {
          await handleStream(resp, c, lastIdx, { url, method: 'POST', headers: requestHeaders, body });
        } else {
          const txt = await resp.text();
          await handleNonStream(txt, c, lastIdx, ct, { url, method: 'POST', headers: requestHeaders, body });
        }
        
        succeeded = true;
        break;  // 跳出重试循环
      } catch (attemptErr) {
        lastError = attemptErr;
        // 用户主动 abort：不重试，让外层 catch 处理
        if (attemptErr.name === 'AbortError' || (state.abortCtrl && state.abortCtrl.signal.aborted)) {
          throw attemptErr;
        }
        const retryable = _isRetryableError(attemptErr, httpStatus || attemptErr.httpStatus);
        const remaining = maxAttempts - attempt;
        if (!retryable || remaining <= 0) {
          throw attemptErr;
        }
        const wait = _retryDelay(attempt, retryAfter || attemptErr.retryAfter, baseDelay);
        console.warn(`[callAPI] 第 ${attempt}/${maxAttempts} 次尝试失败：${attemptErr.message}\n  → ${wait}ms 后重试`);
        // 把"正在重试"信息显示给用户看
        const m = c.messages[lastIdx];
        if (m) {
          m.content = `🔁 第 ${attempt} 次尝试失败，${Math.round(wait / 1000) || 1}s 后自动重试…\n\n_${attemptErr.message.split('\n')[0]}_`;
          if (typeof refreshMsgNode === 'function') refreshMsgNode(lastIdx);
        }
        try {
          await _sleepAbortable(wait, state.abortCtrl.signal);
        } catch (sleepErr) {
          // sleep 被 abort 中断
          throw sleepErr;
        }
      }
    }
    
    if (!succeeded) {
      // 理论上不会到这里（要么 break 要么 throw），保险起见
      throw lastError || new Error('请求失败');
    }
    
    if (typeof saveRequestToHistory === 'function') {
      saveRequestToHistory(url, requestHeaders, body, c.messages[lastIdx].content, null);
    }
    
    const msg = c.messages[lastIdx];
    if (msg.tool_calls && msg.tool_calls.length && roundLimit > 0) {
      // ⭐ 关键修复：本轮 assistant 回复（含工具调用）已结束，冻结其 timer
      // 否则 tickMsgTimers 会一直按 Date.now()-_startTime 刷新，导致"模型回答完计时还在涨"
      if (!msg._endTime) msg._endTime = Date.now();
      // ⭐ 清掉流式残留 + 光标
      if (typeof cancelPendingStreamFlush === 'function') cancelPendingStreamFlush();
      if (typeof refreshMsgNode === 'function') refreshMsgNode(lastIdx);
      
      let userStoppedAll = false;
      
      for (const tc of msg.tool_calls) {
        const fname = tc.function?.name || '';
        let args = {};
        try { args = JSON.parse(tc.function?.arguments || '{}'); } catch (e) {}
        const result = await executeTool(fname, args);
        
        let contentText;
        let isError = false;
        let stopAll = false;
        
        if (typeof result.value === 'string') {
          contentText = result.value;
          isError = !result.ok;
        } else if (typeof result.value === 'object' && result.value !== null) {
          if (result.value._stopAll) {
            stopAll = true;
            contentText = result.value.error || '用户要求停止所有操作';
            isError = true;
            userStoppedAll = true;
          } else if (result.value._userRejected) {
            contentText = result.value.error || '用户拒绝此操作';
            isError = true;
          } else if (result.value.ok === false) {
            contentText = result.value.error || JSON.stringify(result.value);
            isError = true;
          } else {
            contentText = JSON.stringify(result.value);
            isError = !result.ok;
          }
        } else {
          contentText = JSON.stringify(result.value);
          isError = !result.ok;
        }
        
        c.messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: fname,
          content: contentText,
          status: isError ? 'error' : 'success',
          _startTime: Date.now(),
          _endTime: Date.now()
        });
        // ⭐ 增量追加单条工具消息（不重建整个列表），避免闪烁
        if (typeof appendMsgNode === 'function') {
          appendMsgNode(c.messages.length - 1);
        } else {
          renderMessages();
        }
        saveData();
        
        if (stopAll) break;
      }
      
      state.isGenerating = false;
      
      if (userStoppedAll) {
        await callAPI(0);
      } else {
        await callAPI(roundLimit - 1);
      }
      return;
    }
    
    saveData();
    // ⭐ 完成时标记结束时间，并对当前消息节点做一次"完整"渲染（含 KaTeX）
    if (c.messages[lastIdx]) c.messages[lastIdx]._endTime = Date.now();
    // ⭐ 清掉任何待执行的流式刷新 + 残留光标，避免完成后还闪
    if (typeof cancelPendingStreamFlush === 'function') cancelPendingStreamFlush();
    if (typeof refreshMsgNode === 'function') {
      refreshMsgNode(lastIdx);
    } else {
      renderMessages();
    }
    if (typeof scheduleAccurateTokenCount === 'function') scheduleAccurateTokenCount();
  } catch (e) {
    if (e.name === 'AbortError') c.messages[lastIdx].content += '\n\n*[已停止]*';
    else {
      c.messages[lastIdx].content = `❌ ${e.message}\n\n💡 URL: ${url}`;
      if (typeof saveRequestToHistory === 'function') {
        saveRequestToHistory(url, requestHeaders, body, null, e.message);
      }
    }
    if (c.messages[lastIdx]) c.messages[lastIdx]._endTime = Date.now();
    // ⭐ 错误/abort 时同样清掉残留光标
    if (typeof cancelPendingStreamFlush === 'function') cancelPendingStreamFlush();
    if (typeof refreshMsgNode === 'function') {
      refreshMsgNode(lastIdx);
    } else {
      renderMessages();
    }
    saveData();
  } finally {
    state.isGenerating = false;
    state.abortCtrl = null;
    if (typeof updateSendBtn === 'function') updateSendBtn();
    
    const sendBtn = document.getElementById('sendBtn');
    if (sendBtn) {
      sendBtn.textContent = '↑';
      sendBtn.classList.remove('stop');
    }
  }
}

async function handleStream(resp, c, lastIdx, reqCtx) {
  const s = state.settings;
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const tcMap = {};
  const anthropicToolBlocks = {};
  let streamUsage = null;
  let rawAccumulated = '';  // ⭐ 累积原始 SSE 文本，用于响应预览
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    rawAccumulated += chunk;  // ⭐ 保留原始字节流
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t || !t.startsWith('data:')) continue;
      const data = t.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const j = JSON.parse(data);
        if (s.apiFormat === 'anthropic') {
          if (j.type === 'content_block_delta' && j.delta?.type === 'text_delta') {
            // ⭐ 立即标记首字时间（让 timer 立刻从"等待"切到"流式中"）
            if (!c.messages[lastIdx]._firstTokenAt) c.messages[lastIdx]._firstTokenAt = Date.now();
            c.messages[lastIdx].content += j.delta.text || '';
            updateLastMsg();
          }
          if (j.type === 'content_block_start' && j.content_block?.type === 'tool_use') {
            const idx = j.index ?? 0;
            anthropicToolBlocks[idx] = {
              id: j.content_block.id,
              name: j.content_block.name,
              partial_input: ''
            };
          }
          if (j.type === 'content_block_delta' && j.delta?.type === 'input_json_delta') {
            const idx = j.index ?? 0;
            if (anthropicToolBlocks[idx]) {
              anthropicToolBlocks[idx].partial_input += j.delta.partial_json || '';
            }
          }
          if (j.type === 'message_start' && j.message?.usage) {
            streamUsage = j.message.usage;
          }
          if (j.type === 'message_delta' && j.usage) {
            streamUsage = { ...streamUsage, ...j.usage };
          }
        } else {
          const delta = j.choices?.[0]?.delta;
          if (delta) {
            if (delta.content) {
              // ⭐ 立即标记首字时间
              if (!c.messages[lastIdx]._firstTokenAt) c.messages[lastIdx]._firstTokenAt = Date.now();
              c.messages[lastIdx].content += delta.content;
              updateLastMsg();
            }
            if (delta.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!tcMap[idx]) tcMap[idx] = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } };
                if (tc.id) tcMap[idx].id = tc.id;
                if (tc.function?.name) tcMap[idx].function.name += tc.function.name;
                if (tc.function?.arguments) tcMap[idx].function.arguments += tc.function.arguments;
              }
            }
          }
          if (j.usage) {
            streamUsage = j.usage;
          }
        }
      } catch (e) {}
    }
  }
  
  const openaiTcs = Object.values(tcMap);
  if (openaiTcs.length) c.messages[lastIdx].tool_calls = openaiTcs;
  
  const anthropicTcs = Object.values(anthropicToolBlocks);
  if (anthropicTcs.length) {
    c.messages[lastIdx].tool_calls = anthropicTcs.map(tb => ({
      id: tb.id,
      type: 'function',
      function: {
        name: tb.name,
        arguments: tb.partial_input || '{}'
      }
    }));
  }
  
  if (streamUsage && typeof recordUsageFromResponse === 'function') {
    recordUsageFromResponse(c, streamUsage);
  }
  
  // ⭐ 保存原始响应到全局（仅本会话，刷新失效）
  if (typeof recordRawResponse === 'function') {
    recordRawResponse({
      ts: Date.now(),
      isStream: true,
      contentType: resp.headers.get('content-type') || '',
      raw: rawAccumulated,
      usage: streamUsage,
      parsedContent: c.messages[lastIdx].content,
      parsedToolCalls: c.messages[lastIdx].tool_calls,
      request: reqCtx || null,
      _source: '主对话流 · 流式'
    });
  }
}

async function handleNonStream(txt, c, lastIdx, ct, reqCtx) {
  const s = state.settings;
  // ⭐ 不死认 content-type：很多兼容服务返回 text/plain 但内容其实是合法 JSON
  // 优先尝试解析，失败再报"非 JSON"
  let j;
  const trimmed = (txt || '').trim();
  const looksLikeJson = trimmed.startsWith('{') || trimmed.startsWith('[');
  if (looksLikeJson) {
    try { j = JSON.parse(trimmed); } catch (e) {
      throw new Error(`JSON 解析失败（content-type: ${ct}）\n响应预览：${txt.slice(0, 300)}`);
    }
  } else {
    throw new Error(`服务器返回非 JSON 内容（content-type: ${ct}）\n响应预览：${txt.slice(0, 300)}\n\n💡 检查项：\n  - URL 是否正确（HTML 通常说明走到了网页而非 API）\n  - 是否漏填 /chat/completions 或 /v1\n  - 中转服务是否要求特殊鉴权头`);
  }
  if (j.error) throw new Error(`API 错误：${j.error.message || JSON.stringify(j.error)}`);
  
  // ⭐ 保存原始响应（在解析之前就保存好，方便用户对照）
  if (typeof recordRawResponse === 'function') {
    recordRawResponse({
      ts: Date.now(),
      isStream: false,
      contentType: ct,
      raw: txt,
      parsedJson: j,
      usage: j.usage || null,
      request: reqCtx || null,
      _source: '主对话流 · 非流式'
    });
  }
  
  if (s.apiFormat === 'anthropic') {
    const contents = j.content || [];
    c.messages[lastIdx].content = contents.filter(p => p.type === 'text').map(p => p.text).join('') || '';
    const toolUses = contents.filter(p => p.type === 'tool_use');
    if (toolUses.length) {
      c.messages[lastIdx].tool_calls = toolUses.map(tu => ({
        id: tu.id,
        type: 'function',
        function: {
          name: tu.name,
          arguments: JSON.stringify(tu.input || {})
        }
      }));
    }
    if (j.usage && typeof recordUsageFromResponse === 'function') {
      recordUsageFromResponse(c, j.usage);
    }
  } else {
    const msg = j.choices?.[0]?.message;
    if (msg) {
      c.messages[lastIdx].content = msg.content || '';
      if (msg.tool_calls?.length) c.messages[lastIdx].tool_calls = msg.tool_calls;
    } else {
      c.messages[lastIdx].content = '(无响应)';
    }
    if (j.usage && typeof recordUsageFromResponse === 'function') {
      recordUsageFromResponse(c, j.usage);
    }
  }
}

async function callOnceWithRole(history, model, rolePrompt) {
  const s = state.settings;
  // ⭐ 复用已存在的 abortCtrl（如 Plan 模式在外层已创建），没有再新建
  // 避免覆盖掉外层 Plan / 师生模式 已创建的中止控制器
  if (!state.abortCtrl) {
    state.abortCtrl = new AbortController();
  }
  const signal = state.abortCtrl.signal;
  const tempMessages = history.filter(m => m.role !== 'system' && m.role !== 'tool');
  let body;
  if (s.apiFormat === 'anthropic') {
    body = {
      model,
      messages: buildAnthropicMessages(tempMessages),
      max_tokens: parseInt(s.maxTokens),
      temperature: parseFloat(s.temperature),
      stream: false,
      system: rolePrompt
    };
  } else {
    const msgs = [{ role: 'system', content: rolePrompt }];
    for (const m of buildOpenAIMessages(tempMessages)) if (m.role !== 'system') msgs.push(m);
    body = {
      model,
      messages: msgs,
      temperature: parseFloat(s.temperature),
      max_tokens: parseInt(s.maxTokens),
      stream: false
    };
  }
  
  if (typeof applyRateLimit === 'function') {
    await applyRateLimit();
  }
  
  const url = buildFullUrl(s.baseUrl, s.apiPath);
  const resp = await _apiFetchWithTimeout(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(body)
  }, signal, API_FETCH_TIMEOUT_MS);
  
  if (typeof recordRequest === 'function') {
    recordRequest();
  }
  
  const ct = resp.headers.get('content-type') || '';
  const txt = await resp.text();
  if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${txt.slice(0, 300)}`);
  if (!ct.includes('json')) throw new Error(`非 JSON 响应 (${ct})\n${txt.slice(0, 200)}`);
  let j;
  try { j = JSON.parse(txt); } catch (e) { throw new Error('JSON 解析失败'); }
  if (j.error) throw new Error(`API 错误：${j.error.message || JSON.stringify(j.error)}`);
  
  // ⭐ 记录原始响应（callOnceWithRole 被 Plan 规划/师生评审/Token 摘要等多处复用）
  if (typeof recordRawResponse === 'function') {
    recordRawResponse({
      ts: Date.now(),
      isStream: false,
      contentType: ct,
      raw: txt,
      parsedJson: j,
      usage: j.usage || null,
      request: { url, method: 'POST', headers: buildHeaders(), body },
      _source: '辅助调用 (callOnceWithRole)'
    });
  }
  
  // ⭐ 把辅助调用（Plan 规划/审查/整合、师生评审、压缩摘要等）的 usage 计入当前对话统计
  // 之前漏算导致 Plan/大纲/师生 模式的 token 都不进总账
  if (j.usage && typeof recordUsageFromResponse === 'function') {
    const _c = typeof currentChat === 'function' ? currentChat() : null;
    if (_c) recordUsageFromResponse(_c, j.usage);
  }
  
  if (s.apiFormat === 'anthropic') return (j.content || []).filter(p => p.type === 'text').map(p => p.text).join('') || '';
  return j.choices?.[0]?.message?.content || '';
}

