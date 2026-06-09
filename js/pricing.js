// ============ 💰 定价管理（Pricing Manager） ============
// 【模块定位】管理各模型的 token 单价 + 汇率，供 tokens.js 估算费用使用
// 依赖：state.js / idb-store.js（storage 对象）
// 加载顺序：在 state.js 之后、tokens.js 之后（tokens.js 调用 getPricing()）
//
// 数据结构（持久化到 IDB）：
//   storage[PRICING_LIST_KEY] = [
//     { key, input, output, cacheRead, currency?, note? }, ...
//   ]
//   storage[PRICING_CONFIG_KEY] = { rate: 7.2, showCny: true }

const PRICING_LIST_KEY = 'aichat_custom_pricing_v1';
const PRICING_CONFIG_KEY = 'aichat_pricing_config_v1';

// 内置默认价格（每 1M token，美元）
// 用户首次进入定价管理时会看到这些作为初始数据
const DEFAULT_PRICING = [
  { key: 'claude-3-5-sonnet',  input: 3.0,  output: 15.0, cacheRead: 0.30,  note: 'Claude 3.5 Sonnet' },
  { key: 'claude-3-haiku',     input: 0.25, output: 1.25, cacheRead: 0.03,  note: 'Claude 3 Haiku' },
  { key: 'claude-opus',        input: 15.0, output: 75.0, cacheRead: 1.50,  note: 'Claude Opus' },
  { key: 'gpt-4o',             input: 2.5,  output: 10.0, cacheRead: 1.25,  note: 'GPT-4o' },
  { key: 'gpt-4o-mini',        input: 0.15, output: 0.60, cacheRead: 0.075, note: 'GPT-4o mini' },
  { key: 'deepseek-chat',      input: 0.27, output: 1.10, cacheRead: 0.07,  note: 'DeepSeek Chat' },
];

const DEFAULT_FALLBACK = { input: 1.0, output: 3.0, cacheRead: 0.1 };  // 没匹配上时用
const DEFAULT_CONFIG = { rate: 7.2, showCny: true };
const PRICING_CURRENCIES = ['USD', 'CNY'];

// ============ 读写工具 ============

function loadPricingList() {
  try {
    const raw = storage.get(PRICING_LIST_KEY);
    if (!raw) return DEFAULT_PRICING.map(x => ({ ...x }));  // 深拷贝默认
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return DEFAULT_PRICING.map(x => ({ ...x }));
    return arr;
  } catch (e) {
    console.warn('[pricing] 加载失败:', e);
    return DEFAULT_PRICING.map(x => ({ ...x }));
  }
}

function savePricingList(list) {
  try {
    storage.set(PRICING_LIST_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('[pricing] 保存失败:', e);
  }
}

function loadPricingConfig() {
  try {
    const raw = storage.get(PRICING_CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const obj = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...obj };
  } catch (e) {
    return { ...DEFAULT_CONFIG };
  }
}

function savePricingConfig(cfg) {
  try {
    storage.set(PRICING_CONFIG_KEY, JSON.stringify(cfg));
  } catch (e) {
    console.warn('[pricing] 保存配置失败:', e);
  }
}

// ============ 对外 API：tokens.js 用这个查价 ============

// 根据模型名查匹配的价格条目（关键词包含匹配）
// 返回 { input, output, cacheRead, matched, currency, ... }
//   input/output/cacheRead 始终是美元单价，用于现有费用计算。
//   matched: 命中的 key（null 表示用了 fallback）
function getPricing(modelName) {
  if (!modelName) return buildPricingResult(DEFAULT_FALLBACK, null);
  const list = loadPricingList();
  const lower = modelName.toLowerCase();
  const rate = getExchangeRate();
  // 精确度优先：先按 key 长度倒序排（更长的 key 更具体）
  const sorted = [...list].sort((a, b) => (b.key || '').length - (a.key || '').length);
  for (const p of sorted) {
    if (!p.key) continue;
    if (lower.includes(p.key.toLowerCase())) {
      return buildPricingResult(p, p.key, rate);
    }
  }
  return buildPricingResult(DEFAULT_FALLBACK, null, rate);
}

function buildPricingResult(row, matched, rate = getExchangeRate()) {
  const p = normalizePricingRow(row);
  const input = convertPricingToUsd(p.input, p.currency, rate);
  const output = convertPricingToUsd(p.output, p.currency, rate);
  const cacheRead = convertPricingToUsd(p.cacheRead, p.currency, rate);
  return {
    input,
    output,
    cacheRead,
    matched,
    currency: p.currency,
    inputCurrency: p.currency,
    outputCurrency: p.currency,
    cacheReadCurrency: p.currency,
    inputSource: parseFloat(p.input) || 0,
    outputSource: parseFloat(p.output) || 0,
    cacheReadSource: parseFloat(p.cacheRead) || 0,
    inputLabel: formatPricingForResult(input, p.input, p.currency),
    outputLabel: formatPricingForResult(output, p.output, p.currency),
    cacheReadLabel: formatPricingForResult(cacheRead, p.cacheRead, p.currency)
  };
}

// 获取汇率（USD → CNY）
function getExchangeRate() {
  return loadPricingConfig().rate || 7.2;
}

function shouldShowCny() {
  return loadPricingConfig().showCny !== false;
}

function normalizePricingCurrency(value) {
  const currency = String(value || 'USD').toUpperCase();
  return PRICING_CURRENCIES.includes(currency) ? currency : 'USD';
}

function normalizePricingRow(p) {
  const rowCurrency = inferPricingRowCurrency(p);
  return {
    ...(p || {}),
    currency: rowCurrency
  };
}

function inferPricingRowCurrency(p) {
  if (!p) return 'USD';
  if (p.currency) return normalizePricingCurrency(p.currency);
  const legacyCurrencies = [p.inputCurrency, p.outputCurrency, p.cacheReadCurrency]
    .map(normalizePricingCurrency);
  return legacyCurrencies.includes('CNY') ? 'CNY' : 'USD';
}

function convertPricingToUsd(value, currency, rate) {
  const n = parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  const normalizedCurrency = normalizePricingCurrency(currency);
  const normalizedRate = Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_CONFIG.rate;
  return normalizedCurrency === 'CNY' ? n / normalizedRate : n;
}

function formatPriceNumber(value) {
  const n = parseFloat(value);
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(6)));
}

function formatConfiguredPrice(value, currency) {
  const normalizedCurrency = normalizePricingCurrency(currency);
  const symbol = normalizedCurrency === 'CNY' ? '¥' : '$';
  return `${symbol}${formatPriceNumber(value)}`;
}

function formatPricingForResult(usdValue, sourceValue, currency) {
  const normalizedCurrency = normalizePricingCurrency(currency);
  const configured = formatConfiguredPrice(sourceValue, normalizedCurrency);
  if (normalizedCurrency === 'USD') return configured;
  return `${configured}（≈ $${formatPriceNumber(usdValue)}）`;
}

// ============ UI ============

function openPricingManager() {
  let modal = document.getElementById('pricingModal');
  if (!modal) {
    modal = _buildPricingModal();
    document.body.appendChild(modal);
  }
  renderPricingTable();
  renderPricingConfig();
  modal.classList.add('show');
}

function closePricingManager() {
  const modal = document.getElementById('pricingModal');
  if (modal) modal.classList.remove('show');
}

function _buildPricingModal() {
  const wrap = document.createElement('div');
  wrap.className = 'modal-mask pricing-modal';
  wrap.id = 'pricingModal';
  wrap.innerHTML = `
    <div class="modal wide">
      <h2>💰 定价管理 <button class="modal-close" onclick="closePricingManager()">×</button></h2>

      <div class="json-help">
        💡 在这里配置各模型的 token 单价，用于 Token 统计弹窗里的费用估算。<br>
        匹配规则：模型名只要 <strong>包含</strong> 关键词（不区分大小写），就按对应价格计算。
        每行价格可选择美元或人民币；人民币会按上方汇率换算后参与估算。
        没匹配到的模型走"未匹配默认价"（$${DEFAULT_FALLBACK.input}/$${DEFAULT_FALLBACK.output} 每 M token）。
      </div>

      <div class="pricing-section-title">
        <span>⚙️ 显示设置</span>
      </div>
      <div class="pricing-config-box">
        <label>
          <span>💱 汇率（USD → CNY）</span>
          <input type="number" id="pricingRate" step="0.01" min="0" />
        </label>
        <label style="cursor:pointer;">
          <input type="checkbox" id="pricingShowCny" />
          <span>同时显示人民币（¥）</span>
        </label>
        <button class="pricing-btn pricing-btn-primary" onclick="savePricingConfigFromUI()" style="margin-left:auto;">
          <span>💾</span><span>保存设置</span>
        </button>
      </div>

      <div class="pricing-section-title">
        <span>📋 价格表（每 1M token）</span>
        <span class="pricing-section-hint">优先级按"关键词长度"自动排序，越具体越优先</span>
      </div>

      <div class="pricing-table-wrap">
        <table class="pricing-table" id="pricingTable">
          <thead>
            <tr>
              <th style="width:22%;">模型关键词</th>
              <th style="width:12%;">单位</th>
              <th class="num" style="width:14%;">输入价 /M</th>
              <th class="num" style="width:14%;">输出价 /M</th>
              <th class="num" style="width:14%;">缓存读 /M</th>
              <th style="width:16%;">备注</th>
              <th class="act" style="width:8%;">操作</th>
            </tr>
          </thead>
          <tbody id="pricingTableBody"></tbody>
        </table>
      </div>

      <div class="pricing-toolbar">
        <button class="pricing-btn pricing-btn-primary" onclick="addPricingRow()">
          <span>➕</span><span>添加价格</span>
        </button>
        <button class="pricing-btn pricing-btn-success" onclick="savePricingListFromUI()">
          <span>💾</span><span>保存价格表</span>
        </button>
        <button class="pricing-btn" onclick="testPricingMatch()">
          <span>🔍</span><span>测试匹配</span>
        </button>
        <div class="pricing-btn-spacer"></div>
        <button class="pricing-btn pricing-btn-warning" onclick="resetPricingToDefault()">
          <span>↩</span><span>恢复默认</span>
        </button>
      </div>

      <div id="pricingTestResult" class="pricing-test-result"></div>

      <div class="modal-footer">
        <button class="btn" onclick="closePricingManager()">关闭</button>
      </div>
    </div>
  `;
  // 点击遮罩关闭
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) closePricingManager();
  });
  return wrap;
}

function renderPricingTable() {
  const tbody = document.getElementById('pricingTableBody');
  if (!tbody) return;
  const list = loadPricingList().map(normalizePricingRow);
  if (!list.length) {
    tbody.innerHTML = `<tr class="pricing-empty"><td colspan="7">暂无价格条目，点击 <strong>➕ 添加价格</strong> 或 <strong>↩ 恢复默认</strong> 开始</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map((p, i) => _renderPricingRow(p, i)).join('');
}

// 单行渲染（复用于初始 / 增 / 删后重渲）
function _renderPricingRow(p, i) {
  const row = normalizePricingRow(p);
  return `
    <tr data-idx="${i}">
      <td><input type="text"   class="pricing-input pricing-key"   value="${escapeHtml(row.key || '')}"  placeholder="如 gpt-4o" /></td>
      <td>${renderCurrencyField(row.currency)}</td>
      <td><input type="number" class="pricing-input pricing-in"    value="${formatPriceNumber(row.input)}"     step="0.001" min="0" /></td>
      <td><input type="number" class="pricing-input pricing-out"   value="${formatPriceNumber(row.output)}"    step="0.001" min="0" /></td>
      <td><input type="number" class="pricing-input pricing-cache" value="${formatPriceNumber(row.cacheRead)}" step="0.001" min="0" /></td>
      <td><input type="text"   class="pricing-input pricing-note"  value="${escapeHtml(row.note || '')}" placeholder="可选" /></td>
      <td style="text-align:center;">
        <button class="pricing-row-del" onclick="removePricingRow(${i})" title="删除此行">×</button>
      </td>
    </tr>
  `;
}

function renderCurrencyField(currency) {
  const normalizedCurrency = normalizePricingCurrency(currency);
  return `
    <div class="pricing-currency-segment" role="group" aria-label="价格单位">
      <input type="hidden" class="pricing-currency-value pricing-currency" value="${normalizedCurrency}" />
      <button type="button" class="pricing-currency-option${normalizedCurrency === 'USD' ? ' active' : ''}" aria-pressed="${normalizedCurrency === 'USD'}" onclick="setPricingCurrency(this,'USD')">USD</button>
      <button type="button" class="pricing-currency-option${normalizedCurrency === 'CNY' ? ' active' : ''}" aria-pressed="${normalizedCurrency === 'CNY'}" onclick="setPricingCurrency(this,'CNY')">CNY</button>
    </div>
  `;
}

function setPricingCurrency(btn, currency) {
  const field = btn && btn.closest('.pricing-currency-segment');
  if (!field) return;
  const normalizedCurrency = normalizePricingCurrency(currency);
  const valueEl = field.querySelector('.pricing-currency-value');
  if (valueEl) valueEl.value = normalizedCurrency;
  field.querySelectorAll('.pricing-currency-option').forEach(option => {
    const active = option.textContent.trim().toUpperCase() === normalizedCurrency;
    option.classList.toggle('active', active);
    option.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function renderPricingConfig() {
  const cfg = loadPricingConfig();
  const rateEl = document.getElementById('pricingRate');
  const showCnyEl = document.getElementById('pricingShowCny');
  if (rateEl) rateEl.value = cfg.rate;
  if (showCnyEl) showCnyEl.checked = cfg.showCny !== false;
}

// 从 UI 表格收集所有行，返回数组（不写库）
function _collectPricingFromUI(options = {}) {
  const tbody = document.getElementById('pricingTableBody');
  if (!tbody) return [];
  const includeEmpty = options.includeEmpty === true;
  const rows = tbody.querySelectorAll('tr[data-idx]');
  const out = [];
  rows.forEach(tr => {
    const key = tr.querySelector('.pricing-key').value.trim();
    const input = parseFloat(tr.querySelector('.pricing-in').value);
    const output = parseFloat(tr.querySelector('.pricing-out').value);
    const cacheRead = parseFloat(tr.querySelector('.pricing-cache').value);
    const currency = normalizePricingCurrency(tr.querySelector('.pricing-currency')?.value);
    const note = tr.querySelector('.pricing-note').value.trim();
    if (!key && !includeEmpty) return;  // 空 key 直接跳过
    out.push({
      key,
      input: isNaN(input) ? 0 : input,
      output: isNaN(output) ? 0 : output,
      cacheRead: isNaN(cacheRead) ? 0 : cacheRead,
      currency,
      note: note || undefined
    });
  });
  return out;
}

function addPricingRow() {
  // 先把当前 UI 收集到内存，加一条空行，再渲染
  const current = _collectPricingFromUI();
  current.push({ key: '', input: 0, output: 0, cacheRead: 0, currency: 'USD', note: '' });
  // 临时存到 UI 上（不入库），靠下次保存写库
  _renderListInMemory(current);
}

function removePricingRow(idx) {
  const tbody = document.getElementById('pricingTableBody');
  if (!tbody) return;
  const tr = tbody.querySelector(`tr[data-idx="${idx}"]`);
  if (tr) tr.remove();
  _renderListInMemory(_collectPricingFromUI({ includeEmpty: true }));
}

// 在不写库的前提下，用给定数组重新渲染表格
function _renderListInMemory(list) {
  const tbody = document.getElementById('pricingTableBody');
  if (!tbody) return;
  if (!list.length) {
    tbody.innerHTML = `<tr class="pricing-empty"><td colspan="7">暂无价格条目</td></tr>`;
    return;
  }
  tbody.innerHTML = list.map((p, i) => _renderPricingRow(p, i)).join('');
}

function savePricingListFromUI() {
  const list = _collectPricingFromUI();
  savePricingList(list);
  if (typeof toast === 'function') toast(`✓ 已保存 ${list.length} 条价格`);
  renderPricingTable();
}

function savePricingConfigFromUI() {
  const rateEl = document.getElementById('pricingRate');
  const showCnyEl = document.getElementById('pricingShowCny');
  const cfg = loadPricingConfig();
  const r = parseFloat(rateEl && rateEl.value);
  if (!isNaN(r) && r > 0) cfg.rate = r;
  if (showCnyEl) cfg.showCny = !!showCnyEl.checked;
  savePricingConfig(cfg);
  if (typeof toast === 'function') toast('✓ 已保存显示设置');
}

function resetPricingToDefault() {
  if (!confirm('确定恢复为默认价格表？\n\n你当前的自定义价格会被覆盖（汇率设置不受影响）。')) return;
  savePricingList(DEFAULT_PRICING.map(x => ({ ...x })));
  renderPricingTable();
  if (typeof toast === 'function') toast('↩ 已恢复默认价格');
}

function testPricingMatch() {
  const model = prompt('输入一个模型名测试匹配结果：', state.settings.currentModel || 'gpt-4o-mini');
  if (model === null) return;
  const result = getPricing(model.trim());
  const el = document.getElementById('pricingTestResult');
  if (!el) return;
  if (result.matched) {
    el.className = 'pricing-test-result show ok';
    el.innerHTML = `
      ✅ 模型 <code>${escapeHtml(model)}</code> 匹配到关键词 <code>${escapeHtml(result.matched)}</code><br>
      <span style="color:var(--text-secondary);">输入 <strong>${result.inputLabel}</strong>/M · 输出 <strong>${result.outputLabel}</strong>/M · 缓存 <strong>${result.cacheReadLabel}</strong>/M</span>
    `;
  } else {
    el.className = 'pricing-test-result show warn';
    el.innerHTML = `
      ⚠️ 模型 <code>${escapeHtml(model)}</code> 未匹配任何关键词，使用默认价<br>
      <span style="color:var(--text-secondary);">输入 <strong>${result.inputLabel}</strong>/M · 输出 <strong>${result.outputLabel}</strong>/M · 缓存 <strong>${result.cacheReadLabel}</strong>/M</span>
    `;
  }
}

// ============ 导出 ============
window.getPricing = getPricing;
window.getExchangeRate = getExchangeRate;
window.shouldShowCny = shouldShowCny;
window.openPricingManager = openPricingManager;
window.closePricingManager = closePricingManager;
window.addPricingRow = addPricingRow;
window.removePricingRow = removePricingRow;
window.savePricingListFromUI = savePricingListFromUI;
window.savePricingConfigFromUI = savePricingConfigFromUI;
window.resetPricingToDefault = resetPricingToDefault;
window.testPricingMatch = testPricingMatch;
window.setPricingCurrency = setPricingCurrency;
