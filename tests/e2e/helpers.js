const { expect } = require('@playwright/test');

const APP_PATH = '/AI-Chat-%E5%A4%A7%E6%A8%A1%E5%9E%8B%E5%AF%B9%E8%AF%9D%E5%8A%A9%E6%89%8B.html';
const MOCK_API_BASE = 'http://127.0.0.1:4173/mock-api';
const MOCK_WORKSPACE = 'C:\\e2e-workspace';
const MOCK_LMS_COOKIE = 'session=mock.eyJ1aWQiOiJlMmUifQ.4102444800000;';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': '*',
      ...extraHeaders
    },
    body: JSON.stringify(body)
  };
}

function textResponse(body, status = 200, contentType = 'text/plain') {
  return {
    status,
    headers: {
      'content-type': contentType,
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': '*'
    },
    body
  };
}

async function requestJson(request) {
  try {
    return request.postDataJSON();
  } catch (_) {
    try {
      return JSON.parse(request.postData() || '{}');
    } catch (e) {
      return {};
    }
  }
}

function extractLastUserText(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || msg.role !== 'user') continue;
    if (typeof msg.content === 'string') return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .map(part => (part && typeof part.text === 'string') ? part.text : '')
        .filter(Boolean)
        .join('\n');
    }
  }
  if (typeof body.input === 'string') return body.input;
  if (Array.isArray(body.input)) {
    return body.input.map(item => item.content || item.text || '').join('\n');
  }
  return '';
}

async function fulfillSafely(route, response) {
  try {
    await route.fulfill(response);
  } catch (e) {
    // The page may abort slow mocked requests when the user clicks stop.
  }
}

function makeOpenAiResponse(body, callNumber, replyPrefix) {
  const structured = makeStructuredMockContent(body);
  const userText = extractLastUserText(body);
  const reply = structured || `${replyPrefix || 'Mock reply'} #${callNumber}: ${userText || 'empty request'}`;
  return {
    id: `chatcmpl-e2e-${callNumber}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: body.model || 'mock-model',
    choices: [
      {
        index: 0,
        finish_reason: 'stop',
        message: {
          role: 'assistant',
          content: reply
        }
      }
    ],
    usage: {
      prompt_tokens: 12,
      completion_tokens: 6,
      total_tokens: 18
    }
  };
}

function serializeRequestText(body) {
  const chunks = [];
  const push = value => {
    if (!value) return;
    if (typeof value === 'string') {
      chunks.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    if (typeof value === 'object') {
      if (typeof value.content === 'string') chunks.push(value.content);
      else if (value.content) push(value.content);
      if (typeof value.text === 'string') chunks.push(value.text);
    }
  };
  push(body.messages);
  push(body.input);
  push(body.system);
  push(body.instructions);
  push(body.prompt);
  return chunks.join('\n');
}

function makeStructuredMockContent(body) {
  const text = serializeRequestText(body);

  if (text.includes('"winner":"pro"|"con"')
    || (text.includes('winnerReason') && text.includes('loserReason'))
    || /终审|获胜一方|根据本局双方|final judge/i.test(text)) {
    return JSON.stringify({
      winner: 'pro',
      winnerReason: 'Mock final judge picked the pro side based on clearer claims.',
      loserReason: 'Mock final judge found the con side less specific.'
    });
  }

  if (text.includes('"pass":true|false')
    || text.includes('"pass": true|false')
    || /请审核当前发言是否通过|当前发言方|当前发言类型|辩论赛评委/.test(text)) {
    return JSON.stringify({
      pass: false,
      reason: 'Mock judge requests manual review for this speech.'
    });
  }

  if (text.includes('"tasks"') && text.includes('dependsOn') && text.includes('exposeOutput')) {
    return JSON.stringify({
      tasks: [
        {
          text: 'E2E scheduled research task with explicit acceptance criteria',
          order: 1,
          dependsOn: [],
          mode: 'normal',
          useTools: false,
          exposeOutput: true
        },
        {
          text: 'E2E scheduled implementation task depending on the research output',
          order: 2,
          dependsOn: [1],
          mode: 'normal',
          useTools: false,
          exposeOutput: false
        },
        {
          text: 'E2E scheduled independent review task',
          order: 1,
          dependsOn: [],
          mode: 'reflection',
          useTools: false,
          exposeOutput: false
        }
      ]
    });
  }

  if (text.includes('"taskNo"') && text.includes('"evidence"') && text.includes('"warnings"')) {
    return JSON.stringify({
      taskNo: '#1',
      taskId: 'mock-task',
      title: 'Mock output package',
      status: 'done',
      summary: 'Mock structured summary generated for a completed task queue item.',
      result: 'Mock structured result that downstream task queue items can reference.',
      evidence: ['Mock evidence from the assistant answer.'],
      warnings: []
    });
  }

  if (text.includes('artifact_id') && text.includes('checkpoint_id') && text.includes('read_tool_artifact')) {
    return [
      '## 当前任务',
      'E2E mocked compression summary for the current task.',
      '',
      '## 用户目标和约束',
      'Keep enough context to continue without real API calls.',
      '',
      '## 已完成事项',
      'The earlier conversation has been summarized by the mock provider.',
      '',
      '## 关键决策和事实',
      'No external credentials or live services were used.',
      '',
      '## 已查看或修改的文件',
      'No required file references were present in the compressed slice.',
      '',
      '## 工具/命令结果',
      'No archived tool artifact is required for this E2E summary.',
      '',
      '## 计划/大纲状态',
      'No active plan or outline state is required.',
      '',
      '## 测试和验证状态',
      'Compression flow was exercised with a structured mock response.',
      '',
      '## 未完成事项',
      'Continue with the latest user request.',
      '',
      '## 风险/阻塞',
      'No blocker in the mocked E2E path.',
      '',
      '## 下一步建议',
      'Proceed with the next interaction.',
      '',
      '## 可丢弃上下文',
      'Detailed earlier chat wording can be discarded for this test.'
    ].join('\n');
  }

  return null;
}

function makeOpenAiStream(body, callNumber, replyPrefix) {
  const structured = makeStructuredMockContent(body);
  const userText = extractLastUserText(body);
  const reply = structured || `${replyPrefix || 'Mock stream'} #${callNumber}: ${userText || 'empty request'}`;
  const chunks = [reply.slice(0, Math.ceil(reply.length / 2)), reply.slice(Math.ceil(reply.length / 2))];
  return chunks
    .map(content => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`)
    .join('') + 'data: [DONE]\n\n';
}

function daysFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function mockGitPayload(body = {}, state = {}) {
  const subcommand = body.subcommand || '';
  if (typeof state.gitInitialized !== 'boolean') state.gitInitialized = true;
  const status = {
    ok: true,
    branch: 'main',
    clean: false,
    ahead: 1,
    behind: 0,
    staged: [{ path: 'js/security-records.js', status: 'M' }],
    unstaged: [{ path: 'js/pricing.js', status: 'M' }],
    untracked: [{ path: 'docs/e2e-notes.md', status: '?' }]
  };
  const commits = [
    {
      hash: '1111111111111111111111111111111111111111',
      shortHash: '1111111',
      subject: 'E2E mock commit',
      author: 'E2E User',
      ts: Math.floor(Date.now() / 1000) - 1800
    },
    {
      hash: '0000000000000000000000000000000000000000',
      shortHash: '0000000',
      subject: 'Initial mock commit',
      author: 'E2E User',
      ts: Math.floor(Date.now() / 1000) - 7200
    }
  ];

  switch (subcommand) {
    case 'check':
      return {
        ok: true,
        gitInstalled: true,
        inRepo: state.gitInitialized,
        isRepo: state.gitInitialized,
        branch: 'main',
        userName: 'E2E User',
        userEmail: 'e2e@example.test'
      };
    case 'init':
      state.gitInitialized = true;
      return { ok: true, output: 'mock git init completed' };
    case 'status':
      return status;
    case 'log':
      return { ok: true, commits, commitCount: commits.length };
    case 'reflog':
      return {
        ok: true,
        origHead: commits[1].hash,
        entries: [
          {
            hash: commits[0].hash,
            shortHash: commits[0].shortHash,
            selector: 'HEAD@{0}',
            subject: 'commit: E2E mock commit',
            date: new Date().toISOString()
          }
        ]
      };
    case 'diff':
      return {
        ok: true,
        diff: [
          'diff --git a/js/pricing.js b/js/pricing.js',
          '--- a/js/pricing.js',
          '+++ b/js/pricing.js',
          '@@ -1,2 +1,2 @@',
          '-old mock line',
          '+new mock line'
        ].join('\n')
      };
    case 'config_get':
      if (body.key === 'user.name') return { ok: true, value: 'E2E User' };
      if (body.key === 'user.email') return { ok: true, value: 'e2e@example.test' };
      if (body.key === 'http.proxy' || body.key === 'https.proxy') return { ok: true, value: '' };
      return { ok: true, value: '' };
    case 'remote_list':
      return {
        ok: true,
        remotes: [{ name: 'origin', url: 'https://example.test/e2e/repo.git' }]
      };
    case 'branch_list':
      return {
        ok: true,
        current: 'main',
        branches: [
          { name: 'main', current: true },
          { name: 'feature/e2e', current: false }
        ]
      };
    case 'scan_diff':
      return { ok: true, findings: [] };
    case 'show_file':
      return { ok: true, content: 'mock file at requested commit\n' };
    case 'add':
    case 'unstage':
    case 'checkout_file':
    case 'commit':
    case 'config_set':
    case 'config_unset':
    case 'remote_add':
    case 'remote_set_url':
    case 'remote_remove':
    case 'fetch':
    case 'pull':
    case 'push':
    case 'revert':
    case 'reset_mixed':
    case 'reset_hard':
    case 'reset_orig_head':
    case 'reset_to_ref':
    case 'branch_switch':
    case 'branch_create':
    case 'branch_rename':
    case 'branch_delete':
      return { ok: true, output: `mock git ${subcommand} completed` };
    default:
      return { ok: true, output: `mock git ${subcommand || 'unknown'} completed` };
  }
}

function mockLmsProxyPayload(path) {
  if (path === '/api/todos') {
    return {
      ok: true,
      status: 200,
      data: {
        todo_list: [
          {
            id: 1001,
            title: 'E2E Homework',
            course_id: 801,
            course_name: 'Software Engineering',
            start_time: daysFromNow(-2),
            end_time: daysFromNow(5)
          }
        ]
      }
    };
  }

  if (path === '/api/my-courses') {
    return {
      ok: true,
      status: 200,
      data: {
        courses: [
          {
            id: 801,
            name: 'Software Engineering',
            credit: 3,
            academic_year: { name: '2025-2026' }
          }
        ]
      }
    };
  }

  if (/^\/api\/courses\/\d+\/activities$/.test(path)) {
    return {
      ok: true,
      status: 200,
      data: {
        activities: [
          {
            id: 2001,
            title: 'Week 1 Slides',
            type: 'material',
            module_id: 301,
            uploads: [
              {
                id: 901,
                name: 'week-1-slides.pdf',
                size: 2048,
                allow_download: true,
                url: '/api/uploads/901/download?name=week-1-slides.pdf'
              }
            ]
          }
        ]
      }
    };
  }

  if (/^\/api\/courses\/\d+\/modules$/.test(path)) {
    return {
      ok: true,
      status: 200,
      data: {
        modules: [{ id: 301, name: 'Course Materials' }]
      }
    };
  }

  if (/^\/api\/homework-activities\/\d+$/.test(path)) {
    return {
      ok: true,
      status: 200,
      data: {
        id: 1001,
        title: 'E2E Homework',
        start_time: daysFromNow(-2),
        end_time: daysFromNow(5),
        data: {
          description: '<p>Write a short E2E report.</p>',
          homework_type: 'online',
          allow_retract: true
        },
        uploads: [
          {
            id: 902,
            name: 'homework-template.docx',
            size: 1024,
            allow_download: true,
            url: '/api/uploads/902/download?name=homework-template.docx'
          }
        ]
      }
    };
  }

  if (/^\/api\/uploads\/\d+\/url$/.test(path)) {
    const id = path.match(/\/api\/uploads\/(\d+)\/url/)[1];
    return {
      ok: true,
      status: 200,
      data: {
        url: `https://lms.xjtu.edu.cn/api/uploads/${id}/download?name=e2e-download.txt`
      }
    };
  }

  return { ok: true, status: 200, data: { source: 'mock-lms' } };
}

function mockLmsServicePayload(path, body = {}, state = {}, options = {}) {
  if (path === '/lms-login') {
    if (typeof state.lmsHasSavedCredential !== 'boolean') {
      state.lmsHasSavedCredential = !!options.lmsHasSavedCredential;
    }
    if (body.action === 'credential_status') {
      return state.lmsHasSavedCredential
        ? {
            ok: true,
            has_credential: true,
            username: 'e2e-student',
            saved_at: 1783238400
          }
        : { ok: true, has_credential: false };
    }
    if (body.action === 'clear_credentials') {
      state.lmsHasSavedCredential = false;
      return { ok: true, cleared: true };
    }
    if (options.lmsLoginRequiresMfa && (body.action === 'start' || body.action === 'start_password' || body.action === 'start_saved')) {
      return {
        ok: true,
        status: 'require_mfa',
        flow_id: 'flow-e2e-mfa',
        phone: '138****0000',
        message: 'mock MFA required'
      };
    }
    if (body.action === 'send_mfa') {
      return { ok: true, message: 'mock MFA code sent' };
    }
    if (body.action === 'verify_mfa') {
      return {
        ok: true,
        status: 'success',
        cookie: MOCK_LMS_COOKIE,
        has_session_cookie: true,
        message: 'mock MFA login success'
      };
    }
    return {
      ok: true,
      status: 'success',
      cookie: MOCK_LMS_COOKIE,
      has_session_cookie: true,
      message: 'mock login success'
    };
  }

  if (path === '/lms-scores') {
    return {
      ok: true,
      account_type: body.account_type || 'undergraduate',
      scores: [
        { term: '2025-2026-1', courseCode: 'SE101', courseName: 'Software Engineering', coursePoint: 3, score: 95, gpa: 4.0, passFlag: true },
        { term: '2025-2026-1', courseCode: 'AI101', courseName: 'Applied AI', coursePoint: 2, score: 88, gpa: 3.7, passFlag: true }
      ],
      summary: { count: 2, totalCredits: 5, weightedAverageScore: 92.2, weightedGpa: 3.88 }
    };
  }

  if (path === '/lms-schedule') {
    return {
      ok: true,
      account_type: body.account_type || 'undergraduate',
      term: body.term || '2025-2026-1',
      lessons: [
        { dayOfWeek: 1, periodStart: 1, periodEnd: 2, name: 'Software Engineering', classroom: 'A101', teacher: 'Prof. E2E', weeksText: '1-16' }
      ],
      summary: { count: 1 }
    };
  }

  if (path === '/lms-empty-rooms') {
    return {
      ok: true,
      rooms: [
        { name: 'A101', buildingName: body.building || 'Main Building', type: 'multimedia', capacity: 80, examCapacity: 40, campusName: body.campus || 'Xingqing' }
      ],
      summary: { count: 1 }
    };
  }

  if (path === '/lms-attendance') {
    const page = Number(body.page || 1);
    return {
      ok: true,
      account_type: body.account_type || 'undergraduate',
      access_mode: body.access_mode || 'normal',
      flows: [
        { id: `flow-${page}`, time: '2026-07-05 08:00', place: 'A101', type: 1, typeLabel: 'Normal' }
      ],
      subjects: [
        { subjectName: 'Software Engineering', total: 16, normalCount: 15, lateCount: 1, absenceCount: 0, leaveCount: 0 }
      ],
      statistics: { total: 16, normalCount: 15, lateCount: 1, absenceCount: 0, leaveCount: 0, leaveEarlyCount: 0 },
      pagination: { page, pageSize: Number(body.page_size || 20), totalPages: 2, totalCount: 2 }
    };
  }

  if (path === '/lms-judge') {
    if (body.action === 'submit_all') {
      return {
        ok: true,
        account_type: body.account_type || 'undergraduate',
        success_count: 1,
        results: [
          { ok: true, courseName: 'Software Engineering', teacher: 'Prof. E2E', message: 'submitted' }
        ]
      };
    }
    return {
      ok: true,
      account_type: body.account_type || 'undergraduate',
      questionnaires: [
        { courseName: 'Software Engineering', teacher: 'Prof. E2E', questionnaireName: 'Teaching Survey', term: '2025-2026-1' }
      ]
    };
  }

  if (path === '/lms-training-plan') {
    return {
      ok: true,
      account_type: body.account_type || 'undergraduate',
      selected_plan_code: 'PLAN-E2E',
      plans: [
        { code: 'PLAN-E2E', name: 'E2E Training Plan', routeName: 'Software', grade: '2025' }
      ],
      selected_plan: {
        code: 'PLAN-E2E',
        name: 'E2E Training Plan',
        majorName: 'Software Engineering',
        routeName: 'Software',
        grade: '2025',
        departmentName: 'Computer Science',
        durationYears: 4,
        requiredCredits: 160,
        completedCredits: 120,
        remainingCredits: 40,
        progressPercent: 75
      },
      groups: [
        { name: 'Core Courses', requiredCredits: 60, plannedCredits: 58, remainingPlannedCredits: 2, courseCount: 12, typeName: 'required', depth: 0 }
      ],
      courses: [
        { plannedTermText: 'Term 1', courseName: 'Software Engineering', courseCode: 'SE101', credits: 3, nature: 'required', examType: 'exam', groupName: 'Core Courses' }
      ],
      guidance_terms: [
        { semester: 1, academicYear: '2025-2026', term: 'Fall', requiredCredits: 20 }
      ],
      summary: { requiredCredits: 160, completedCredits: 120, remainingCredits: 40, progressPercent: 75, groupCount: 1, courseCount: 1, guidanceTermCount: 1 }
    };
  }

  return { ok: true, path, source: 'mock-lms-service' };
}

async function mockLlm(route, options, state) {
  const request = route.request();
  if (request.method() === 'OPTIONS') {
    await fulfillSafely(route, textResponse('', 204));
    return;
  }

  const body = await requestJson(request);
  state.llmCalls.push({ url: request.url(), headers: request.headers(), body });
  const callNumber = state.llmCalls.length;

  if (options.failNextLlmCall && !state.failedOnce) {
    state.failedOnce = true;
    await fulfillSafely(route, jsonResponse({ error: { message: 'mock failure' } }, 400));
    return;
  }

  const delayMs = typeof options.delayForLlm === 'function'
    ? options.delayForLlm(body, callNumber)
    : (options.delayMs || 0);
  if (delayMs > 0) await sleep(delayMs);

  const useStream = typeof options.streamForLlm === 'function'
    ? options.streamForLlm(body, callNumber)
    : (body.stream !== undefined ? !!body.stream : !!options.stream);

  if (useStream) {
    await fulfillSafely(route, textResponse(
      makeOpenAiStream(body, callNumber, options.replyPrefix),
      200,
      'text/event-stream'
    ));
    return;
  }

  await fulfillSafely(route, jsonResponse(makeOpenAiResponse(body, callNumber, options.replyPrefix)));
}

function agentBackendPayload(action, body, state = {}) {
  if (action === 'remote_status') {
    return {
      ok: true,
      connected: !!state.remoteConnected,
      server_url: state.remoteServerUrl || 'http://127.0.0.1:18765',
      tunnel_pid: state.remoteConnected ? 4242 : null,
      heartbeat_timeout: Number(body.heartbeat_timeout || 75)
    };
  }
  if (action === 'remote_list_dirs') {
    const path = body.path || '~';
    const parent = path === '~' ? '~' : path.replace(/\/[^/]+\/?$/, '') || '~';
    const entries = path === '~/project'
      ? [
          { name: 'src', path: '~/project/src', type: 'dir', readable: true, executable: true },
          { name: 'tests', path: '~/project/tests', type: 'dir', readable: true, executable: true }
        ]
      : [
          { name: 'project', path: '~/project', type: 'dir', readable: true, executable: true },
          { name: 'readonly', path: '~/readonly', type: 'dir', readable: true, executable: false }
        ];
    return { ok: true, path, parent, entries, truncated: false };
  }
  if (action === 'remote_connect') {
    state.remoteConnected = true;
    state.remoteServerUrl = `http://127.0.0.1:${body.local_port || 18765}`;
    state.remoteWorkspace = body.remote_workspace || '~/project';
    return {
      ok: true,
      server_url: state.remoteServerUrl,
      workspace_info: {
        ok: true,
        workspace: state.remoteWorkspace,
        cwd: state.remoteWorkspace
      },
      logs: ['mock remote agent started']
    };
  }
  if (action === 'remote_disconnect') {
    state.remoteConnected = false;
    return { ok: true, stopped: !!body.stop_remote };
  }
  if (action === 'open_terminal') {
    return { ok: true, opened: true, workspace: state.remoteWorkspace || MOCK_WORKSPACE, cwd: state.remoteWorkspace || MOCK_WORKSPACE };
  }
  if (action === 'list_dir') {
    return {
      ok: true,
      workspace: MOCK_WORKSPACE,
      cwd: MOCK_WORKSPACE,
      entries: [
        { name: 'src', type: 'dir', size: 0, modified: Date.now() / 1000 },
        { name: 'sample.txt', type: 'file', size: 42, modified: Date.now() / 1000 },
        { name: 'sample.md', type: 'file', size: 64, modified: Date.now() / 1000 },
        { name: 'sample.py', type: 'file', size: 96, modified: Date.now() / 1000 },
        { name: 'sample.tex', type: 'file', size: 128, modified: Date.now() / 1000 },
        { name: 'sample.pdf', type: 'file', size: 1024, modified: Date.now() / 1000 },
        { name: 'sample.png', type: 'file', size: 256, modified: Date.now() / 1000 },
        { name: 'sample.mp3', type: 'file', size: 512, modified: Date.now() / 1000 }
      ]
    };
  }
  if (action === 'read_file') {
    const path = body.path || 'sample.txt';
    let content = 'Sample file content from the mocked backend.\n';
    if (/\.md$/i.test(path)) content = '# E2E Markdown\n\nSample file content from the mocked backend.\n';
    if (/\.py$/i.test(path)) content = 'def e2e_sample():\n    return "mocked backend"\n';
    if (/\.tex$/i.test(path)) content = '\\documentclass{article}\\begin{document}E2E\\end{document}\n';
    return {
      ok: true,
      path,
      content,
      encoding: 'utf-8',
      size: content.length
    };
  }
  if (action === 'read_file_binary') {
    return {
      ok: true,
      path: body.path || 'sample.txt',
      mime: 'text/plain',
      data: Buffer.from('Sample binary content').toString('base64')
    };
  }
  if (action === 'workspace_info' || action === 'set_workspace') {
    return { ok: true, workspace: body.path || MOCK_WORKSPACE, cwd: body.path || MOCK_WORKSPACE };
  }
  if (action === 'skill_list') {
    return { ok: true, skills: [{ name: 'mock-skill', path: 'skill/mock-skill', summary: 'E2E mock skill' }] };
  }
  if (action === 'mcp_list_tools') {
    return { ok: true, tools: [] };
  }
  if (action === 'music') {
    if (body.op === 'list') {
      return {
        ok: true,
        musicDir: 'music/',
        tracks: [
          { name: 'track-one.mp3', path: 'track-one.mp3', size: 1024 },
          { name: 'track-two.mp3', path: 'track-two.mp3', size: 2048 }
        ]
      };
    }
    if (body.op === 'import') {
      return { ok: true, imported: body.name || 'imported.mp3' };
    }
    return { ok: true, op: body.op || 'unknown' };
  }
  if (action === 'git') {
    return mockGitPayload(body, state);
  }
  if (action === 'wechat_bridge') {
    return { ok: true, enabled: false, commands: [], message: 'mock remote control idle' };
  }
  if (action === 'remote_execute' || action === 'execute') {
    return { ok: true, stdout: 'mock command output', stderr: '', returncode: 0 };
  }
  if (action === 'compile_tex') {
    return {
      ok: true,
      action,
      path: body.path || 'sample.tex',
      pdf_path: String(body.path || 'sample.tex').replace(/\.tex$/i, '.pdf'),
      workspace: MOCK_WORKSPACE,
      cwd: MOCK_WORKSPACE
    };
  }
  if (['write_file', 'append_file', 'edit_file', 'apply_patch', 'create_file', 'create_dir', 'rename_file', 'delete_file'].includes(action)) {
    return { ok: true, action, path: body.path || '', workspace: MOCK_WORKSPACE, cwd: MOCK_WORKSPACE };
  }
  return { ok: true, action, workspace: MOCK_WORKSPACE, cwd: MOCK_WORKSPACE };
}

async function installMockBackend(page, options = {}) {
  const state = {
    llmCalls: [],
    backendCalls: [],
    lmsProxyCalls: [],
    lmsServiceCalls: [],
    failedOnce: false,
    gitInitialized: options.gitInRepo !== false,
    lmsHasSavedCredential: !!options.lmsHasSavedCredential
  };

  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.hostname === 'cdn.jsdelivr.net') {
      if (url.pathname.endsWith('.css')) {
        await fulfillSafely(route, textResponse('', 200, 'text/css'));
        return;
      }
      const stub = [
        'window.katex = window.katex || { render: function(){} };',
        'window.renderMathInElement = window.renderMathInElement || function(){};',
        'window.hljs = window.hljs || { highlightElement: function(){}, highlight: function(c){ return { value: c }; }, getLanguage: function(){ return false; } };'
      ].join('\n');
      await fulfillSafely(route, textResponse(stub, 200, 'application/javascript'));
      return;
    }

    if (url.pathname === '/mock-api/models') {
      await fulfillSafely(route, jsonResponse({
        object: 'list',
        data: [
          { id: 'mock-model', object: 'model' },
          { id: 'mock-model-fast', object: 'model' }
        ]
      }));
      return;
    }

    if (url.pathname.startsWith('/mock-api/') || url.pathname.endsWith('/llm-proxy')) {
      await mockLlm(route, options, state);
      return;
    }

    if (url.pathname === '/music-file') {
      await fulfillSafely(route, textResponse('mock audio bytes', 200, 'audio/mpeg'));
      return;
    }

    const isLocalBackend = ['localhost', '127.0.0.1'].includes(url.hostname) && ['8765', '18765'].includes(url.port);
    if (isLocalBackend && url.pathname === '/workspace' && request.method() === 'GET') {
      const workspace = state.remoteWorkspace || MOCK_WORKSPACE;
      await fulfillSafely(route, jsonResponse({ ok: true, workspace, cwd: workspace }));
      return;
    }
    if (isLocalBackend && url.pathname === '/lms-proxy') {
      const path = url.searchParams.get('path') || '';
      state.lmsProxyCalls.push({ path, url: request.url(), method: request.method() });
      if (url.searchParams.get('download')) {
        await fulfillSafely(route, textResponse('mock LMS download content', 200, 'application/octet-stream'));
        return;
      }
      await fulfillSafely(route, jsonResponse(mockLmsProxyPayload(path)));
      return;
    }
    if (isLocalBackend && request.method() === 'POST' && url.pathname.startsWith('/lms-')) {
      const body = await requestJson(request);
      state.lmsServiceCalls.push({ path: url.pathname, body });
      await fulfillSafely(route, jsonResponse(mockLmsServicePayload(url.pathname, body, state, options)));
      return;
    }
    if (isLocalBackend && request.method() === 'POST') {
      const body = await requestJson(request);
      const action = body.action || '';
      state.backendCalls.push({ action, body });
      await fulfillSafely(route, jsonResponse(agentBackendPayload(action, body, state)));
      return;
    }
    if (isLocalBackend && url.pathname === '/preview-file') {
      await fulfillSafely(route, textResponse('mock preview', 200, 'text/plain'));
      return;
    }

    await route.continue();
  });

  return state;
}

function watchClientErrors(page) {
  const errors = [];
  page.on('pageerror', error => {
    errors.push(`pageerror: ${error.message}`);
  });
  page.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/Failed to load resource|favicon\.ico|net::ERR_ABORTED/i.test(text)) return;
    errors.push(`console: ${text}`);
  });
  return {
    errors,
    expectNoErrors() {
      expect(errors).toEqual([]);
    }
  };
}

async function gotoApp(page, options = {}) {
  const backend = await installMockBackend(page, options);
  const clientErrors = watchClientErrors(page);
  const dialogResponses = Array.isArray(options.dialogResponses) ? [...options.dialogResponses] : null;
  page.on('dialog', dialog => {
    const text = dialogResponses && dialogResponses.length
      ? dialogResponses.shift()
      : (options.dialogText || 'e2e-value');
    dialog.accept(text);
  });

  await page.goto(APP_PATH, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#input')).toBeVisible();
  await expect(page.locator('#sendBtn')).toBeVisible();
  await page.waitForFunction(() => typeof window.onSend === 'function');
  return { backend, clientErrors };
}

async function configureMockProvider(page, options = {}) {
  await page.locator('button[data-action="openSettings"]').first().click();
  await expect(page.locator('#settingsPage')).toHaveClass(/show/);
  await expect(page.locator('#baseUrl')).toBeVisible();
  await page.fill('#baseUrl', options.baseUrl || MOCK_API_BASE);
  await page.fill('#apiPath', options.apiPath || '/chat/completions');
  await page.locator('#apiFormat').evaluate((el, value) => {
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, options.apiFormat || 'openai');
  await page.fill('#apiKey', options.apiKey || 'fake-e2e-key');
  await page.fill('#modelName', options.modelName || 'mock-model, mock-model-fast');
  await page.locator('#streamMode').evaluate((el, checked) => {
    el.checked = checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, !!options.stream);
  await page.locator('#useLocalProxy').evaluate(el => {
    el.checked = false;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.fill('#maxTokens', String(options.maxTokens || 256));
  await page.locator('#temperature').evaluate((el, value) => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, String(options.temperature ?? 0.2));
  await page.locator('button[data-action="saveAndClose"]').click();
  await expect(page.locator('#settingsPage')).not.toHaveClass(/show/);
}

async function sendMessage(page, text) {
  await page.fill('#input', text);
  await page.locator('#sendBtn').click();
  await expect(page.locator('#messagesInner')).toContainText(text);
}

async function waitForAssistantReply(page, text, timeout = 15_000) {
  await expect(page.locator('#messagesInner')).toContainText(text, { timeout });
  await expect(page.locator('#sendBtn')).not.toHaveClass(/stop/, { timeout });
}

async function waitForGenerating(page) {
  await expect(page.locator('#sendBtn')).toHaveClass(/stop/);
}

async function closeSettingsPageIfOpen(page) {
  const pageEl = page.locator('#settingsPage');
  if (await pageEl.evaluate(el => el.classList.contains('show')).catch(() => false)) {
    await page.locator('button[data-action="closeSettingsPage"]').click();
    await expect(pageEl).not.toHaveClass(/show/);
  }
}

module.exports = {
  APP_PATH,
  MOCK_API_BASE,
  MOCK_LMS_COOKIE,
  MOCK_WORKSPACE,
  configureMockProvider,
  gotoApp,
  sendMessage,
  waitForAssistantReply,
  waitForGenerating,
  closeSettingsPageIfOpen
};
