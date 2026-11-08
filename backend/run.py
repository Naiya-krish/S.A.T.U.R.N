"""Entrypoint: ``python run.py``.

Reads BACKEND_HOST / BACKEND_PORT from the environment or .env for local
development. On Cloud Run (and most container hosts) the platform injects
`PORT` instead, so that is honoured with priority — otherwise the container
listens on the wrong port and the revision fails its startup probe.
"""

from __future__ import annotations

import os

import uvicorn

from app.config import get_settings

if __name__ == "__main__":
    s = get_settings()

    # Hosting platforms win: PORT is authoritative when present.
    port = int(os.environ.get("PORT") or s.backend_port)
    host = os.environ.get("HOST") or s.backend_host

    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=False,
        log_level=s.log_level.lower(),
    )
