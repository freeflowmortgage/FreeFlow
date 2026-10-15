FROM python:3.11-slim-bookworm@sha256:0a310eeecf4e1f5a0743f9a6520c90c88d089c903ca5fd283f501e3a805f5f89 AS builder

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /build

# Keep package installation and build tooling out of the final runtime. The
# headless OpenCV wheel provides the same cv2 API without X11/GL libraries.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# RapidOCR declares the GUI OpenCV distribution even though it only consumes
# the cv2 API. Resolve its transitive dependencies first, then replace that
# payload with the ABI-compatible headless wheel and remove the GUI artifacts.
RUN --mount=type=cache,id=freeflow-pip-cache,target=/root/.cache/pip,sharing=locked \
    python3.11 -m pip install --no-compile --target /opt/parser -r requirements.txt \
    && python3.11 -m pip install --no-compile --target /opt/parser --upgrade --force-reinstall --no-deps \
        opencv-python-headless==4.14.0.94 \
    && rm -rf /opt/parser/opencv_python-*.dist-info /opt/parser/opencv_python.libs \
    && PYTHONPATH=/opt/parser python3.11 -c "import cv2, fitz, numpy, onnxruntime, pypdfium2"

FROM public.ecr.aws/amazonlinux/amazonlinux:2023-minimal@sha256:fe18d1ee02440b6480eb4a045be052e9aeaf9bf5029368f09d3425ddab2bfa0a

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/opt/parser:/app

WORKDIR /app

RUN microdnf --releasever=latest update -y \
    && microdnf --releasever=latest install -y libgomp python3.11 \
    && microdnf clean all \
    && rm -rf /var/cache/dnf

COPY --from=builder --chown=8888:8888 /opt/parser /opt/parser
COPY --chown=8888:8888 src/ ./
COPY --chown=8888:8888 templates /app/templates

RUN mkdir -p /tmp/freeflow \
    && chown -R 8888:8888 /app /opt/parser /tmp/freeflow

USER 8888:8888

VOLUME ["/tmp/freeflow"]

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["python3.11", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=2)"]

CMD ["python3.11", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080", "--no-access-log"]
