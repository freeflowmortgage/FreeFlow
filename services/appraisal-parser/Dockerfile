FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    TMPDIR=/tmp/zdr_scratch

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ .

RUN groupadd --gid 8888 appgroup \
    && useradd --uid 8888 --gid appgroup --shell /usr/sbin/nologin --no-create-home appuser \
    && mkdir -p /tmp/zdr_scratch \
    && chown -R appuser:appgroup /app /tmp/zdr_scratch \
    && chmod 700 /tmp/zdr_scratch

USER appuser

# Run with: --tmpfs /tmp/zdr_scratch:rw,noexec,nosuid,size=32m
EXPOSE 8081

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8081/health', timeout=2)"]

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8081"]
