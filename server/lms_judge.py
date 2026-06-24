from __future__ import annotations

import json
import os
import sys
import types
from typing import Any

import requests

from .lms_credentials import CredentialError
from .lms_login import LmsLoginError
from .lms_scores import (
    GMIS_LOGIN_URL,
    JWXT_LOGIN_URL,
    ScoreQueryError,
    _error_payload,
    _login_to_service,
    _norm_text,
)


GSTE_LOGIN_URL = "https://cas.xjtu.edu.cn/login?TARGET=http%3A%2F%2Fgste.xjtu.edu.cn%2Flogin.do"

_XJTUTOOLBOX_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "XJTUToolBox-main"))
if _XJTUTOOLBOX_ROOT not in sys.path:
    sys.path.insert(0, _XJTUTOOLBOX_ROOT)


def _install_fake_useragent_fallback() -> None:
    try:
        __import__("fake_useragent")
        return
    except ImportError:
        pass

    class UserAgent:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        @property
        def random(self) -> str:
            return (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/148.0.0.0 Safari/537.36"
            )

    module = types.ModuleType("fake_useragent")
    module.UserAgent = UserAgent
    sys.modules["fake_useragent"] = module


_install_fake_useragent_fallback()

try:
    from jwxt import AutoJudge, QuestionnaireTemplate
    from gste.judge import GraduateAutoJudge
    from gmis.lesson_detail import GraduateLessonDetail
    from gmis.score import GraduateScore
except Exception as exc:  # pragma: no cover - import error is reported to UI at runtime
    AutoJudge = None
    QuestionnaireTemplate = None
    GraduateAutoJudge = None
    GraduateLessonDetail = None
    GraduateScore = None
    _IMPORT_ERROR = exc
else:
    _IMPORT_ERROR = None


class JudgeQueryError(ScoreQueryError):
    pass


def _ensure_imports() -> None:
    if _IMPORT_ERROR is not None:
        raise JudgeQueryError(
            "JUDGE_IMPORT_FAILED",
            f"一键评教模块加载失败：{_IMPORT_ERROR}",
            http_status=500,
        )


def _score_to_undergraduate_int(score: Any) -> int:
    text = str(score or "100").strip().lower()
    mapping = {
        "hundred": 100,
        "100": 100,
        "excellent": 100,
        "eighty": 80,
        "80": 80,
        "good": 80,
        "sixty": 60,
        "60": 60,
        "forty": 40,
        "40": 40,
    }
    try:
        value = int(mapping.get(text, text))
    except Exception:
        value = 100
    allowed = (100, 80, 60, 40)
    return min(allowed, key=lambda item: abs(item - value))


def _score_to_graduate_level(score: Any) -> int:
    text = str(score or "3").strip().lower()
    mapping = {
        "excellent": 3,
        "优秀": 3,
        "优": 3,
        "3": 3,
        "good": 2,
        "良好": 2,
        "良": 2,
        "2": 2,
        "pass": 1,
        "合格": 1,
        "1": 1,
        "fail": 0,
        "不合格": 0,
        "0": 0,
    }
    try:
        value = int(mapping.get(text, text))
    except Exception:
        value = 3
    return max(0, min(3, value))


def _undergraduate_summary(q: Any) -> dict[str, Any]:
    return {
        "courseName": getattr(q, "KCM", ""),
        "teacher": getattr(q, "BPJS", ""),
        "questionnaireName": getattr(q, "WJMC", ""),
        "term": getattr(q, "XNXQDM", ""),
    }


def _graduate_summary(q: Any) -> dict[str, Any]:
    return {
        "courseName": getattr(q, "KCMC", ""),
        "teacher": getattr(q, "JSXM", ""),
        "questionnaireName": f"{getattr(q, 'TERMNAME', '')} {getattr(q, 'BJMC', '')}".strip(),
        "term": getattr(q, "TERMNAME", ""),
    }


def _undergraduate_template_type(questionnaire: Any) -> Any:
    title = str(getattr(questionnaire, "WJMC", "") or "")
    type_map = [
        (QuestionnaireTemplate.Type.THEORY, "理论课"),
        (QuestionnaireTemplate.Type.IDEOLOGY, "思政课"),
        (QuestionnaireTemplate.Type.GENERAL, "通识课"),
        (QuestionnaireTemplate.Type.EXPERIMENT, "实验课"),
        (QuestionnaireTemplate.Type.PROJECT, "项目设计课"),
        (QuestionnaireTemplate.Type.PHYSICAL, "体育课"),
    ]
    for type_value, label in type_map:
        if label in title:
            return type_value
    return QuestionnaireTemplate.Type.THEORY


def _undergraduate_template_score(score: int) -> Any:
    score_map = {
        100: QuestionnaireTemplate.Score.HUNDRED,
        80: QuestionnaireTemplate.Score.EIGHTY,
        60: QuestionnaireTemplate.Score.SIXTY,
        40: QuestionnaireTemplate.Score.FORTY,
    }
    return score_map.get(score, QuestionnaireTemplate.Score.HUNDRED)


def _load_undergraduate_template(questionnaire: Any, score: int) -> Any:
    type_names = {
        QuestionnaireTemplate.Type.THEORY: "theory",
        QuestionnaireTemplate.Type.PHYSICAL: "physical",
        QuestionnaireTemplate.Type.PROJECT: "project",
        QuestionnaireTemplate.Type.EXPERIMENT: "experiment",
        QuestionnaireTemplate.Type.IDEOLOGY: "ideology",
        QuestionnaireTemplate.Type.GENERAL: "general",
    }
    score_names = {
        QuestionnaireTemplate.Score.HUNDRED: "100",
        QuestionnaireTemplate.Score.EIGHTY: "80",
        QuestionnaireTemplate.Score.SIXTY: "60",
        QuestionnaireTemplate.Score.FORTY: "40",
    }
    type_value = _undergraduate_template_type(questionnaire)
    score_value = _undergraduate_template_score(score)
    filename = f"{type_names[type_value]}-{score_names[score_value]}.json"
    path = os.path.join(_XJTUTOOLBOX_ROOT, "jwxt", "templates", filename)
    with open(path, "r", encoding="utf-8") as f:
        return QuestionnaireTemplate.from_json(json.load(f))


def _fill_undergraduate_questionnaire(
        judge: Any,
        questionnaire: Any,
        username: str,
        score: int,
        comment: str) -> tuple[bool, str]:
    data = judge.questionnaireData(questionnaire, username)
    options = judge.questionnaireOptions(questionnaire, username)
    template = _load_undergraduate_template(questionnaire, score)
    subjective_text = comment or "无"

    for template_data in template.data:
        if getattr(template_data, "TXDM", "") != "01":
            template_data.ZGDA = subjective_text

    for one_data in data:
        template.complete(
            one_data,
            options,
            True,
            default_score=score,
            default_subjective=subjective_text,
        )
    return judge.submitQuestionnaire(questionnaire, data)


def _query_undergraduate(action: str, score: int, comment: str) -> dict[str, Any]:
    session, username = _login_to_service(JWXT_LOGIN_URL, "undergraduate")
    judge = AutoJudge(session)
    questionnaires = judge.unfinishedQuestionnaires()
    results: list[dict[str, Any]] = []

    if action == "status":
        return {
            "ok": True,
            "account_type": "undergraduate",
            "username": username,
            "count": len(questionnaires),
            "questionnaires": [_undergraduate_summary(q) for q in questionnaires],
        }

    for questionnaire in questionnaires:
        item = _undergraduate_summary(questionnaire)
        try:
            success, msg = _fill_undergraduate_questionnaire(judge, questionnaire, username, score, comment)
            item.update({"ok": bool(success), "message": msg or ("提交成功" if success else "提交失败")})
        except Exception as exc:
            item.update({"ok": False, "message": str(exc)})
        results.append(item)

    success_count = sum(1 for item in results if item.get("ok"))
    return {
        "ok": success_count == len(results),
        "partial_ok": success_count > 0,
        "account_type": "undergraduate",
        "username": username,
        "count": len(questionnaires),
        "success_count": success_count,
        "results": results,
    }


def _query_graduate(action: str, score: int, comment: str) -> dict[str, Any]:
    gste_session, username = _login_to_service(GSTE_LOGIN_URL, "postgraduate")
    util = GraduateAutoJudge(gste_session)
    questionnaires = [q for q in util.getQuestionnaires() if getattr(q, "ASSESSMENT", "") == "allow"]

    if action == "status":
        return {
            "ok": True,
            "account_type": "postgraduate",
            "username": username,
            "count": len(questionnaires),
            "questionnaires": [_graduate_summary(q) for q in questionnaires],
        }

    gmis_session, _ = _login_to_service(GMIS_LOGIN_URL, "postgraduate")
    lesson_util = GraduateLessonDetail(gmis_session)
    score_util = GraduateScore(gmis_session)
    all_courses = score_util.all_course_info()
    results: list[dict[str, Any]] = []
    subjective_text = comment or "无"

    for questionnaire in questionnaires:
        item = _graduate_summary(questionnaire)
        try:
            data = util.getQuestionnaireData(questionnaire)
            if hasattr(data, "set_all_textarea"):
                data.set_all_textarea(subjective_text)
            basic_info = lesson_util.lesson_detail(getattr(questionnaire, "KCBH", ""))
            is_main_course = False
            for lesson in all_courses:
                if lesson.get("courseName") == getattr(questionnaire, "KCMC", ""):
                    is_main_course = lesson.get("type") == "学位课程"
                    break
            util.completeQuestionnaire(
                questionnaire,
                data,
                basic_info,
                score,
                {},
                is_main_course,
            )
            util.submitQuestionnaire(questionnaire, data)
            item.update({"ok": True, "message": "提交成功"})
        except Exception as exc:
            item.update({"ok": False, "message": str(exc)})
        results.append(item)

    success_count = sum(1 for item in results if item.get("ok"))
    return {
        "ok": success_count == len(results),
        "partial_ok": success_count > 0,
        "account_type": "postgraduate",
        "username": username,
        "count": len(questionnaires),
        "success_count": success_count,
        "results": results,
    }


def _run_for_type(account_type: str, action: str, body: dict[str, Any]) -> dict[str, Any]:
    _ensure_imports()
    comment = _norm_text(body.get("comment")) or "无"
    if account_type == "undergraduate":
        return _query_undergraduate(action, _score_to_undergraduate_int(body.get("score")), comment)
    if account_type == "postgraduate":
        graduate_score = body.get("graduate_score", body.get("score"))
        return _query_graduate(action, _score_to_graduate_level(graduate_score), comment)
    raise JudgeQueryError("BAD_REQUEST", "account_type 只能是 auto、undergraduate 或 postgraduate。", http_status=400)


def handle_lms_judge_request(body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    try:
        action = str(body.get("action") or "status").strip().lower()
        if action not in ("status", "submit_all"):
            raise JudgeQueryError("BAD_REQUEST", "action 只能是 status 或 submit_all。", http_status=400)

        account_type = str(body.get("account_type") or "auto").strip().lower()
        if account_type == "auto":
            results: list[dict[str, Any]] = []
            errors: list[dict[str, str]] = []
            for candidate in ("undergraduate", "postgraduate"):
                try:
                    result = _run_for_type(candidate, action, body)
                    result["mode"] = "auto"
                    results.append(result)
                    if action == "status" and result.get("count", 0) > 0:
                        return 200, {"ok": True, **result, "warnings": errors}
                    if (
                            action == "submit_all"
                            and result.get("count", 0) > 0
                            and (result.get("partial_ok") or result.get("ok"))):
                        return 200, {"ok": True, **result, "warnings": errors}
                except CredentialError:
                    raise
                except (JudgeQueryError, ScoreQueryError, LmsLoginError, requests.RequestException) as exc:
                    detail = _error_payload(exc)
                    detail["account_type"] = candidate
                    errors.append(detail)
            if results:
                # 没有待评教课程时返回第一个成功身份的空列表。
                return 200, {"ok": True, **results[0], "mode": "auto", "warnings": errors}
            return 200, {
                "ok": False,
                "error": "JUDGE_QUERY_FAILED",
                "message": "自动识别本科/研究生评教均未成功，请手动选择身份后重试。",
                "errors": errors,
            }

        result = _run_for_type(account_type, action, body)
        return 200, {"ok": True, **result, "mode": "manual"}

    except CredentialError as exc:
        return exc.http_status, {"ok": False, "error": exc.code, "message": exc.message}
    except JudgeQueryError as exc:
        return exc.http_status, {"ok": False, "error": exc.code, "message": exc.message}
    except ScoreQueryError as exc:
        return exc.http_status, {"ok": False, "error": exc.code, "message": exc.message}
    except LmsLoginError as exc:
        return exc.http_status, {"ok": False, "error": exc.code, "message": exc.message}
    except requests.RequestException as exc:
        return 200, {"ok": False, "error": "NETWORK_ERROR", "message": f"连接学校评教系统失败：{exc}"}
    except Exception as exc:
        return 500, {"ok": False, "error": "INTERNAL_ERROR", "message": f"一键评教内部错误：{exc}"}
