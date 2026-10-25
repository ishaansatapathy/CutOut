# GPU service. Needs an NVIDIA GPU + nvidia-container-toolkit on the host (docker-compose.yml
# requests it via `deploy.resources.reservations.devices`). Not meant to be reachable from the
# internet — only the web service's internal compose network should ever talk to this container
# (see docker-compose.yml: no ports are published for this service).
FROM nvidia/cuda:12.8.0-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive PYTHONUNBUFFERED=1 HF_HUB_DISABLE_SYMLINKS_WARNING=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv ffmpeg git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
# cu128 wheels must match the host's driver; if your GPU/driver needs a different CUDA build,
# change both this index URL and the base image tag above together.
RUN python3 -m pip install --no-cache-dir --upgrade pip \
    && python3 -m pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cu128 \
    && python3 -m pip install --no-cache-dir -r requirements.txt \
    && SAM2_BUILD_CUDA=0 python3 -m pip install --no-cache-dir --no-build-isolation \
       git+https://github.com/facebookresearch/sam2.git

COPY app ./app

EXPOSE 8100
CMD ["python3", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100"]
