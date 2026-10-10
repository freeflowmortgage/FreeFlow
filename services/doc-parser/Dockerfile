FROM public.ecr.aws/amazonlinux/amazonlinux:2023-minimal@sha256:5c546c873970e79e5c9152cd9c8a9c7013824352bc89071d21feb15ad68496aa

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

WORKDIR /app

# AL2023 locks packages to the image's release; --releasever=latest pulls current security fixes.
RUN microdnf --releasever=latest update -y \
    && microdnf --releasever=latest install -y \
        libgomp \
        libX11 \
        libxcb \
        mesa-libGL \
        python3.11 \
        python3.11-pip \
        shadow-utils \
    && microdnf clean all \
    && rm -rf /var/cache/dnf

COPY requirements.txt .
RUN --mount=type=cache,id=freeflow-pip-cache,target=/root/.cache/pip,sharing=locked \
    python3.11 -m pip install -r requirements.txt \
    && python3.11 -m pip check

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
