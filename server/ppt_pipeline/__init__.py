"""PPT pipeline package.

This package turns a high-level user request into the structured JSON already
understood by :mod:`server.ppt_core`.
"""

from .pipeline import build_deck_spec, run_pipeline

__all__ = ["build_deck_spec", "run_pipeline"]
