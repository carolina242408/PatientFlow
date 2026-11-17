FROM python:3.12-slim
WORKDIR /app
ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    HF_HUB_DISABLE_IMPLICIT_TOKEN=1 \
    DO_NOT_TRACK=1
COPY requirements.txt .
ARG TORCH_INDEX_URL=https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir torch==2.14.1 --index-url ${TORCH_INDEX_URL} \
    && pip install --no-cache-dir -r requirements.txt
COPY kumo_assets.py .
# Only public weights/license are downloaded here. No CSV or patient data enters
# the build context or image. The serving process never downloads artifacts.
RUN python kumo_assets.py --output /opt/kumo-small
ENV HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    WANDB_MODE=disabled \
    KUMO_MODEL_DIR=/opt/kumo-small \
    KUMO_DATASET=/data/context.csv \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp
COPY main.py decision_rules.py discharge_model.py ./
RUN python -m compileall -q main.py decision_rules.py discharge_model.py kumo_assets.py \
    && useradd --uid 10001 --no-create-home algorithms
USER 10001:10001
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]
