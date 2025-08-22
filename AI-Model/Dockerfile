FROM python:3.11-bookworm

WORKDIR /app

# Update certificates and install curl
RUN apt-get update && apt-get install -y ca-certificates curl && update-ca-certificates && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Install Python dependencies with timeout, retries, and IPv4
RUN pip --default-timeout=300 install --no-cache-dir -i https://pypi.org/simple -r requirements.txt
CMD ["python", "app.py"]
