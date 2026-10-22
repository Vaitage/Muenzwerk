# Python 3.14 seit 1.11.0 (vorher 3.12); alle Pakete gibt es fertig für arm64 (Raspberry Pi).
# Festgepinnt (seit 1.12.0): Tag + Prüfsumme des Images. Gebaut wird genau das getestete Image;
# Updates schlägt Dependabot monatlich vor.
FROM python:3.14-slim@sha256:0b566a9f30a60730df33c26ac62dedb55393d8814645cd03543b67bf8987f3a1

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
# Genaue Versionen mit Prüfsummen (aus requirements.in, siehe dort); abweichende Dateien bricht pip ab
RUN pip install --no-cache-dir --require-hashes -r requirements.txt

COPY app ./app
COPY web ./web

# Daten (Datenbank, Bankschlüssel) liegen außerhalb des Containers in /data.
VOLUME ["/data"]
EXPOSE 8000

# Läuft nicht als root.
RUN useradd --create-home --uid 1000 haushalt && mkdir -p /data && chown haushalt /data
USER haushalt

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
