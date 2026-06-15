"""
========================================================================
  LMS Helper - 西安交大学习管理系统命令行助手
========================================================================

使用方法（在 lms_tool/ 目录下运行）：

  python lms.py login              # 检查 Cookie 状态/有效期
  python lms.py courses            # 列出所有课程（按学年分组）
  python lms.py todos              # 列出未完成作业（按紧急度排序）
  python lms.py homework <hw_id>   # 查看某项作业的详细要求
  python lms.py materials <cid>    # 列出某门课的所有课件
  python lms.py download <upload_id> [文件名]    # 下载服务器返回可用地址的文件
  python lms.py probe-upload <upload_id> [--course cid]  # 诊断某个附件 URL 来源
  python lms.py crawl-urls --course <cid>        # 扫描课程附件 URL 来源
  python lms.py find <关键词>      # 在课程名里搜索（拿到 course_id）

第一次使用：
  1. 浏览器登录 LMS 后，按 F12 → Console 输入 copy(document.cookie)
  2. 二选一保存 Cookie：
     - 设置环境变量 LMS_COOKIE="..."
     - 或在 lms_tool/.lms_cookie 中写入 Cookie（已被 .gitignore 排除）
  3. 跑 python lms.py login 验证
"""

import sys
import io
import os
import json
import base64
import argparse
import re
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse, urlunparse, parse_qsl
from datetime import datetime, timezone, timedelta
from collections import defaultdict

import requests

# Windows 控制台 UTF-8
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

# ====================================================================
# 🔐 Cookie 加载（优先级：环境变量 LMS_COOKIE > 同目录 .lms_cookie 文件）
# 切勿把真实 Cookie 写在源码里！.lms_cookie 已加入 .gitignore。
#
# 配置方式（任选其一）：
#   1) 临时：  setx LMS_COOKIE "_ga=...; session=..."     (Windows)
#             export LMS_COOKIE="_ga=...; session=..."    (Linux/Mac)
#   2) 持久：  在 lms_tool/.lms_cookie 中写一行 Cookie 字符串
# ====================================================================

def _load_cookie() -> str:
    env = os.environ.get("LMS_COOKIE", "").strip()
    if env:
        return env
    cookie_file = Path(__file__).parent / ".lms_cookie"
    if cookie_file.exists():
        try:
            content = cookie_file.read_text(encoding="utf-8").strip()
            if content:
                return content
        except Exception as e:
            print(f"⚠️  读取 {cookie_file} 失败: {e}")
    print("❌ 未配置 Cookie。请二选一：")
    print('   ① 设置环境变量 LMS_COOKIE="..."')
    print(f"   ② 在 {cookie_file} 写入 Cookie 字符串")
    print("   获取方法：登录 lms.xjtu.edu.cn → F12 Console → copy(document.cookie)")
    sys.exit(1)


COOKIE_STR = None


def get_cookie_str() -> str:
    global COOKIE_STR
    if COOKIE_STR is None:
        COOKIE_STR = _load_cookie()
    return COOKIE_STR

BASE_URL  = "https://lms.xjtu.edu.cn"
CST       = timezone(timedelta(hours=8))
DATA_DIR  = Path(__file__).parent / "data"
DL_DIR    = Path(__file__).parent / "downloads"
DATA_DIR.mkdir(exist_ok=True)
DL_DIR.mkdir(exist_ok=True)

URL_KEY_HINTS = ("url", "href", "link", "path")


# ====================================================================
#                          基础工具函数
# ====================================================================

def build_session():
    """构造已登录的 session"""
    cookie_str = get_cookie_str()
    s = requests.Session()
    for kv in cookie_str.split(";"):
        kv = kv.strip()
        if "=" in kv:
            k, v = kv.split("=", 1)
            s.cookies.set(k.strip(), v.strip())
    s.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/148.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": f"{BASE_URL}/user/index",
        "X-Requested-With": "XMLHttpRequest",
    })
    return s


def api_get(session, path, **params):
    """统一 GET 请求"""
    url = f"{BASE_URL}{path}"
    r = session.get(url, params=params, timeout=20)
    if r.status_code == 200:
        try:
            return r.json()
        except json.JSONDecodeError:
            return None
    return None


def parse_time(s):
    """LMS UTC 时间 → 北京时间 datetime"""
    if not s:
        return None
    dt = datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    return dt.astimezone(CST)


def fmt_size(b):
    if not b: return "0 B"
    if b < 1024:        return f"{b} B"
    if b < 1024**2:     return f"{b/1024:.1f} KB"
    if b < 1024**3:     return f"{b/1024**2:.1f} MB"
    return f"{b/1024**3:.2f} GB"


def fmt_remain(end_dt, now=None):
    """格式化截止剩余时间"""
    if not end_dt:
        return "⏳ 无截止"
    now = now or datetime.now(CST)
    delta = end_dt - now
    total = delta.total_seconds()
    if total < 0:
        return f"⛔ 已逾期 {-delta.days} 天"
    days  = delta.days
    hours = int((total % 86400) // 3600)
    if days >= 30:  return f"📅 还有 {days} 天"
    if days >= 7:   return f"📌 还有 {days} 天"
    if days >= 3:   return f"⚠️  还有 {days} 天 {hours} 小时"
    if days >= 1:   return f"🔥 仅剩 {days} 天 {hours} 小时"
    return f"🚨 仅剩 {hours} 小时！"


def safe_get(obj, key, default=""):
    if not obj: return default
    return obj.get(key, default) or default


def strip_html(html):
    """简单去 HTML 标签，把作业说明转纯文本"""
    if not html: return ""
    text = re.sub(r"<br\s*/?>", "\n", html, flags=re.I)
    text = re.sub(r"</p>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    # 解 HTML 实体
    text = (text.replace("&nbsp;", " ").replace("&amp;", "&")
                .replace("&lt;", "<").replace("&gt;", ">")
                .replace("&quot;", '"').replace("&#39;", "'"))
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def filename_from_url(url):
    """从 URL 的 name= 参数或路径里推断文件名。"""
    if not url:
        return None
    m = re.search(r"[?&]name=([^&]+)", url)
    if m:
        return unquote(m.group(1))
    path = url.split("?", 1)[0].rstrip("/")
    if "/" in path:
        name = unquote(path.rsplit("/", 1)[-1])
        if name:
            return name
    return None


def normalize_lms_url(raw):
    """把 API 中返回的绝对/相对资源地址规范化为可请求 URL。"""
    raw = (raw or "").strip()
    if not raw:
        return None
    if raw.startswith("//"):
        return "https:" + raw
    if raw.startswith(("http://", "https://")):
        return raw
    if raw.startswith("/"):
        return urljoin(BASE_URL, raw)
    return None


def extract_url_candidates_with_paths(obj):
    """从 LMS 已返回的对象中提取直链候选，并保留字段路径。"""
    candidates = []
    seen = set()

    def add(path, raw):
        url = normalize_lms_url(raw)
        if url and url not in seen:
            seen.add(url)
            candidates.append((path, url))

    def walk(value, path=""):
        if isinstance(value, dict):
            for key, child in value.items():
                key_l = str(key).lower()
                child_path = f"{path}.{key}" if path else str(key)
                if isinstance(child, str) and any(h in key_l for h in URL_KEY_HINTS):
                    add(child_path, child)
                elif isinstance(child, (dict, list, tuple)):
                    walk(child, child_path)
        elif isinstance(value, (list, tuple)):
            for i, child in enumerate(value):
                walk(child, f"{path}[{i}]")

    walk(obj)
    return candidates


def extract_url_candidates(obj):
    """从 LMS 已返回的 upload 元信息中提取直链候选，不猜测接口。"""
    return [url for _, url in extract_url_candidates_with_paths(obj)]


def looks_like_upload(obj):
    return (
        isinstance(obj, dict)
        and obj.get("id") is not None
        and any(k in obj for k in ("name", "size", "allow_download"))
    )


def iter_uploads(obj):
    if looks_like_upload(obj):
        yield obj
    if isinstance(obj, dict):
        for value in obj.values():
            yield from iter_uploads(value)
    elif isinstance(obj, list):
        for value in obj:
            yield from iter_uploads(value)


def find_cached_upload(upload_id):
    """在 data/*.json 缓存中找 upload 元信息，用于直链兜底。"""
    for path in sorted(DATA_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        for upload in iter_uploads(data):
            try:
                if int(upload.get("id")) == int(upload_id):
                    return upload, path
            except Exception:
                continue
    return None, None


def summarize_url(url, show_full=False):
    """默认隐藏 query 值，避免把临时签名 URL 打进日志。"""
    if show_full:
        return url
    try:
        parsed = urlparse(url)
        query_keys = parse_qsl(parsed.query, keep_blank_values=True)
        safe_query = "&".join(f"{k}=<redacted>" for k, _ in query_keys[:8])
        if len(query_keys) > 8:
            safe_query += "&..."
        return urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", safe_query, ""))
    except Exception:
        return "<invalid-url>"


def probe_remote_url(session, url):
    """轻量测试 URL 是否可访问，不下载正文。"""
    info = {
        "ok": False,
        "method": "",
        "status": None,
        "final_url": "",
        "content_type": "",
        "content_length": "",
        "content_range": "",
        "content_disposition": "",
        "error": "",
    }
    headers = {
        "Referer": f"{BASE_URL}/user/index",
        "Range": "bytes=0-0",
    }
    try:
        r = session.head(url, allow_redirects=True, timeout=20, headers={"Referer": headers["Referer"]})
        info.update({
            "method": "HEAD",
            "status": r.status_code,
            "final_url": r.url,
            "content_type": r.headers.get("Content-Type", ""),
            "content_length": r.headers.get("Content-Length", ""),
            "content_range": r.headers.get("Content-Range", ""),
            "content_disposition": r.headers.get("Content-Disposition", ""),
        })
        r.close()
        if r.status_code not in (405, 501):
            info["ok"] = 200 <= r.status_code < 400
            return info
    except Exception as e:
        info["error"] = f"HEAD: {e}"

    try:
        r = session.get(url, allow_redirects=True, timeout=20, headers=headers, stream=True)
        info.update({
            "method": "GET Range",
            "status": r.status_code,
            "final_url": r.url,
            "content_type": r.headers.get("Content-Type", ""),
            "content_length": r.headers.get("Content-Length", ""),
            "content_range": r.headers.get("Content-Range", ""),
            "content_disposition": r.headers.get("Content-Disposition", ""),
        })
        info["ok"] = 200 <= r.status_code < 400
        r.close()
    except Exception as e:
        info["error"] = (info["error"] + " | " if info["error"] else "") + f"GET: {e}"
    return info


def cache_course_activities(cid, data):
    (DATA_DIR / f"course_{cid}_activities.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def load_course_uploads(session, cid):
    data = api_get(session, f"/api/courses/{cid}/activities")
    if not data:
        return None, []
    cache_course_activities(cid, data)
    rows = []
    for activity in data.get("activities", []) or []:
        for upload in activity.get("uploads", []) or []:
            if looks_like_upload(upload):
                rows.append((activity, upload))
    return data, rows


# ====================================================================
#                          命令实现
# ====================================================================

def cmd_login(args):
    """检查 Cookie 是否有效 + 显示过期时间"""
    cookie_str = get_cookie_str()
    print("=" * 60)
    print("🔐 Cookie 状态检查")
    print("=" * 60)

    # 解析 session cookie 拿过期时间
    session_val = ""
    for kv in cookie_str.split(";"):
        kv = kv.strip()
        if kv.startswith("session="):
            session_val = kv.split("=", 1)[1]
            break

    if not session_val:
        print("❌ 没找到 session cookie，请检查 COOKIE_STR")
        return

    try:
        parts = session_val.split(".")
        uid = base64.urlsafe_b64decode(parts[1] + "==").decode()
        expire_ts = int(parts[2]) / 1000
        expire_dt = datetime.fromtimestamp(expire_ts, tz=CST)
        now = datetime.now(CST)
        delta = expire_dt - now

        print(f"👤 用户 ID  : {uid}")
        print(f"⏰ 过期时间 : {expire_dt.strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"📊 剩余    : {delta}")
        if delta.total_seconds() < 0:
            print("⛔ Cookie 已过期，请重新登录获取！")
            return
    except Exception as e:
        print(f"⚠️ 解析失败: {e}")

    # 实际请求测试
    s = build_session()
    data = api_get(s, "/api/todos")
    if data is not None:
        n = len(data.get("todo_list", []))
        print(f"\n✅ Cookie 有效，可正常调用 API（当前 {n} 项待办）")
    else:
        print("\n❌ API 调用失败，Cookie 可能已失效")


def cmd_courses(args):
    """列出所有课程"""
    s = build_session()
    data = api_get(s, "/api/my-courses")
    if not data:
        print("❌ 获取课程列表失败")
        return

    courses = data.get("courses", [])
    # 缓存
    (DATA_DIR / "courses.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    by_term = defaultdict(list)
    for c in courses:
        year = safe_get(c.get("academic_year"), "name", "其他")
        by_term[year].append(c)

    print(f"\n📚 共 {len(courses)} 门课程\n")
    for term in sorted(by_term.keys(), reverse=True):
        lst = by_term[term]
        print(f"📅 【{term}】 ({len(lst)} 门)")
        print("-" * 70)
        for c in lst:
            cid    = c.get("id")
            name   = c.get("name", "?")
            credit = c.get("credit", "")
            credit_str = f"  {credit}学分" if credit else ""
            print(f"  [{cid:>6}] {name}{credit_str}")
        print()


def cmd_todos(args):
    """列出未完成作业"""
    s = build_session()
    data = api_get(s, "/api/todos")
    if not data:
        print("❌ 获取待办失败")
        return

    todos = data.get("todo_list", [])
    (DATA_DIR / "todos.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    now = datetime.now(CST)
    items = []
    for t in todos:
        items.append({
            "id":     t.get("id"),
            "title":  t.get("title", "?"),
            "course": t.get("course_name", "?"),
            "cid":    t.get("course_id"),
            "type":   t.get("type", "?"),
            "end":    parse_time(t.get("end_time")),
            "start":  parse_time(t.get("start_time")),
        })
    items.sort(key=lambda x: (x["end"] is None, x["end"] or now))

    print(f"\n📝 未完成作业（{len(items)} 项）  ⏰ {now.strftime('%Y-%m-%d %H:%M')}\n")
    if not items:
        print("🎉 暂无未完成作业~")
        return

    for i, x in enumerate(items, 1):
        end_str = x["end"].strftime("%Y-%m-%d %H:%M") if x["end"] else "—"
        print(f"【{i}】{x['title']}")
        print(f"     📚 {x['course']}  |  🆔 hw_id={x['id']}")
        print(f"     🔴 截止: {end_str}   {fmt_remain(x['end'], now)}")
        print(f"     🔗 https://lms.xjtu.edu.cn/course/{x['cid']}/homework/{x['id']}")
        print(f"     💡 查看详情: python lms.py homework {x['id']}")
        print()


def cmd_homework(args):
    """查看某项作业的详细要求"""
    hw_id = args.id
    s = build_session()
    data = api_get(s, f"/api/homework-activities/{hw_id}")
    if not data:
        print(f"❌ 未找到作业 {hw_id}")
        return

    (DATA_DIR / f"homework_{hw_id}.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    title    = data.get("title", "?")
    start    = parse_time(data.get("start_time"))
    end      = parse_time(data.get("end_time"))
    sub_type = data.get("data", {}).get("homework_type", "?")
    desc     = strip_html(data.get("data", {}).get("description", ""))
    uploads  = data.get("uploads", []) or []

    print("=" * 70)
    print(f"📝 {title}")
    print("=" * 70)
    print(f"🟢 开始: {start.strftime('%Y-%m-%d %H:%M') if start else '—'}")
    print(f"🔴 截止: {end.strftime('%Y-%m-%d %H:%M') if end else '—'}   ({fmt_remain(end)})")
    print(f"📤 提交方式: {sub_type}")

    print("\n" + "─" * 70)
    print("📜 作业要求：")
    print("─" * 70)
    print(desc if desc else "(老师未填写说明)")

    if uploads:
        print("\n" + "─" * 70)
        print(f"📎 附件 ({len(uploads)} 个)：")
        print("─" * 70)
        for u in uploads:
            flag = "✅可下载" if u.get("allow_download") else "🔒仅在线"
            print(f"  📄 {u.get('name')}  ({fmt_size(u.get('size', 0))})  [{flag}]  id={u.get('id')}")
            action = "下载" if u.get("allow_download") else "尝试下载（服务器授权时可用）"
            print(f"     💡 {action}: python lms.py download {u.get('id')}")
    print()


def cmd_materials(args):
    """列出某门课的所有课件"""
    cid = args.cid
    s = build_session()
    acts_data = api_get(s, f"/api/courses/{cid}/activities")
    mods_data = api_get(s, f"/api/courses/{cid}/modules")
    if not acts_data:
        print(f"❌ 无法获取课程 {cid} 的活动列表")
        return

    cache_course_activities(cid, acts_data)
    if mods_data:
        (DATA_DIR / f"course_{cid}_modules.json").write_text(
            json.dumps(mods_data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    acts = acts_data.get("activities", [])
    mods = (mods_data or {}).get("modules", [])
    mod_name = {m["id"]: m.get("name", "未分组") for m in mods}

    materials = [a for a in acts if a.get("type") == "material"]

    groups = defaultdict(list)
    for m in materials:
        groups[m.get("module_id", 0)].append(m)

    total_files, total_size = 0, 0
    print(f"\n📚 课程 {cid} 的课件（{len(materials)} 项）\n")

    for mid, items in groups.items():
        print(f"📁 【{mod_name.get(mid, '未分组')}】")
        print("-" * 70)
        for m in items:
            uploads = m.get("uploads", []) or []
            dl = all(u.get("allow_download") for u in uploads) if uploads else False
            flag = "✅可下载" if dl else "🔒仅在线"
            print(f"  ▸ {m.get('title')}  [{flag}]")
            for u in uploads:
                total_files += 1
                total_size += u.get("size", 0)
                hint = f"  💡 python lms.py download {u.get('id')}"
                if not u.get("allow_download"):
                    hint += "  (尝试)"
                print(f"      📄 {u.get('name')}  ({fmt_size(u.get('size', 0))})  id={u.get('id')}{hint}")
        print()

    print("─" * 70)
    print(f"📊 共 {total_files} 个文件，总大小 {fmt_size(total_size)}")
    print("─" * 70)


def cmd_download(args):
    """下载一个文件（服务器给当前账号返回可用 URL 才能成功）"""
    upload_id = args.id
    s = build_session()
    cached_upload, cached_from = find_cached_upload(upload_id)

    # 第 1 步：获取签名 URL
    print(f"📡 获取服务器授权下载链接（upload_id={upload_id}）...")
    data = api_get(s, f"/api/uploads/{upload_id}/url")
    real_url = data.get("url") if data else None
    source = "授权接口"

    if not real_url and cached_upload:
        candidates = extract_url_candidates(cached_upload)
        if candidates:
            real_url = candidates[0]
            source = f"缓存直链 ({cached_from.name})"

    if not real_url:
        print("❌ 服务器没有返回可用下载地址。")
        print("   你可以先运行 materials/homework 刷新缓存后再试；如果仍失败，说明当前账号未获服务端授权，或该 API 没有暴露直链。")
        return

    # 文件名：参数指定 > URL 里的 name= > 默认
    fname = args.name or (cached_upload or {}).get("name") or filename_from_url(real_url) or f"upload_{upload_id}.bin"

    out = DL_DIR / fname
    print(f"🔗 链接来源: {source}")
    print(f"📥 下载中: {fname}")

    r = s.get(real_url, timeout=120, stream=True)
    if r.status_code != 200:
        print(f"❌ 下载失败 ({r.status_code})")
        return

    total = int(r.headers.get("Content-Length", 0))
    written = 0
    with open(out, "wb") as f:
        for chunk in r.iter_content(16384):
            f.write(chunk)
            written += len(chunk)
            if total:
                pct = written / total * 100
                bar = "█" * int(pct / 2) + "·" * (50 - int(pct / 2))
                print(f"\r  [{bar}] {pct:5.1f}%  {fmt_size(written)}/{fmt_size(total)}", end="")
    print(f"\n✅ 完成: {out}  ({fmt_size(written)})")


def print_url_probe(source, url, session, show_url=False, do_probe=True):
    print(f"  🔎 来源: {source}")
    print(f"     URL : {summarize_url(url, show_url)}")
    if not do_probe:
        return
    info = probe_remote_url(session, url)
    status = info["status"] if info["status"] is not None else "ERR"
    print(f"     测试: {info['method'] or '-'} {status}  ok={info['ok']}")
    if info["final_url"] and info["final_url"] != url:
        print(f"     跳转: {summarize_url(info['final_url'], show_url)}")
    details = []
    if info["content_type"]:
        details.append(f"Content-Type={info['content_type']}")
    if info["content_length"]:
        details.append(f"Content-Length={info['content_length']}")
    if info["content_range"]:
        details.append(f"Content-Range={info['content_range']}")
    if info["content_disposition"]:
        details.append(f"Content-Disposition={info['content_disposition']}")
    if details:
        print("     响应: " + " | ".join(details))
    if info["error"]:
        print(f"     错误: {info['error']}")


def inspect_upload_sources(session, upload_id, cached_upload=None, show_url=False, do_probe=True):
    """打印某个 upload_id 的 URL 来源诊断。"""
    found = []

    print(f"📡 1) 请求授权接口 /api/uploads/{upload_id}/url")
    data = api_get(session, f"/api/uploads/{upload_id}/url")
    if data and data.get("url"):
        found.append(("api:/api/uploads/{id}/url", data["url"]))
        print("   ✅ 授权接口返回 url")
    else:
        print("   ❌ 授权接口未返回 url")
        if isinstance(data, dict):
            print(f"   返回字段: {', '.join(data.keys()) or '(空对象)'}")

    if cached_upload:
        print("\n📦 2) 检查课件/作业 JSON 中的 upload 元信息")
        print(f"   id={cached_upload.get('id')} name={cached_upload.get('name')} allow_download={cached_upload.get('allow_download')}")
        candidates = extract_url_candidates_with_paths(cached_upload)
        if candidates:
            for path, url in candidates:
                found.append((f"upload字段:{path}", url))
            print(f"   ✅ 找到 {len(candidates)} 个 URL 字段")
        else:
            print("   ❌ upload 元信息里没有 URL 字段")
    else:
        print("\n📦 2) 未找到课件/作业 JSON 中的 upload 元信息")

    unique = []
    seen = set()
    for source, url in found:
        if url in seen:
            continue
        seen.add(url)
        unique.append((source, url))

    print("\n🧪 3) URL 连通性探测")
    if not unique:
        print("   没有可探测 URL")
        return False
    for source, url in unique:
        print_url_probe(source, url, session, show_url=show_url, do_probe=do_probe)
    return True


def cmd_probe_upload(args):
    """诊断单个 upload_id 的下载 URL 来源。"""
    upload_id = args.id
    s = build_session()
    cached_upload = None
    cached_from = None

    if args.course:
        print(f"📚 先从课程 {args.course} 活动列表查找 upload_id={upload_id}")
        _, rows = load_course_uploads(s, args.course)
        for _, upload in rows:
            try:
                if int(upload.get("id")) == int(upload_id):
                    cached_upload = upload
                    cached_from = f"course_{args.course}_activities"
                    break
            except Exception:
                continue
        if not cached_upload:
            print(f"   课程 {args.course} 的 activities 中没有这个 upload_id")

    if not cached_upload:
        cached_upload, cached_from = find_cached_upload(upload_id)

    if not cached_upload and args.scan_courses:
        print("📚 未命中缓存，开始扫描当前账号课程列表...")
        courses_data = api_get(s, "/api/my-courses")
        for c in (courses_data or {}).get("courses", []) or []:
            cid = c.get("id")
            if not cid:
                continue
            _, rows = load_course_uploads(s, cid)
            for _, upload in rows:
                try:
                    if int(upload.get("id")) == int(upload_id):
                        cached_upload = upload
                        cached_from = f"course_{cid}_activities"
                        break
                except Exception:
                    continue
            if cached_upload:
                print(f"   命中课程 {cid}: {c.get('name', '')}")
                break

    if cached_from:
        print(f"📦 upload 元信息来源: {cached_from}")

    ok = inspect_upload_sources(
        s,
        upload_id,
        cached_upload=cached_upload,
        show_url=args.show_url,
        do_probe=not args.no_probe,
    )
    if not ok:
        print("\n结论: 目前没有从授权接口或已抓取 JSON 中找到可用 URL。")


def cmd_crawl_urls(args):
    """扫描课程附件，定位 URL 字段和授权接口结果。"""
    s = build_session()
    course_ids = []

    if args.course:
        course_ids = args.course
    else:
        data = api_get(s, "/api/my-courses")
        if not data:
            print("❌ 获取课程列表失败")
            return
        courses = data.get("courses", []) or []
        if args.max_courses:
            courses = courses[:args.max_courses]
        course_ids = [c.get("id") for c in courses if c.get("id")]

    total = 0
    hits = 0
    for cid in course_ids:
        print("\n" + "=" * 80)
        print(f"📚 课程 {cid}")
        print("=" * 80)
        data, rows = load_course_uploads(s, cid)
        if data is None:
            print("❌ activities 获取失败")
            continue
        if not rows:
            print("（没有附件）")
            continue

        for activity, upload in rows:
            if args.locked_only and upload.get("allow_download"):
                continue
            total += 1
            upload_id = upload.get("id")
            title = activity.get("title") or activity.get("name") or "?"
            name = upload.get("name") or "?"
            flag = "可下载" if upload.get("allow_download") else "仅在线"
            print(f"\n[{upload_id}] {title} / {name}  ({flag}, {fmt_size(upload.get('size', 0))})")

            sources = []
            api_data = api_get(s, f"/api/uploads/{upload_id}/url")
            if api_data and api_data.get("url"):
                sources.append(("api:/api/uploads/{id}/url", api_data["url"]))
            for path, url in extract_url_candidates_with_paths(upload):
                sources.append((f"upload字段:{path}", url))

            unique = []
            seen = set()
            for source, url in sources:
                if url in seen:
                    continue
                seen.add(url)
                unique.append((source, url))

            if unique:
                hits += 1
                for source, url in unique:
                    print_url_probe(source, url, s, show_url=args.show_url, do_probe=not args.no_probe)
            else:
                print("  ❌ 授权接口和 upload JSON 都没有 URL")
            if args.limit and total >= args.limit:
                print(f"\n达到 --limit {args.limit}，停止扫描")
                print(f"扫描 {total} 个附件，{hits} 个附件找到 URL 来源")
                return

    print("\n" + "─" * 80)
    print(f"扫描 {total} 个附件，{hits} 个附件找到 URL 来源")
    print("─" * 80)


def cmd_find(args):
    """在课程名中搜索关键词，拿到 course_id"""
    kw = args.keyword
    s = build_session()
    data = api_get(s, "/api/my-courses")
    if not data:
        print("❌ 获取课程失败")
        return
    courses = data.get("courses", [])
    hits = [c for c in courses if kw.lower() in c.get("name", "").lower()]
    print(f"\n🔍 搜索 \"{kw}\" 找到 {len(hits)} 门课程：\n")
    for c in hits:
        cid  = c.get("id")
        name = c.get("name")
        year = safe_get(c.get("academic_year"), "name", "?")
        print(f"  [{cid:>6}] {name}  ({year})")
        print(f"         💡 python lms.py materials {cid}")
    print()


# ====================================================================
#                          命令分发
# ====================================================================

def main():
    parser = argparse.ArgumentParser(
        prog="lms",
        description="🎓 西安交大 LMS 命令行助手",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__.split("使用方法", 1)[1] if "使用方法" in __doc__ else "",
    )
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("login",   help="检查 Cookie 状态")
    sub.add_parser("courses", help="列出全部课程")
    sub.add_parser("todos",   help="列出未完成作业")

    p_hw = sub.add_parser("homework", help="查看作业详情")
    p_hw.add_argument("id", type=int, help="作业 ID（用 todos 查到）")

    p_mat = sub.add_parser("materials", help="列出课件")
    p_mat.add_argument("cid", type=int, help="课程 ID（用 courses / find 查到）")

    p_dl = sub.add_parser("download", help="下载文件（服务器返回 URL 时可用）")
    p_dl.add_argument("id", type=int, help="upload_id")
    p_dl.add_argument("name", nargs="?", default=None, help="自定义保存文件名（可选）")

    p_probe = sub.add_parser("probe-upload", help="诊断单个 upload_id 的 URL 来源")
    p_probe.add_argument("id", type=int, help="upload_id")
    p_probe.add_argument("--course", type=int, default=None, help="可选：指定课程 ID，直接从该课 activities 里找 upload")
    p_probe.add_argument("--scan-courses", action="store_true", help="缓存未命中时扫描当前账号全部课程")
    p_probe.add_argument("--show-url", action="store_true", help="显示完整 URL（可能包含临时签名参数）")
    p_probe.add_argument("--no-probe", action="store_true", help="只列 URL 来源，不做 HEAD/Range 连通性测试")

    p_crawl = sub.add_parser("crawl-urls", help="扫描课程附件，定位下载 URL 来源")
    p_crawl.add_argument("--course", type=int, action="append", help="课程 ID，可重复传；不传则扫描当前账号课程")
    p_crawl.add_argument("--max-courses", type=int, default=0, help="未指定 --course 时最多扫描多少门课，0 表示全部")
    p_crawl.add_argument("--locked-only", action="store_true", help="只扫描 allow_download=false 的附件")
    p_crawl.add_argument("--limit", type=int, default=0, help="最多扫描多少个附件，0 表示不限")
    p_crawl.add_argument("--show-url", action="store_true", help="显示完整 URL（可能包含临时签名参数）")
    p_crawl.add_argument("--no-probe", action="store_true", help="只列 URL 来源，不做 HEAD/Range 连通性测试")

    p_fn = sub.add_parser("find", help="搜索课程")
    p_fn.add_argument("keyword", help="课程名关键词")

    args = parser.parse_args()
    {
        "login":     cmd_login,
        "courses":   cmd_courses,
        "todos":     cmd_todos,
        "homework":  cmd_homework,
        "materials": cmd_materials,
        "download":  cmd_download,
        "probe-upload": cmd_probe_upload,
        "crawl-urls": cmd_crawl_urls,
        "find":      cmd_find,
    }[args.cmd](args)


if __name__ == "__main__":
    main()
