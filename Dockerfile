FROM python:3.14-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HAUSHALTSBUCH_DB=/data/haushaltsbuch.db

# Zeitzonendaten: Ohne sie ignoriert der Container TZ=Europe/Berlin und rechnet in
# UTC – "heute" würde dann erst um 2 Uhr nachts umspringen.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tzdata \
 && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY web ./web

# Daten (Datenbank, Bankschlüssel) liegen außerhalb des Containers in /data.
VOLUME ["/data"]
EXPOSE 8000

# Läuft nicht als root.
RUN useradd --create-home --uid 1000 haushalt && mkdir -p /data && chown haushalt /data
USER haushalt

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
