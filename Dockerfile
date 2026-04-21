# Dockerfile for backend
FROM ghcr.io/astral-sh/uv:python3.12-bookworm

# Reproducible builds - fixed timestamp for layer hashing
ENV SOURCE_DATE_EPOCH=0

WORKDIR /app

# Install Python dependencies
COPY uv.lock pyproject.toml ./
RUN uv sync --locked --no-dev

# Copy the application code
COPY main.py ./
COPY app ./app

# Set environment variables
ENV PATH="/app/.venv/bin:$PATH"

# Create data directory
RUN mkdir -p /data && chmod 777 /data

EXPOSE 9090

CMD ["python", "main.py"]
