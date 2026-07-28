FROM python:3.12-slim@sha256:57cd7c3a7a273101a6485ba99423ee568157882804b1124b4dd04266317710de

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp \
    PORT=8080

RUN groupadd --system --gid 10001 validator && \
    useradd --system --uid 10001 --gid validator --home-dir /nonexistent --shell /usr/sbin/nologin validator

WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir --requirement requirements.txt && \
    rm -rf /root/.cache

COPY --chown=validator:validator server.py ./server.py

USER validator
EXPOSE 8080
ENTRYPOINT ["python", "server.py"]
