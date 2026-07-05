// ============ 📚 论文工具实现 ============
// 提供多个学术工具，由 config.js 中 BUILTIN_TOOLS 的 code 字段调用：
//   - arxivSearch        → arxiv_search
//   - semanticScholarSearch → semantic_scholar_search
//   - dblpSearch         → dblp_search
//   - openAlexSearch     → openalex_search
//   - crossrefSearch     → crossref_search
//   - fetchPdfText       → fetch_pdf_text
//
// 设计要点：
//   - arXiv 和 Semantic Scholar 均允许 CORS，优先浏览器直连
//   - 直连失败（CORS/网络）时 fallback 到本地后端代理（callAgentBackend 的 fetch_url）
//   - PDF 解析使用 pdf.js（CDN 懒加载），首次调用约 300KB 流量，之后缓存
//   - 全部异步，不阻塞 UI

// -------- 工具：直连 fetch 失败时回退到本地代理 --------
async function _paperFetch(url, opts) {
  // 1) 先尝试浏览器直连
  try {
    const resp = await fetch(url, opts || {});
    if (resp.ok) return { ok: true, text: await resp.text(), status: resp.status, via: 'direct' };
    // 4xx/5xx 直接返回，不走代理（代理也会拿到同样错误）
    return { ok: false, error: `HTTP ${resp.status}`, status: resp.status, via: 'direct' };
  } catch (e) {
    // 2) CORS/网络错误，尝试走本地后端的 fetch_url 代理
    if (typeof callAgentBackend === 'function') {
      try {
        const r = await callAgentBackend('fetch_url', {
          url,
          extract_text: false,
          max_chars: 50000
        });
        if (r && r.ok) {
          return { ok: true, text: r.content || '', status: r.status || 200, via: 'proxy' };
        }
        return { ok: false, error: (r && r.error) || '代理失败', via: 'proxy-fail' };
      } catch (e2) {
        return { ok: false, error: e2.message, via: 'proxy-error' };
      }
    }
    return { ok: false, error: e.message, via: 'direct-error' };
  }
}

// =================================================================
// 工具 1：arxiv_search —— 用 arXiv 官方 API 查论文
// =================================================================
async function arxivSearch(query, maxResults, sortBy) {
  if (!query || !query.trim()) return '❌ 缺少查询关键词';
  const n = Math.max(1, Math.min(20, parseInt(maxResults) || 8));
  const sort = (sortBy === 'submittedDate') ? 'submittedDate' : 'relevance';

  // arXiv API 文档：http://export.arxiv.org/help/api/user-manual
  const url = `http://export.arxiv.org/api/query?search_query=${encodeURIComponent('all:' + query)}&start=0&max_results=${n}&sortBy=${sort}&sortOrder=descending`;

  const r = await _paperFetch(url);
  if (!r.ok) return `❌ arXiv 请求失败：${r.error}`;

  // 解析 Atom XML
  let entries;
  try {
    const doc = new DOMParser().parseFromString(r.text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('XML 解析失败');
    entries = Array.from(doc.getElementsByTagName('entry'));
  } catch (e) {
    return `❌ 解析响应失败：${e.message}\n\n响应预览：\n${r.text.slice(0, 500)}`;
  }

  if (!entries.length) return `🔍 arXiv 未找到与 "${query}" 相关的论文`;

  const get = (entry, tag) => {
    const el = entry.getElementsByTagName(tag)[0];
    return el ? (el.textContent || '').trim().replace(/\s+/g, ' ') : '';
  };

  let output = `📚 arXiv 搜索 "${query}"（共 ${entries.length} 条，按${sort === 'submittedDate' ? '日期' : '相关度'}排序）：\n\n`;
  entries.forEach((e, i) => {
    const title = get(e, 'title');
    const summary = get(e, 'summary');
    const published = get(e, 'published').slice(0, 10);
    const id = get(e, 'id'); // 形如 http://arxiv.org/abs/2305.12345v1
    const authors = Array.from(e.getElementsByTagName('author'))
      .map(a => (a.getElementsByTagName('name')[0]?.textContent || '').trim())
      .filter(Boolean)
      .join(', ');
    // 取 PDF 链接
    const pdfLink = Array.from(e.getElementsByTagName('link'))
      .find(l => l.getAttribute('title') === 'pdf');
    const pdfUrl = pdfLink ? pdfLink.getAttribute('href') : id.replace('/abs/', '/pdf/');

    output += `${i + 1}. **${title}**\n`;
    output += `   👥 作者：${authors || '未知'}\n`;
    output += `   📅 发表：${published}\n`;
    output += `   🔗 摘要页：${id}\n`;
    output += `   📄 PDF：${pdfUrl}\n`;
    output += `   📝 摘要：${summary.slice(0, 350)}${summary.length > 350 ? '...' : ''}\n\n`;
  });
  return output;
}

// =================================================================
// 工具 2：semantic_scholar_search —— 用 Semantic Scholar API 查论文
// =================================================================
async function semanticScholarSearch(query, maxResults, year) {
  if (!query || !query.trim()) return '❌ 缺少查询关键词';
  const n = Math.max(1, Math.min(20, parseInt(maxResults) || 8));

  const params = new URLSearchParams({
    query: query,
    limit: String(n),
    fields: 'title,authors,year,abstract,citationCount,venue,externalIds,openAccessPdf'
  });
  if (year && /^\d{4}(-\d{4})?$/.test(String(year))) {
    params.set('year', String(year));
  }
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?${params.toString()}`;

  const r = await _paperFetch(url);
  if (!r.ok) return `❌ Semantic Scholar 请求失败：${r.error}${r.status === 429 ? '\n（API 限速：未授权用户 100 次 / 5 分钟，请稍候）' : ''}`;

  let data;
  try { data = JSON.parse(r.text); } catch (e) {
    return `❌ 解析 JSON 失败：${e.message}\n\n响应预览：\n${r.text.slice(0, 500)}`;
  }
  const papers = data.data || [];
  if (!papers.length) return `🔍 Semantic Scholar 未找到与 "${query}" 相关的论文`;

  let output = `🎓 Semantic Scholar 搜索 "${query}"（共 ${papers.length} 条${year ? '，年份 ' + year : ''}）：\n\n`;
  papers.forEach((p, i) => {
    const authors = (p.authors || []).map(a => a.name).slice(0, 5).join(', ');
    const moreAuth = (p.authors || []).length > 5 ? ` 等 ${p.authors.length} 人` : '';
    const arxiv = p.externalIds && p.externalIds.ArXiv;
    const doi = p.externalIds && p.externalIds.DOI;
    const pdf = p.openAccessPdf && p.openAccessPdf.url;
    const abs = (p.abstract || '').replace(/\s+/g, ' ');

    output += `${i + 1}. **${p.title || '（无标题）'}**\n`;
    output += `   👥 作者：${authors || '未知'}${moreAuth}\n`;
    output += `   📅 年份：${p.year || '?'}　📊 引用：${p.citationCount ?? '?'}　📖 期刊/会议：${p.venue || '?'}\n`;
    if (arxiv) output += `   🆔 arXiv：${arxiv}（https://arxiv.org/abs/${arxiv}）\n`;
    if (doi) output += `   🆔 DOI：${doi}\n`;
    if (pdf) output += `   📄 开放 PDF：${pdf}\n`;
    output += `   📝 摘要：${abs ? abs.slice(0, 350) + (abs.length > 350 ? '...' : '') : '（暂无）'}\n\n`;
  });
  return output;
}

// =================================================================
// 工具 3：dblp_search —— 用 DBLP 检索计算机领域论文元数据
// =================================================================
async function dblpSearch(query, maxResults, year) {
  if (!query || !query.trim()) return '❌ 缺少查询关键词';
  const n = Math.max(1, Math.min(20, parseInt(maxResults) || 8));
  const yearFilter = year && /^\d{4}$/.test(String(year)) ? String(year) : '';

  const params = new URLSearchParams({
    q: query,
    h: String(n),
    format: 'json'
  });
  const url = `https://dblp.org/search/publ/api?${params.toString()}`;

  const r = await _paperFetch(url);
  if (!r.ok) return `❌ DBLP 请求失败：${r.error}`;

  let data;
  try { data = JSON.parse(r.text); } catch (e) {
    return `❌ 解析 DBLP JSON 失败：${e.message}\n\n响应预览：\n${r.text.slice(0, 500)}`;
  }

  let hits = data && data.result && data.result.hits && data.result.hits.hit;
  if (!Array.isArray(hits)) hits = hits ? [hits] : [];
  if (yearFilter) hits = hits.filter(h => String(h && h.info && h.info.year || '') === yearFilter);
  if (!hits.length) return `🔍 DBLP 未找到与 "${query}" 相关的论文${yearFilter ? '（年份 ' + yearFilter + '）' : ''}`;

  let output = `🧮 DBLP 搜索 "${query}"（${hits.length} 条${yearFilter ? '，年份 ' + yearFilter : ''}）：\n\n`;
  hits.slice(0, n).forEach((h, i) => {
    const info = h.info || {};
    const authorsRaw = info.authors && info.authors.author;
    const authors = (Array.isArray(authorsRaw) ? authorsRaw : (authorsRaw ? [authorsRaw] : []))
      .map(a => typeof a === 'string' ? a : (a && a.text))
      .filter(Boolean);
    const venue = info.venue || info.booktitle || info.journal || '';
    const pages = info.pages ? `，页码：${info.pages}` : '';
    output += `${i + 1}. **${info.title || '（无标题）'}**\n`;
    output += `   👥 作者：${authors.slice(0, 6).join(', ') || '未知'}${authors.length > 6 ? ' 等 ' + authors.length + ' 人' : ''}\n`;
    output += `   📅 年份：${info.year || '?'}　📖  venue：${venue || '?'}${pages}\n`;
    if (info.type) output += `   🧾 类型：${info.type}\n`;
    if (info.doi) output += `   🆔 DOI：${info.doi}\n`;
    if (info.ee) output += `   🔗 出版链接：${Array.isArray(info.ee) ? info.ee[0] : info.ee}\n`;
    if (info.url) output += `   📚 DBLP：https://dblp.org/${info.url}\n`;
    output += '\n';
  });
  return output;
}

// =================================================================
// 工具 4：openalex_search —— 用 OpenAlex 检索跨学科开放论文元数据
// =================================================================
function _openAlexAbstractFromInvertedIndex(index) {
  if (!index || typeof index !== 'object') return '';
  const pairs = [];
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) pairs.push([Number(pos), word]);
  }
  if (!pairs.length) return '';
  pairs.sort((a, b) => a[0] - b[0]);
  return pairs.map(x => x[1]).join(' ');
}

async function openAlexSearch(query, maxResults, year, sortBy) {
  if (!query || !query.trim()) return '❌ 缺少查询关键词';
  const n = Math.max(1, Math.min(20, parseInt(maxResults) || 8));
  const params = new URLSearchParams({
    search: query,
    'per-page': String(n)
  });
  const sort = sortBy === 'cited_by_count' ? 'cited_by_count:desc' : 'relevance_score:desc';
  params.set('sort', sort);
  if (year && /^\d{4}$/.test(String(year))) params.set('filter', `publication_year:${year}`);
  const url = `https://api.openalex.org/works?${params.toString()}`;

  const r = await _paperFetch(url);
  if (!r.ok) return `❌ OpenAlex 请求失败：${r.error}`;

  let data;
  try { data = JSON.parse(r.text); } catch (e) {
    return `❌ 解析 OpenAlex JSON 失败：${e.message}\n\n响应预览：\n${r.text.slice(0, 500)}`;
  }
  const works = data.results || [];
  if (!works.length) return `🔍 OpenAlex 未找到与 "${query}" 相关的论文`;

  let output = `🌐 OpenAlex 搜索 "${query}"（${works.length} 条，按${sortBy === 'cited_by_count' ? '引用数' : '相关度'}排序）：\n\n`;
  works.forEach((w, i) => {
    const authors = (w.authorships || [])
      .map(a => a.author && a.author.display_name)
      .filter(Boolean);
    const venue = w.primary_location && w.primary_location.source && w.primary_location.source.display_name;
    const doi = w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, '') : '';
    const pdf = w.open_access && w.open_access.oa_url;
    const abs = _openAlexAbstractFromInvertedIndex(w.abstract_inverted_index);
    output += `${i + 1}. **${w.display_name || '（无标题）'}**\n`;
    output += `   👥 作者：${authors.slice(0, 6).join(', ') || '未知'}${authors.length > 6 ? ' 等 ' + authors.length + ' 人' : ''}\n`;
    output += `   📅 年份：${w.publication_year || '?'}　📊 引用：${w.cited_by_count ?? '?'}　📖 来源：${venue || '?'}\n`;
    if (doi) output += `   🆔 DOI：${doi}\n`;
    if (pdf) output += `   📄 开放链接：${pdf}\n`;
    if (w.id) output += `   🔗 OpenAlex：${w.id}\n`;
    output += `   📝 摘要：${abs ? abs.slice(0, 350) + (abs.length > 350 ? '...' : '') : '（暂无）'}\n\n`;
  });
  return output;
}

// =================================================================
// 工具 5：crossref_search —— 用 Crossref 检索 DOI 和出版元数据
// =================================================================
function _crossrefDate(item) {
  const candidates = [
    item && item.published && item.published['date-parts'],
    item && item['published-print'] && item['published-print']['date-parts'],
    item && item['published-online'] && item['published-online']['date-parts'],
    item && item.created && item.created['date-parts']
  ];
  for (const parts of candidates) {
    if (Array.isArray(parts) && Array.isArray(parts[0])) {
      return parts[0].filter(Boolean).join('-');
    }
  }
  return '';
}

async function crossrefSearch(query, maxResults, year) {
  if (!query || !query.trim()) return '❌ 缺少查询关键词';
  const n = Math.max(1, Math.min(20, parseInt(maxResults) || 8));
  const params = new URLSearchParams({
    query,
    rows: String(n),
    sort: 'score',
    order: 'desc'
  });
  if (year && /^\d{4}$/.test(String(year))) {
    params.set('filter', `from-pub-date:${year}-01-01,until-pub-date:${year}-12-31`);
  }
  const url = `https://api.crossref.org/works?${params.toString()}`;

  const r = await _paperFetch(url);
  if (!r.ok) return `❌ Crossref 请求失败：${r.error}`;

  let data;
  try { data = JSON.parse(r.text); } catch (e) {
    return `❌ 解析 Crossref JSON 失败：${e.message}\n\n响应预览：\n${r.text.slice(0, 500)}`;
  }
  const items = data && data.message && data.message.items || [];
  if (!items.length) return `🔍 Crossref 未找到与 "${query}" 相关的出版物`;

  let output = `🔎 Crossref 搜索 "${query}"（${items.length} 条${year ? '，年份 ' + year : ''}）：\n\n`;
  items.forEach((p, i) => {
    const title = Array.isArray(p.title) ? p.title[0] : p.title;
    const container = Array.isArray(p['container-title']) ? p['container-title'][0] : p['container-title'];
    const authors = (p.author || [])
      .map(a => [a.given, a.family].filter(Boolean).join(' '))
      .filter(Boolean);
    const doi = p.DOI || '';
    output += `${i + 1}. **${title || '（无标题）'}**\n`;
    output += `   👥 作者：${authors.slice(0, 6).join(', ') || '未知'}${authors.length > 6 ? ' 等 ' + authors.length + ' 人' : ''}\n`;
    output += `   📅 日期：${_crossrefDate(p) || '?'}　📖 来源：${container || '?'}　🧾 类型：${p.type || '?'}\n`;
    if (doi) output += `   🆔 DOI：${doi}\n   🔗 DOI 链接：https://doi.org/${doi}\n`;
    if (p.URL) output += `   🌍 Crossref URL：${p.URL}\n`;
    output += '\n';
  });
  return output;
}

// =================================================================
// 工具 6：fetch_pdf_text —— 用 pdf.js 把 PDF 转成文本
// =================================================================
let _pdfJsLoading = null;
// 多 CDN 列表，按顺序尝试。前面失败自动回退到下一个。
// 优先使用国内可达性好的（jsdelivr / unpkg / npmmirror），最后才是 cdnjs
const _PDFJS_CDNS = [
  // jsDelivr —— 国内 CDN 节点多，速度快
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build',
  // npmmirror（国内）—— 完全境内，最稳
  'https://registry.npmmirror.com/pdfjs-dist/4.0.379/files/build',
  // unpkg
  'https://unpkg.com/pdfjs-dist@4.0.379/build',
  // cdnjs（境外，国内可能不稳）
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.0.379'
];

function _loadScript(src, timeoutMs) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      s.remove();
      reject(new Error('加载超时'));
    }, timeoutMs || 8000);
    s.onload = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    s.onerror = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      s.remove();
      reject(new Error('脚本加载失败'));
    };
    document.head.appendChild(s);
  });
}

async function _ensurePdfJs() {
  if (typeof window.pdfjsLib !== 'undefined') return window.pdfjsLib;
  if (_pdfJsLoading) return _pdfJsLoading;

  _pdfJsLoading = (async () => {
    const errors = [];
    for (const base of _PDFJS_CDNS) {
      try {
        // cdnjs 的目录结构不同：是 pdf.min.js（无 build 后缀），其他 CDN 是 build/pdf.min.js
        // 但我们上面已把 cdnjs 的路径写到 .../4.0.379（无 /build），所以两边路径方式一致
        // 实际：cdnjs 直接放 pdf.min.js；jsdelivr/unpkg/npmmirror 放在 build/pdf.min.js
        // 这里统一用 ${base}/pdf.min.js，cdnjs 已含路径
        await _loadScript(`${base}/pdf.min.js`, 10000);
        const lib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
        if (!lib) {
          errors.push(`${base}: 脚本加载后未挂载 pdfjsLib`);
          continue;
        }
        lib.GlobalWorkerOptions.workerSrc = `${base}/pdf.worker.min.js`;
        window.pdfjsLib = lib;
        console.log('[pdf.js] 成功从 CDN 加载：', base);
        return lib;
      } catch (e) {
        errors.push(`${base}: ${e.message}`);
        // 继续尝试下一个
      }
    }
    // 全部失败
    throw new Error('所有 CDN 均不可达：\n' + errors.map(x => '  • ' + x).join('\n'));
  })();

  // 失败时清空缓存，允许重试
  _pdfJsLoading.catch(() => { _pdfJsLoading = null; });
  return _pdfJsLoading;
}

async function fetchPdfText(url, maxPages, maxChars) {
  if (!url || !/^https?:\/\//.test(url)) return '❌ url 必须以 http:// 或 https:// 开头';
  const pageLimit = Math.max(1, Math.min(100, parseInt(maxPages) || 20));
  const charLimit = Math.max(500, Math.min(80000, parseInt(maxChars) || 20000));

  // 1) 加载 pdf.js
  let pdfjsLib;
  try { pdfjsLib = await _ensurePdfJs(); }
  catch (e) { return `❌ pdf.js 加载失败：${e.message}`; }

  // 2) 下载 PDF 二进制（直连，arXiv 等支持 CORS）
  let pdfData;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    pdfData = await resp.arrayBuffer();
  } catch (e) {
    // CORS/网络失败 → 提示用户（PDF 二进制不适合走文本代理）
    return `❌ PDF 下载失败：${e.message}\n` +
      `提示：如果是 CORS 错误，请尝试：\n` +
      `  1. 用 arXiv 链接（https://arxiv.org/pdf/...）通常允许跨域\n` +
      `  2. 或先用 fetch_url 工具确认 URL 可达`;
  }

  // 3) 解析 PDF
  let pdf;
  try {
    pdf = await pdfjsLib.getDocument({ data: pdfData, disableWorker: false }).promise;
  } catch (e) {
    return `❌ PDF 解析失败：${e.message}`;
  }

  const totalPages = pdf.numPages;
  const pagesToRead = Math.min(totalPages, pageLimit);
  let allText = '';
  for (let i = 1; i <= pagesToRead; i++) {
    try {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      const pageText = tc.items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
      allText += `\n\n--- 第 ${i} 页 ---\n${pageText}`;
      if (allText.length >= charLimit) {
        allText = allText.slice(0, charLimit);
        break;
      }
    } catch (e) {
      allText += `\n\n--- 第 ${i} 页（提取失败：${e.message}）---`;
    }
  }

  let header = `📄 PDF 全文提取\n🔗 URL：${url}\n📊 总页数：${totalPages}，已读：${pagesToRead}\n📝 字符数：${allText.length}`;
  if (allText.length >= charLimit) header += `（已截断到 ${charLimit} 字符）`;
  return header + '\n' + allText;
}

// ============ 暴露到全局，供 BUILTIN_TOOLS code 字段调用 ============
window.arxivSearch = arxivSearch;
window.semanticScholarSearch = semanticScholarSearch;
window.dblpSearch = dblpSearch;
window.openAlexSearch = openAlexSearch;
window.crossrefSearch = crossrefSearch;
window.fetchPdfText = fetchPdfText;

window.AgentApp.define('paperTools', {
  arxivSearch,
  semanticScholarSearch,
  dblpSearch,
  openAlexSearch,
  crossrefSearch,
  fetchPdfText
});
