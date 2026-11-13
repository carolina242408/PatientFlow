FROM python:3.12-slim

WORKDIR /app
COPY pyproject.toml README.md ./
COPY src ./src
COPY alembic.ini ./
COPY alembic ./alembic
RUN pip install --no-cache-dir .

EXPOSE 8001
CMD ["sh", "-c", "alembic upgrade head && uvicorn bed_allocation.main:app --app-dir src --host 0.0.0.0 --port 8001"]
