FROM python:3.11-slim-bookworm@sha256:0a310eeecf4e1f5a0743f9a6520c90c88d089c903ca5fd283f501e3a805f5f89

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

WORKDIR /app

# Upgrade the minimal Debian base before installing OpenCV's bounded native
# runtime dependencies. Build tools remain outside the final image.
RUN apt-get update \
    && apt-get upgrade -y \
    && apt-get install -y --no-install-recommends \
        libgl1 \
        libglib2.0-0 \
        libgomp1 \
        libsm6 \
        libxext6 \
        libxrender1 \
        libxcb1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN --mount=type=cache,id=freeflow-pip-cache,target=/root/.cache/pip,sharing=locked \
    python3.11 -m pip install --no-compile -r requirements.txt \
    && python3.11 -m pip check \
    && rm -rf /usr/local/lib/python3.11/site-packages/pip* \
        /usr/local/bin/pip /usr/local/bin/pip3 /usr/local/bin/pip3.11

COPY src/ ./
COPY templates /app/templates

RUN groupadd -g 8888 appgroup && \
    useradd -u 8888 -g appgroup -s /bin/false -M appuser && \
    mkdir -p /tmp/freeflow && \
    chown -R appuser:appgroup /app /tmp/freeflow

USER appuser

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["python3.11", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=2)"]

CMD ["python3.11", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
