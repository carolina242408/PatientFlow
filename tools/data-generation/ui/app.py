#!/usr/bin/env python3
"""Web Configuration UI module for the PatientFlow Data Generator.

Integrated directly into the FastAPI server (`pfgen/server.py`) at `/ui` inside
the same Docker container (`pfi-data-generator` on port 8001), and can also be
launched standalone.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import HTMLResponse

UI_DIR = Path(__file__).resolve().parent
INDEX_FILE = UI_DIR / "index.html"

router = APIRouter(tags=["UI"])


@router.get("/ui", response_class=HTMLResponse)
def get_config_ui() -> HTMLResponse:
    """Serve the PatientFlow Data Generator configuration and stream control panel."""
    if not INDEX_FILE.exists():
        raise HTTPException(status_code=404, detail="UI index.html not found")
    return HTMLResponse(content=INDEX_FILE.read_text(encoding="utf-8"))
