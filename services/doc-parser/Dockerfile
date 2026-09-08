FROM public.ecr.aws/amazonlinux/amazonlinux:2023-minimal@sha256:279612ae66723f3f83ffdfe0045c428827d167c1954b0883e018985b8bb1d3e3

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app

WORKDIR /app

RUN microdnf update -y \
    && microdnf install -y \
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
RUN python3.11 -m pip install --no-cache-dir -r requirements.txt \
    && python3.11 -m pip check

COPY src/server.py src/ai_pdf_converter.py src/pdf_splitter.py src/schedule_e_grid.py ./
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
