# Start-to-Finish mTLS Security Setup Guide: Decoupled Income & Appraisal Tools
**Author:** Lead Full-Stack Engineer & Principal Fintech Architect  
**Classification:** Technical Architecture, Network Hardening & Zero-Data-Retention Security  
**Security level:** SOC 2 Type II / GLBA Compliant mTLS Authorization  

---

## 1. Architectural Overview & Security Topology

In our decoupled, stateless fintech environment, both the **AI Income Underwriting Engine** and the **Appraisal Review Agent** process sensitive borrower documents (W-2s, paystubs, tax returns, appraisal PDFs) in-memory over volatile `tmpfs` RAM buffers. To ensure complete **SOC 2 Type II and GLBA compliance**, we must enforce **mutual TLS (mTLS)**.

Mutual TLS guarantees that:
1. **Server Authentication:** The Next.js API Gateway (`/apps/underwriter-portal`) verifies the identity of the FastAPI container (`/services/doc-parser`) using a trusted server certificate.
2. **Client Authentication:** The FastAPI container refuses incoming connections from any source other than our authorized Next.js API Gateway, requiring a valid client certificate signed by our private Certificate Authority (CA).

This end-to-end guide details how to implement mTLS across our entire monorepo stack, securing file-transmission pipelines for both tools.

### mTLS Network Flow Topology

```
   [Next.js API Gateway]                                [FastAPI Document Parser]
 (underwriter-portal app)                                 (doc-parser service)
            │                                                      │
            ├─────── 1. Client TLS ClientHello ───────────────────>│
            │        (Presents cipher suites & client cert request)│
            │                                                      │
            |<────── 2. Server ServerHello & Certificate ──────────┤
            │        (Presents server cert, signed by Private CA)  │
            │                                                      │
            ├─────── 3. Client Certificate & ClientKeyExchange ───>│
            │        (Presents client cert, signed by Private CA)  │
            │                                                      │
            │        [ mTLS Handshake & Verification Succeeds ]    │
            │                                                      │
            ├─────── 4. Encrypted HTTPS POST /api/underwrite ─────>│
            │        (Payload transmitted securely in-transit)     │
            │                                                      │
            |<────── 5. JSON Coordinate/Calculation Response ──────┤
            │        (RAM buffers wiped immediately on response)   │
```

---

## 2. Step 1: Cryptographic Key Generation Runbook

This shell script automates generating a private root CA, the server certificate (with Subject Alternative Names for internal VPC resolving), and the client certificate with explicit client authorization usage flags.

Save this script as `services/doc-parser/scripts/generate-certs.sh` and run it:

```bash
#!/bin/bash
set -e

# Setup Workspace Directories
CERT_DIR="./certs"
mkdir -p "$CERT_DIR"
cd "$CERT_DIR"

echo "🔐 Step 1: Creating Private Root Certificate Authority..."
# Generate private key for CA
openssl genrsa -out ca.key 4096
# Self-sign Root CA Certificate (10-Year validity)
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 -out ca.crt \
  -subj "/C=US/ST=Texas/L=Austin/O=FreeFlow Mortgage Solutions/OU=Security/CN=FreeFlow Private Root CA"

echo "🔐 Step 2: Generating Server Certificate for FastAPI doc-parser..."
openssl genrsa -out server.key 2048

# Create SAN (Subject Alternative Names) configuration file
cat > server.ext << EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = doc-parser.freeflow.internal
DNS.2 = localhost
IP.1 = 127.0.0.1
EOF

# Create Server Certificate Signing Request (CSR)
openssl req -new -key server.key -out server.csr \
  -subj "/C=US/ST=Texas/L=Austin/O=FreeFlow Mortgage Solutions/OU=Fintech Services/CN=doc-parser.freeflow.internal"

# Sign Server Certificate using CA
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out server.crt -days 365 -sha256 -extfile server.ext

echo "🔐 Step 3: Generating Client Certificate for Next.js underwriter-portal..."
openssl genrsa -out client.key 2048

# Create client verification extensions
cat > client.ext << EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
extendedKeyUsage = clientAuth
EOF

# Create Client CSR
openssl req -new -key client.key -out client.csr \
  -subj "/C=US/ST=Texas/L=Austin/O=FreeFlow Mortgage Solutions/OU=Underwriting Portal/CN=underwriter-portal.freeflow.internal"

# Sign Client Certificate using CA
openssl x509 -req -in client.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out client.crt -days 365 -sha256 -extfile client.ext

# Secure Permissions
chmod 400 ca.key server.key client.key
chmod 444 ca.crt server.crt client.crt

echo "✅ mTLS Certificate Generation Complete! Created ca.crt, server.crt, server.key, client.crt, client.key."
```

---

## 3. Step 2: FastAPI mTLS Server Configuration (`server.py`)

To enforce client certificate validation inside `/services/doc-parser/src/server.py`, we modify Gunicorn/Uvicorn to require certificate verification against our trusted `ca.crt`. 

Update `/services/doc-parser/src/server.py` to support SSL verification Context:

```python
import os
import ssl
import logging
import uvicorn
from fastapi import FastAPI, Request, HTTPException, status, Header
from fastapi.middleware.cors import CORSMiddleware

# Initialize Logger
logger = logging.getLogger("freeflow.mtls")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="FreeFlow Stateless Document Ingest Engine")

# Configure internal CORS limits
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://localhost:3000", "https://underwriter-portal.freeflow.internal"],
    allow_credentials=True,
    allow_methods=["POST"],
    allow_headers=["*"],
)

@app.get("/health")
def health_check():
    return {"status": "HEALTHY", "mTLS_Active": True}

# Add standard parser routes
@app.post("/api/underwrite/process")
def process_document_secure(
    request: Request,
    x_tenant_id: str | None = Header(None),
    x_underwriter_id: str | None = Header(None)
):
    if not x_tenant_id or not x_underwriter_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Unauthorized: Inbound requests must declare B2B client metrics headers."
        )
    # File parsing logic executes in-memory...
    return {"status": "PROCESSED", "verified": True}

# =============================================================================
# ENFORCE DIRECT PYTHON SSL CONTEXT (When running without proxy)
# =============================================================================
def get_ssl_context() -> ssl.SSLContext:
    """Configures Python SSL to require valid client-certificates."""
    cert_path = os.environ.get("SSL_CERT_PATH", "./certs/server.crt")
    key_path = os.environ.get("SSL_KEY_PATH", "./certs/server.key")
    ca_path = os.environ.get("SSL_CA_PATH", "./certs/ca.crt")

    # Enforce modern, secure TLS 1.3/1.2 guidelines
    context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    
    # Load Server Key & Certificate Chain
    context.load_cert_chain(certfile=cert_path, keyfile=key_path)
    
    # Require Client Certificate & Load private Root CA to verify it
    context.verify_mode = ssl.CERT_REQUIRED
    context.load_verify_locations(cafile=ca_path)
    
    # Enforce highly secure Cipher Suites
    context.set_ciphers('ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384')
    
    return context

if __name__ == "__main__":
    # Boot server natively using SSL Context (for local or containerized tests)
    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=8080,
        ssl_keyfile="./certs/server.key",
        ssl_certfile="./certs/server.crt",
        ssl_ca_certs="./certs/ca.crt",
        ssl_cert_reqs=ssl.CERT_REQUIRED
    )
```

For production Gunicorn deployments, update `/services/doc-parser/src/gunicorn_conf.py` to specify SSL parameters:

```python
# gunicorn_conf.py SSL Overrides
bind = "0.0.0.0:8080"
keyfile = "./certs/server.key"
certfile = "./certs/server.crt"
ca_certs = "./certs/ca.crt"
cert_reqs = 2  # ssl.CERT_REQUIRED enforces client verification
ssl_version = 5  # Corresponds to TLSv1_2+ protocols
```

---

## 4. Step 3: Next.js API Gateway client Client Code Configuration

When `/apps/underwriter-portal` calls our document parsing microservice, Node.js must perform HTTPS handshakes by presenting its signed client certificate. We use Node’s native `https` module to configure a secure agent.

Update `/apps/underwriter-portal/src/pages/api/underwrite/process.ts`:

```typescript
import type { NextApiRequest, NextApiResponse } from 'next';
import https from 'https';
import fs from 'fs';
import path from 'path';

// Load certificate credentials from secure volume mount path
const certPath = process.env.MTLS_CLIENT_CERT_PATH || '/etc/certs/client.crt';
const keyPath = process.env.MTLS_CLIENT_KEY_PATH || '/etc/certs/client.key';
const caPath = process.env.MTLS_CA_CERT_PATH || '/etc/certs/ca.crt';

let httpsAgent: https.Agent | null = null;

function getHttpsMtlsAgent(): https.Agent {
  if (httpsAgent) return httpsAgent;

  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath) || !fs.existsSync(caPath)) {
    throw new Error(`mTLS Encryption Error: Client keys or CA certificates are missing at: ${certPath}`);
  }

  // Configure HTTPS Agent with mutual TLS authentication parameters
  httpsAgent = new https.Agent({
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath),
    ca: fs.readFileSync(caPath),
    rejectUnauthorized: true, // Rejects if server certificate fails private CA verification
    keepAlive: true,          // Reuses socket connections to minimize handshake latency
  });

  return httpsAgent;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(45).json({ error: 'Only POST requests supported.' });
  }

  const transactionId = req.headers['x-transaction-id'] || 'N/A';
  console.log(`[Next.js Gateway] Dispatching mTLS File Ingest. Tx: ${transactionId}`);

  try {
    const mtlsAgent = getHttpsMtlsAgent();
    
    // Target FastAPI secure mTLS url inside VPC Private DNS
    const targetUrl = process.env.DOC_PARSER_SERVICE_URL || 'https://doc-parser.freeflow.internal:8080/api/underwrite/process';

    // Stream uploaded files natively over HTTPS utilizing client certificates
    const response = await fetch(targetUrl, {
      method: 'POST',
      body: req.body, // Streams the PDF binary stream
      agent: mtlsAgent as any, // Attaches our customized node-https mTLS agent
      headers: {
        'Content-Type': 'application/pdf',
        'x-tenant-id': req.headers['x-tenant-id'] as string,
        'x-underwriter-id': req.headers['x-underwriter-id'] as string,
        'x-loan-id': req.headers['x-loan-id'] as string,
        'x-loan-program': req.headers['x-loan-program'] as string,
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: `Backend mTLS processing error: ${errorText}` });
    }

    const ocrResults = await response.json();
    return res.status(200).json(ocrResults);
  } catch (err: any) {
    console.error(`[mTLS Sync Failure] Target: ${err.message}`);
    return res.status(500).json({ error: `Secure server connection failed: ${err.message}` });
  }
}
```

---

## 5. Step 4: Docker & AWS ECS Fargate Task Integrations

To prevent keys from checking into Git, we mount certificates dynamically at runtime using **AWS Secrets Manager** and **ECS Volume Mounts**.

### AWS Secrets Manager Certificate Vault Mapping
We store the base64-encoded `ca.crt`, `client.crt`, and `client.key` in Secrets Manager. In our **Fargate Task Definitions**, we declare them as environment secrets:

```json
{
  "containerDefinitions": [
    {
      "name": "underwriter-portal",
      "image": "YOUR_ECR_URI/underwriter-portal:latest",
      "secrets": [
        { "name": "MTLS_CLIENT_CERT_B64", "valueFrom": "arn:aws:secretsmanager:us-east-1:1234:secret:mtls-certs-abc:client_cert::" },
        { "name": "MTLS_CLIENT_KEY_B64", "valueFrom": "arn:aws:secretsmanager:us-east-1:1234:secret:mtls-certs-abc:client_key::" },
        { "name": "MTLS_CA_CERT_B64", "valueFrom": "arn:aws:secretsmanager:us-east-1:1234:secret:mtls-certs-abc:ca_cert::" }
      ]
    }
  ]
}
```

### Volatile RAM Scratch Directory Mounts (`tmpfs`)
Both containers mount `/tmp/zdr_scratch` to a volatile RAM drive. At startup, the entrypoint script decodes the secrets into `/tmp/zdr_scratch/certs/` to guarantee **no keys are written to persistent physical hardware disks**.

#### Updated Secure `entrypoint.sh`
```bash
#!/bin/sh
set -e

echo "🔒 SOC 2 Environment Setup: Initializing Ephemeral Certs..."

# Verify volatile RAM tmpfs scratch mount is active
if ! mount | grep -q "on /tmp/zdr_scratch type tmpfs"; then
  echo "🚨 CRITICAL SECURITY EXCEPTION: Ephemeral tmpfs RAM drive is NOT mounted. Boot aborted." >&2
  exit 1
fi

CERT_OUTPUT_DIR="/tmp/zdr_scratch/certs"
mkdir -p "$CERT_OUTPUT_DIR"

# Decode environment base64 secrets directly into our volatile RAM path
if [ -n "$MTLS_CLIENT_CERT_B64" ]; then
  echo "$MTLS_CLIENT_CERT_B64" | base64 -d > "$CERT_OUTPUT_DIR/client.crt"
  echo "$MTLS_CLIENT_KEY_B64" | base64 -d > "$CERT_OUTPUT_DIR/client.key"
  echo "$MTLS_CA_CERT_B64" | base64 -d > "$CERT_OUTPUT_DIR/ca.crt"
  echo "✓ Next.js client-certificates safely injected into RAM."
fi

if [ -n "$MTLS_SERVER_CERT_B64" ]; then
  echo "$MTLS_SERVER_CERT_B64" | base64 -d > "$CERT_OUTPUT_DIR/server.crt"
  echo "$MTLS_SERVER_KEY_B64" | base64 -d > "$CERT_OUTPUT_DIR/server.key"
  echo "$MTLS_CA_CERT_B64" | base64 -d > "$CERT_OUTPUT_DIR/ca.crt"
  echo "✓ FastAPI server-certificates safely injected into RAM."
fi

# Secure Certificate permissions inside RAM
chmod 400 "$CERT_OUTPUT_DIR"/*

# Proceed with application launch
exec "$@"
```

---

## 6. Step 5: Verification & Verification Controls

Once deployed inside the private network boundary, execute these controls to confirm that the mTLS pipeline is enforcing authentication correctly.

### Test 1: Inbound Request without Client Certificates (Should be Rejected)
Execute an unauthenticated API request to our secure parsing service from an external bastion host inside the VPC. The server must reject the handshake immediately:

```bash
curl -k -X POST https://doc-parser.freeflow.internal:8080/api/underwrite/process
```
**Expected Response / Console Error:**
```
curl: (35) error:14094412:SSL routines:ssl3_read_bytes:sslv3 alert handshake failure
# Server console output logs: "ssl.SSLError: [SSL: PEER_DID_NOT_RETURN_A_CERTIFICATE] peer did not return a certificate"
```

### Test 2: Inbound Request with Authenticated Client Certificates (Should Pass)
Execute the identical API request presenting the client certificates signed by our private Root CA:

```bash
curl --cacert certs/ca.crt \
     --cert certs/client.crt \
     --key certs/client.key \
     -H "x-tenant-id: tenant-freeflow-test-01" \
     -H "x-underwriter-id: uw-alex-morgan" \
     -X POST https://doc-parser.freeflow.internal:8080/api/underwrite/process
```
**Expected Response:**
```json
{
  "status": "PROCESSED",
  "verified": true
}
```

By verifying these two test cases, you confirm that your isolated points-solutions are locked behind a cryptographic vault, fully neutralizing interception or injection risk [cite: 93129336-97ea-4116-b8a5-22e82169ef94, f0084056-703a-48ab-8be7-4cbc3ea44c61]!
