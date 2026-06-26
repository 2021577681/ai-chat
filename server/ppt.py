# ============================================================
# server/ppt.py - compatibility facade for PPT tools
# ============================================================
# Main implementation lives in server/ppt_core.py to keep this public import stable.

from .ppt_core import PptMixin

__all__ = ['PptMixin']
