// ============ 🔌 API - 消息格式适配器（OpenAI / Anthropic）============
// 【模块定位】将 chats[].messages 转换成各家 API 要求的格式
// 依赖：state.js / utils.js
// 加载顺序：在 api-core.js / api-stream.js 之前

// ============ API 调用核心 ============

function buildOpenAIMessages(history) {
  const out = [];
  if (state.settings.systemPrompt) out.push({ role: 'system', content: state.settings.systemPrompt });
  
  for (const m of history) {
    if (m._isCompressing) continue;
    if (m._isSummary) {
      out.push({ role: 'system', content: m.content });
      continue;
    }
    if (m.role === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: m.tool_call_id,
        name: m.name,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      });
      continue;
    }
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length) {
      out.push({ role: 'assistant', content: m.content || '', tool_calls: m.tool_calls });
      continue;
    }
    
    const attachments = m.attachments || [];
    const imageAttachments = attachments.filter(a => a.type === 'image' && a.data && !a._stripped);
    const textFileTexts = attachments.filter(a => 
      a.type === 'file' && a.text
    ).map(a => `\n\n[附件: ${a.name}]\n\`\`\`\n${a.text}\n\`\`\``).join('');
    
    const strippedNotes = attachments.filter(a => a._stripped).map(a => 
      `\n\n[附件: ${a.name} - ⚠️ 数据已丢失]`
    ).join('');
    
    const textContent = (m.content || '') + textFileTexts + strippedNotes;
    
    const hasImg = imageAttachments.length > 0;
    
    if (hasImg && m.role === 'user') {
      const parts = [];
      if (textContent.trim()) parts.push({ type: 'text', text: textContent });
      for (const a of imageAttachments) {
        parts.push({ type: 'image_url', image_url: { url: a.data } });
      }
      out.push({ role: m.role, content: parts });
    } else {
      out.push({ role: m.role, content: textContent });
    }
  }
  return out;
}

// ⭐ 关键修复：支持 PDF 和图片
function buildAnthropicMessages(history) {
  const out = [];
  
  // ⭐ 第一步：跟踪所有 tool_use ids 和它们对应的 tool_result
  // 用于检测孤立的 tool_use
  
  for (const m of history) {
    if (m._isCompressing) continue;
    if (m._isSummary) continue;
    if (m.role === 'system') continue;
    
    if (m.role === 'tool') {
      const toolResultPart = {
        type: 'tool_result',
        tool_use_id: m.tool_call_id,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content)) {
        last.content.push(toolResultPart);
      } else {
        out.push({ role: 'user', content: [toolResultPart] });
      }
      continue;
    }
    
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length) {
      const parts = [];
      if (m.content && m.content.trim()) {
        parts.push({ type: 'text', text: m.content });
      }
      for (const tc of m.tool_calls) {
        let input = {};
        try { input = JSON.parse(tc.function?.arguments || '{}'); } catch (e) {}
        parts.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function?.name || '',
          input: input
        });
      }
      out.push({ role: 'assistant', content: parts });
      continue;
    }
    
    const attachments = m.attachments || [];
    const imageAttachments = attachments.filter(a => a.type === 'image' && a.data && !a._stripped);
    const pdfAttachments = attachments.filter(a => 
      a.mime === 'application/pdf' && a.data && !a._stripped
    );
    const fileTexts = attachments.filter(a => 
      a.type === 'file' && a.text && a.mime !== 'application/pdf'
    ).map(a => `\n\n[附件: ${a.name}]\n\`\`\`\n${a.text}\n\`\`\``).join('');
    const strippedNotes = attachments.filter(a => a._stripped).map(a => 
      `\n\n[附件: ${a.name} - ⚠️ 数据已丢失]`
    ).join('');
    
    const textContent = (m.content || '') + fileTexts + strippedNotes;
    const hasMultimedia = (imageAttachments.length > 0 || pdfAttachments.length > 0) && m.role === 'user';
    
    if (hasMultimedia) {
      const parts = [];
      for (const a of pdfAttachments) {
        const b64 = a.data.split(',')[1] || '';
        parts.push({
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: b64 }
        });
      }
      for (const a of imageAttachments) {
        const mt = (a.data.match(/data:([^;]+);base64,/) || [])[1] || 'image/png';
        const b64 = a.data.split(',')[1] || '';
        parts.push({ type: 'image', source: { type: 'base64', media_type: mt, data: b64 } });
      }
      if (textContent.trim()) parts.push({ type: 'text', text: textContent });
      out.push({ role: m.role, content: parts });
    } else {
      out.push({ role: m.role, content: textContent });
    }
  }
  
  // ⭐ 第二步：修复格式（自动补全缺失的 tool_result）
  return fixAnthropicMessageSequence(out);
}

// ⭐ 新增：修复消息序列，确保每个 tool_use 都有对应的 tool_result
function fixAnthropicMessageSequence(messages) {
  const fixed = [];
  
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    fixed.push(m);
    
    // 如果这条是 assistant 且包含 tool_use
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      const toolUses = m.content.filter(p => p.type === 'tool_use');
      
      if (toolUses.length > 0) {
        // 检查下一条是不是 user 消息且包含对应的 tool_result
        const next = messages[i + 1];
        const nextToolResults = (next && next.role === 'user' && Array.isArray(next.content))
          ? next.content.filter(p => p.type === 'tool_result').map(p => p.tool_use_id)
          : [];
        
        // 找出缺失的 tool_result
        const missingIds = toolUses
          .map(tu => tu.id)
          .filter(id => !nextToolResults.includes(id));
        
        if (missingIds.length > 0) {
          console.warn(`[修复] 缺失 tool_result：${missingIds.join(', ')}，自动补全`);
          
          // 构造补全的 tool_result 块
          const fillerResults = missingIds.map(id => ({
            type: 'tool_result',
            tool_use_id: id,
            content: '[系统：此工具调用的结果丢失，可能是因为操作被中断或会话被重置]',
            is_error: true
          }));
          
          // 如果下一条是 user 消息（含 tool_result），把缺失的合并进去
          if (next && next.role === 'user' && Array.isArray(next.content)) {
            // 在 next 的 content 开头插入缺失的 results
            next.content.unshift(...fillerResults);
          } else {
            // 否则插入一个新的 user 消息
            fixed.push({
              role: 'user',
              content: fillerResults
            });
          }
        }
      }
    }
  }
  
  // ⭐ 第三步：清理空的 user 消息（content 数组里只有 tool_result 但全部被清空的情况）
  return fixed.filter(m => {
    if (m.role === 'user' && Array.isArray(m.content) && m.content.length === 0) {
      console.warn('[修复] 跳过空 user 消息');
      return false;
    }
    return true;
  });
}

