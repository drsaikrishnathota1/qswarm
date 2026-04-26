#!/usr/bin/env bash
# Deploy the Spring Boot API (root Dockerfile) to Google Cloud Run with HTTPS.
# Prereqs: Google Cloud SDK (gcloud), a project you can use, billing enabled, APIs allowed.
#
# Usage:
#   export GCP_PROJECT_ID="your-project-id"   # optional if already: gcloud config set project ...
#   ./scripts/deploy-cloud-run.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

REGION="${GCP_REGION:-us-central1}"
REPO="${ARTIFACT_REGISTRY_REPO:-qswarm}"
IMAGE_NAME="${IMAGE_NAME:-qswarm-api}"
SERVICE="${CLOUD_RUN_SERVICE:-qswarm-api}"
MEMORY="${CLOUD_RUN_MEMORY:-2Gi}"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud not found. Install Google Cloud SDK, e.g.:"
  echo "  brew install --cask google-cloud-sdk"
  exit 1
fi

PROJECT="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
if [[ -z "${PROJECT}" || "${PROJECT}" == "(unset)" ]]; then
  echo "Set a project: export GCP_PROJECT_ID=...  OR  gcloud config set project YOUR_ID"
  exit 1
fi

gcloud config set project "${PROJECT}"

echo "==> Enabling APIs (safe to re-run)"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com --project "${PROJECT}"

REGISTRY_HOST="${REGION}-docker.pkg.dev"
IMAGE="${REGISTRY_HOST}/${PROJECT}/${REPO}/${IMAGE_NAME}:$(date +%Y%m%d-%H%M%S)"

echo "==> Ensuring Artifact Registry docker repo: ${REPO} in ${REGION}"
if ! gcloud artifacts repositories describe "${REPO}" --location="${REGION}" --project "${PROJECT}" >/dev/null 2>&1; then
  gcloud artifacts repositories create "${REPO}" \
    --repository-format=docker \
    --location="${REGION}" \
    --description="qswarm API images" \
    --project "${PROJECT}"
fi

echo "==> Building and pushing image via Cloud Build (no local Docker needed): ${IMAGE}"
gcloud builds submit --tag "${IMAGE}" --project "${PROJECT}" "${ROOT}"

echo "==> Deploying to Cloud Run: ${SERVICE}"
gcloud run deploy "${SERVICE}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --memory "${MEMORY}" \
  --project "${PROJECT}" \
  --set-env-vars "QSWARM_OPTIMIZER_SCRIPT=/app/quantum_optimizer.py"

echo ""
echo "Done. Service URL (HTTPS):"
gcloud run services describe "${SERVICE}" --region "${REGION}" --project "${PROJECT}" --format='value(status.url)'
