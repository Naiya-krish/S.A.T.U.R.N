# S.A.T.U.R.N. backend — Cloud Run image.
#
# Notes
#  * python:3.11-slim matches the version the test suite runs on.
#  * No secrets are baked in. Vertex AI uses the Cloud Run service identity via
#    Application Default Credentials; the FIRMS key comes from Secret Manager.
#  * Runs as a non-root user.

FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Build tools are only needed while wheels are compiled, so they live in a
# throwaway layer.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y --auto-remove build-essential

COPY backend/app ./app
COPY backend/run.py ./run.py

# Non-root runtime user.
RUN useradd --create-home --uid 10001 saturn \
    && chown -R saturn:saturn /app
USER saturn

ENV SATURN_ENV=production \
    BACKEND_HOST=0.0.0.0 \
    BACKEND_PORT=8080 \
    GOOGLE_CLOUD_LOCATION=us-central1

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/health" || exit 1

# run.py reads BACKEND_HOST/BACKEND_PORT from the environment.
CMD ["python", "run.py"]
