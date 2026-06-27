"""Optional LLM helpers for PPT planning.

The pipeline must remain useful without network credentials, so this module is
best-effort by design: callers ask for JSON, and any missing configuration,
network error, or malformed response simply returns ``None`` so rule-based
planners can take over.
"""

import json
import os
import re
import urllib.error
import urllib.request


DEFAULT_BASE_URL = "https://api.openai.com/v1"
DEFAULT_MODEL = "gpt-4o-mini"


def llm_enabled(options=None):
    """Return True when LLM planning is explicitly/configurably available."""
    cfg = _llm_config(options)
    return bool(cfg.get("api_key") and cfg.get("base_url") and cfg.get("model"))


def generate_json(system_prompt, user_prompt, options=None, fallback=None):
    """Ask an OpenAI-compatible chat API for a JSON object/list.

    Parameters are intentionally generic so the planner modules do not depend on
    a specific vendor. Supported configuration sources, in priority order:

    - options["llm"] dict: api_key/base_url/model/temperature/timeout
    - top-level options: llm_api_key/llm_base_url/llm_model
    - environment: PPT_LLM_API_KEY/PPT_LLM_BASE_URL/PPT_LLM_MODEL
    """
    cfg = _llm_config(options)
    if not cfg.get("api_key"):
        return fallback

    url = cfg["base_url"].rstrip("/")
    if not url.endswith("/chat/completions"):
        url += "/chat/completions"

    payload = {
        "model": cfg["model"],
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        "temperature": cfg["temperature"],
        "response_format": {"type": "json_object"},
    }
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + cfg["api_key"],
    }
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")

    try:
        with urllib.request.urlopen(req, timeout=cfg["timeout"]) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
        body = json.loads(raw)
        content = body.get("choices", [{}])[0].get("message", {}).get("content", "")
        return _parse_json_content(content, fallback=fallback)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError, IndexError, ValueError):
        return fallback


def _llm_config(options=None):
    options = options or {}
    nested = options.get("llm") if isinstance(options.get("llm"), dict) else {}
    base_url = (
        nested.get("base_url")
        or nested.get("api_base")
        or options.get("llm_base_url")
        or os.getenv("PPT_LLM_BASE_URL")
        or DEFAULT_BASE_URL
    )
    model = nested.get("model") or options.get("llm_model") or os.getenv("PPT_LLM_MODEL") or DEFAULT_MODEL
    api_key = nested.get("api_key") or options.get("llm_api_key") or os.getenv("PPT_LLM_API_KEY") or ""
    try:
        temperature = float(nested.get("temperature", options.get("llm_temperature", 0.3)))
    except Exception:
        temperature = 0.3
    try:
        timeout = int(nested.get("timeout", options.get("llm_timeout", 45)))
    except Exception:
        timeout = 45
    return {
        "api_key": str(api_key).strip(),
        "base_url": str(base_url).strip() or DEFAULT_BASE_URL,
        "model": str(model).strip() or DEFAULT_MODEL,
        "temperature": temperature,
        "timeout": timeout,
    }


def _parse_json_content(content, fallback=None):
    text = str(content or "").strip()
    if not text:
        return fallback
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"(\{.*\}|\[.*\])", text, flags=re.DOTALL)
        if not m:
            return fallback
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            return fallback
