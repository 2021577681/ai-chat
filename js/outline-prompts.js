// ============ 📑 大纲模式（Outline Mode · 动态规划） ============
// 【模块定位】常量与提示词模板（无副作用，无依赖）
// 单一长上下文 Agent：模型自己维护一份可变的"工作大纲"，
// 边做边改，发现新需求就追加条目，完成后给出综合回答。
// 与现有计划模式（瀑布式）并存，二选一。
//
// 本文件导出全局：OUTLINE_TOOLS、OUTLINE_TOOL_NAMES、DEFAULT_OUTLINE_SYSTEM_PROMPT
// 加载顺序：必须先于 outline-core.js 和 outline-render.js

// ============ 隐藏工具定义（不进 state.tools，仅大纲模式下注入到 tools 字段）============

const OUTLINE_TOOLS = [
  {
    name: 'save_outline',
    description: '保存或重写当前工作大纲（全量覆盖）。用于任务开始时初始化大纲，或在思路有较大调整时整体更新。每项需包含 id（如 a1、a2 等唯一标识）、title（简洁标题）、status（pending/active/done/skipped）。',
    parameters: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: '条目唯一标识，如 a1、a2、a3' },
              title: { type: 'string', description: '条目标题，简洁明了' },
              status: { type: 'string', enum: ['pending', 'active', 'done', 'skipped'], description: '当前状态' },
              note: { type: 'string', description: '附加说明或完成摘要（可选）' }
            },
            required: ['id', 'title', 'status']
          }
        }
      },
      required: ['items']
    }
  },
  {
    name: 'append_outline',
    description: '在工作大纲末尾追加一条新条目。当执行过程中发现需要补充新内容时使用。新条目 status 默认为 pending。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '新条目唯一标识' },
        title: { type: 'string', description: '条目标题' },
        note: { type: 'string', description: '附加说明（可选）' }
      },
      required: ['id', 'title']
    }
  },
  {
    name: 'update_outline',
    description: '更新工作大纲中某一条目的状态或内容。常见用法：开始处理某条时把它标为 active；完成时标为 done 并在 note 写完成摘要；跳过时标为 skipped。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '要更新的条目 id' },
        status: { type: 'string', enum: ['pending', 'active', 'done', 'skipped'], description: '新状态（可选）' },
        title: { type: 'string', description: '新标题（可选）' },
        note: { type: 'string', description: '完成摘要或备注（可选）' }
      },
      required: ['id']
    }
  }
];

const OUTLINE_TOOL_NAMES = new Set(['save_outline', 'append_outline', 'update_outline']);

const DEFAULT_OUTLINE_SYSTEM_PROMPT = `你正在协助用户完成一项工作任务。请按以下流程进行：

1. **开始时**：先调用 save_outline 工具列出工作大纲（3-8 个条目）。每个条目包含 id（如 a1、a2）、title（简洁标题）、status（初始都设为 pending）。
2. **执行过程中**：每开始处理一个新条目前，调用 update_outline 把它标记为 active；完成后调用 update_outline 标记为 done 并在 note 里写一句完成摘要。可自由使用其他工具收集信息、操作文件等。
3. **动态调整**：如发现需要补充新内容，调用 append_outline 追加；某条不再需要时，update_outline 标记为 skipped。
4. **完成时**：所有条目都标为 done 或 skipped 后，**停止调用任何工具**，直接给出最终的综合回答。

要点：
- 调用工具时不需要冗长解释，直接调用即可
- 同一时刻只让一个条目处于 active 状态
- 最终回答用 Markdown 格式，内容要完整、连贯`;

const CODE_TASK_OUTLINE_PROFILE_PROMPT = `

【代码任务工程闭环（Codex 风格验证策略）】
当任务涉及代码、测试、构建、运行、调试、报错、bug 修复、功能实现、重构、依赖、脚本或项目配置时，必须采用下面的工程闭环：

1. 初始大纲必须覆盖这些阶段：明确完成标准、探索项目结构和相关文件、定位实现/问题点、修改代码、运行最小相关验证、根据错误继续修复、最终总结。
2. 开始修改前，先用 list_notes / find_in_notes / read_note 或必要的只读命令了解相关代码、项目约定和可用验证命令，不要直接猜。
3. 明确“Done when”：用一句话记录本任务的验收标准，例如 bug 不再复现、目标功能可用、指定测试通过、或用户要求的行为已满足。
4. 修改代码优先使用 apply_patch：先 dry_run=true 预检，预检通过后 dry_run=false 应用。仅在新建完整小文件或 patch 不适合时才用 save_note / edit_note。
5. 大纲模式下调用 execute_action 必须填写 intent：只读探测填 inspect，普通运行填 run，安装依赖填 install，验证最后一次代码修改才填 verify。代码修改后必须调用 execute_action 运行**一个最相关、最小充分**的验证命令，并设置 intent=verify、verifyTarget 和 verifyReason；优先选择用户指定命令、复现命令、受影响文件/模块的测试、直接运行目标脚本的自测、doctest/smoke test、或项目约定的最小 lint/typecheck/build 检查。--version、-v、--help、help、--print-config、环境探测或配置打印命令只能用于了解环境，必须用 intent=inspect，不能算作代码验证通过。
6. 不要为了“更保险”主动扩展到大量无关测试、全量测试矩阵、长时间构建、启动检查、lint 或 typecheck；只有用户明确要求、最小验证失败、改动影响面明显很大、或最小验证无法覆盖核心风险时，才追加第二个验证命令。门禁只要求“最后一次代码修改后有一个相关验证通过”，不是要求升级到 lint/typecheck。
7. 如果一个相关的 doctest、最小复现、直接运行目标脚本的自测、smoke test、目标模块测试或用户指定验证已经通过，且之后没有再修改代码，并且 Done when 已满足，应立即停止继续调用工具，直接给出最终回答；不要因为门禁、谨慎或不确定而重复验证或寻找更多测试命令。
8. 如果验证命令失败，必须读取 stdout/stderr，继续修改代码，然后重新运行与最新改动最相关的最小验证命令；不要在失败后直接总结为完成。
9. 如果在验证之后又修改了代码，必须重新运行最小相关验证；只有最新代码修改后的验证通过，或因为缺依赖、缺配置、缺权限、环境限制等明确阻塞且已说明原因时，才允许最终总结。
10. 最终回答必须包含：Done when 是否满足、改了什么、运行了什么验证命令、验证结果、仍需注意的问题。`;

const DEFAULT_OUTLINE_CLASSIFIER_PROMPT = `你是任务分流器。请判断用户任务是否需要代码修改和验证。严格只输出 JSON，不要代码块或解释。

字段：
{
  "domain": "coding|research|writing|file_ops|general",
  "intent": "read_only|code_change|debug|test_only|explain|other",
  "requiresCodeChange": true/false,
  "requiresVerification": true/false,
  "verificationPolicy": "none|if_code_changed|after_each_code_change",
  "suggestedCommands": ["可选验证命令"],
  "confidence": 0到1,
  "reason": "一句话理由"
}

判断规则：
- 解释概念、写作、总结、资料查询通常不需要代码验证。
- 只读代码/解释项目可以 domain=coding，但 requiresCodeChange=false，requiresVerification=false。
- 修 bug、实现功能、改代码、调测试、改配置、改依赖时 requiresCodeChange=true，requiresVerification=true。
- 如果不确定是否会改代码，但任务目标明显是修复/实现/调试，requiresVerification=true；运行时只有实际改代码后才会强制验证。
- suggestedCommands 只给明显可能相关的命令，不要编造太具体的脚本名。`;

const DEFAULT_OUTLINE_BUDGET_HALF_PROMPT = '【系统提示】执行预算已过半，当前剩余 {{remaining}} 轮。请合理规划，对仍 pending 的条目评估优先级。';
const DEFAULT_OUTLINE_BUDGET_LOW_PROMPT = '⚠️【系统警告】仅剩 {{remaining}} 轮执行预算！请加快进度，对非关键的 pending 条目用 update_outline 标记为 skipped，集中完成核心内容。';
const DEFAULT_OUTLINE_BUDGET_CRITICAL_PROMPT = '🚨【系统紧急】只剩 {{remaining}} 轮！请立即开始收尾：把所有未完成条目标记为 done 或 skipped，下一轮请不要再调用任何工具，直接给出完整的 Markdown 格式最终答案。';

const DEFAULT_OUTLINE_GATE_NO_VERIFY_PROMPT = '【系统门禁】这是代码任务，且你已经修改过代码，但还没有在最后一次修改后运行任何相关验证。不要最终总结。请调用 execute_action 运行一个最小相关验证命令，并设置 intent=verify、verifyTarget 和 verifyReason。例如用户指定验证、最小复现、直接运行目标脚本的自测、doctest、smoke test、目标模块测试、lint/typecheck/build 中最相关的一种；不要因为门禁而升级到无关的 lint/typecheck 或重复多次验证。如果确实无法运行，必须调用 update_outline 记录阻塞原因。';
const DEFAULT_OUTLINE_GATE_STALE_VERIFY_PROMPT = '【系统门禁】你在上一次验证之后又修改了代码，但还没有重新验证。不要最终总结。请调用 execute_action 运行一个与最新改动相关的最小验证，并设置 intent=verify、verifyTarget 和 verifyReason；如果相关 doctest、最小复现、直接运行目标脚本的自测、smoke test 或目标模块测试通过，就停止继续验证并总结，不要额外升级到 lint/typecheck。如果确实无法运行，必须调用 update_outline 记录阻塞原因。';
const DEFAULT_OUTLINE_GATE_FAILED_VERIFY_PROMPT = '【系统门禁】最新代码修改后的验证命令没有通过（退出码 {{returncode}}）。不要最终总结。请读取 stdout/stderr，继续修复后再次运行一个最小相关验证命令，并设置 intent=verify、verifyTarget 和 verifyReason；如果失败是环境/依赖/权限阻塞，必须调用 update_outline 明确记录阻塞原因。';

const DEFAULT_OUTLINE_FORCE_FINAL_SYSTEM_PROMPT = `【最终阶段·强制收尾】你已达到执行轮数上限。请基于上面所有已收集的信息和工具结果，直接给出完整的 Markdown 格式最终答案。不要再调用任何工具。如有未完成的条目，可在答案末尾用"⚠️ 受限说明"小节简要说明。`;
const DEFAULT_OUTLINE_FORCE_FINAL_USER_PROMPT = '请立即基于已有信息给出完整的最终回答（Markdown 格式）。不要再调用任何工具。';

const DEFAULT_OUTLINE_USER_INJECTION_PROMPT = `【用户中途留言】{{message}}

请根据这条留言调整后续工作。`;
const DEFAULT_OUTLINE_FRESH_TASK_PROMPT = `【系统提示·全新大纲任务】
这是本对话中的一次全新的大纲模式任务，用户最新请求是：
{{question}}

请不要继承、继续或复用本对话中任何旧的大纲、旧执行过程、旧 pending/active 条目、旧门禁状态或旧恢复状态。旧内容只能作为历史背景参考。
本次任务必须重新从 save_outline 开始，为用户最新请求创建新的工作大纲。`;
const DEFAULT_OUTLINE_REQUIRE_START_PROMPT = '【系统提示】本次是新的大纲模式任务，但你还没有创建本次任务的大纲。不要直接最终回答。请立即调用 save_outline，为用户最新请求创建 3-8 个 pending 条目，然后按大纲继续执行。';
const DEFAULT_OUTLINE_TOOL_REJECT_STOP_PROMPT = '【系统提示】用户拒绝了该工具操作，并要求停止所有后续工具调用。请不要再调用工具，基于已完成内容直接给出简短说明。';
const DEFAULT_OUTLINE_TOOL_REJECT_ONCE_PROMPT = '【系统提示】用户拒绝了该工具操作。请不要重复同一操作；如任务还能继续，请改用无需该权限的路径，否则直接说明受限情况。';
const DEFAULT_OUTLINE_STALLED_PROMPT = '【系统提示】你似乎在原地踏步，请重新评估当前进展。如果信息已足够，请直接给出最终答案并停止调用工具；如果仍需推进，请明确下一步行动。';

function outlineTemplate(template, vars = {}) {
  return String(template == null ? '' : template).replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = vars[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function outlinePromptSetting(key, fallback) {
  if (typeof state === 'undefined' || !state.settings) return fallback;
  const value = state.settings[key];
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function outlinePromptText(key, fallback, vars = {}) {
  return outlineTemplate(outlinePromptSetting(key, fallback), vars);
}
