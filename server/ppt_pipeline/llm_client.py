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


def _endpoint_url(cfg, default_path):
    """Build the final endpoint URL from the current chat configuration.

    The main app stores Base URL and API Path separately.  PPT mode should not
    force every provider into OpenAI `/chat/completions`; it should call the
    same style endpoint the current conversation uses.
    """
    url = (cfg.get("base_url") or DEFAULT_BASE_URL).strip().rstrip("/")
    path = (cfg.get("api_path") or default_path or "").strip()
    if not path:
        return url
    if not path.startswith("/"):
        path = "/" + path
    low_url = url.lower()
    low_path = path.lower()
    known = ("/chat/completions", "/responses", "/messages")
    if low_url.endswith(low_path) or any(low_url.endswith(k) for k in known):
        return url
    return url + path


def _headers(cfg):
    fmt = (cfg.get("api_format") or "openai").lower()
    headers = {"Content-Type": "application/json"}
    if fmt == "anthropic":
        headers["x-api-key"] = cfg.get("api_key") or ""
        headers["anthropic-version"] = cfg.get("anthropic_version") or "2023-06-01"
    else:
        headers["Authorization"] = "Bearer " + (cfg.get("api_key") or "")
    extra = cfg.get("headers") if isinstance(cfg.get("headers"), dict) else {}
    headers.update(extra)
    return headers


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
    fmt = (cfg.get("api_format") or "openai").lower()
    if fmt == "anthropic":
        url = _endpoint_url(cfg, "/messages")
        payload = {
            "model": cfg["model"],
            "system": system_prompt,
            "messages": [{"role": "user", "content": user_prompt}],
            "max_tokens": cfg["max_tokens"],
            "temperature": cfg["temperature"],
        }
    elif fmt == "responses":
        url = _endpoint_url(cfg, "/responses")
        payload = {
            "model": cfg["model"],
            "instructions": system_prompt,
            "input": [{"role": "user", "content": user_prompt}],
            "temperature": cfg["temperature"],
            "max_output_tokens": cfg["max_tokens"],
        }
    else:
        url = _endpoint_url(cfg, "/chat/completions")
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
    req = urllib.request.Request(url, data=data, headers=_headers(cfg), method="POST")

    try:
        with urllib.request.urlopen(req, timeout=cfg["timeout"]) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
        body = json.loads(raw)
        if fmt == "anthropic":
            content = "".join(part.get("text", "") for part in body.get("content", []) if isinstance(part, dict))
        elif fmt == "responses":
            content = body.get("output_text") or _extract_responses_text(body)
        else:
            content = body.get("choices", [{}])[0].get("message", {}).get("content", "")
        return _parse_json_content(content, fallback=fallback)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, KeyError, IndexError, ValueError):
        return fallback


def _llm_config(options=None):
    options = options or {}
    nested = options.get("llm") if isinstance(options.get("llm"), dict) else {}
    api_format = str(nested.get("api_format") or options.get("llm_api_format") or os.getenv("PPT_LLM_API_FORMAT") or "openai").strip().lower()
    if api_format not in ("openai", "responses", "anthropic"):
        api_format = "openai"
    api_path = str(nested.get("api_path") or options.get("llm_api_path") or os.getenv("PPT_LLM_API_PATH") or "").strip()
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
    try:
        max_tokens = int(nested.get("max_tokens", options.get("llm_max_tokens", os.getenv("PPT_LLM_MAX_TOKENS") or 2048)))
    except Exception:
        max_tokens = 2048
    headers = {}
    raw_headers = nested.get("headers") or options.get("llm_headers") or options.get("llm_json_headers") or os.getenv("PPT_LLM_HEADERS") or ""
    if isinstance(raw_headers, dict):
        headers = raw_headers
    elif isinstance(raw_headers, str) and raw_headers.strip():
        try: headers = json.loads(raw_headers)
        except Exception: headers = {}
    return {
        "api_key": str(api_key).strip(),
        "base_url": str(base_url).strip() or DEFAULT_BASE_URL,
        "api_format": api_format,
        "api_path": api_path,
        "model": str(model).strip() or DEFAULT_MODEL,
        "temperature": temperature,
        "timeout": timeout,
        "max_tokens": max(256, min(max_tokens, 8192)),
        "headers": headers,
    }


def _extract_responses_text(body):
    parts = []
    for item in body.get("output", []) if isinstance(body, dict) else []:
        if not isinstance(item, dict):
            continue
        for c in item.get("content", []) or []:
            if isinstance(c, dict) and c.get("text"):
                parts.append(c.get("text"))
    return "".join(parts)


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
