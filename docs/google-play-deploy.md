# Deploy qswarm to Google Play

This repo is a **web stack** (React + Spring Boot). Google Play needs an **Android App Bundle (`.aab`)**. The `drone-ui` app is wrapped with **Capacitor** so the same UI ships as a native install.

## What you must have

1. A **Google Play Console** developer account (**one-time fee**, currently USD 25).
2. A **public HTTPS URL** for the API (the phone cannot use `localhost:8080`). Examples: **Google Cloud Run**, Cloud Run on GKE, AWS, etc.
3. **Android Studio** (latest stable) for signing and uploading the bundle.

## 1) Deploy the API

### Option A — One script (Cloud Run, no local Docker)

From the **repository root**, with **`gcloud`** installed and a project you control (**billing on**):

```bash
export PATH="/opt/homebrew/bin:$PATH"   # Homebrew gcloud on Apple Silicon
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
./scripts/deploy-cloud-run.sh
```

The script enables APIs, creates an Artifact Registry repo if needed, runs **`gcloud builds submit`** (builds your root **`Dockerfile` in Google’s cloud**), deploys **Cloud Run**, and prints the **`https://…`** URL. Override defaults with env vars: `GCP_PROJECT_ID`, `GCP_REGION`, `ARTIFACT_REGISTRY_REPO`, `CLOUD_RUN_SERVICE`, `CLOUD_RUN_MEMORY`.

### Option B — Docker on your machine

Build the container from the **repository root**:

```bash
docker build -t qswarm-api .
```

Run locally to verify, then push the image to **Artifact Registry** or **Docker Hub** and deploy to **Cloud Run** (or your host). Set environment variables as needed:

| Variable | Purpose |
|----------|---------|
| `PORT` | Injected by Cloud Run; Spring reads `server.port=${PORT:8080}`. |
| `QSWARM_OPTIMIZER_SCRIPT` | Optional override path to `quantum_optimizer.py` (Dockerfile sets `/app/quantum_optimizer.py`). |
| `QSWARM_CORS_EXTRA_ORIGINS` | Optional comma-separated extra CORS patterns if you also host a browser site (e.g. `https://app.example.com`). |

Use **HTTPS** only in production. Configure your API URL (e.g. `https://qswarm-api-xxxxx-uc.a.run.app`).

## 2) Point the mobile UI at the API

Copy `drone-ui/.env.example` to `drone-ui/.env.production` and set:

```bash
VITE_API_BASE_URL=https://YOUR-API-HOST
```

Build the web assets and sync Capacitor (this populates `android/app/src/main/assets/`, which is **gitignored** on purpose because it includes large videos):

```bash
cd drone-ui
npm ci
npm run build:android
```

Run **`npm run build:android`** again after any UI change and before every release AAB you upload.

For the **Android emulator** talking to the API on your computer, you can use `http://10.0.2.2:8080` (debug build allows cleartext; release should use HTTPS).

## 3) Open Android Studio and produce a signed bundle

Install **Android Studio** and the **Android SDK** (API 35). Gradle needs `sdk.dir` — Android Studio normally creates `drone-ui/android/local.properties` for you. If you build from the CLI, copy `drone-ui/android/local.properties.example` to `local.properties` and set `sdk.dir`.

```bash
cd drone-ui
npm run android:open
```

In Android Studio:

1. **Application ID** is `com.qswarm.aeroscommand` (change in `android/app/build.gradle` if you need a unique ID you own).
2. **Build > Generate Signed App Bundle or APK** → **Android App Bundle**.
3. Create or reuse an **upload key** (store the keystore and passwords securely; loss = you cannot update the same Play listing with the same key policy).

## 4) Google Play Console

1. Create an app → **Production** (or **Internal testing** first).
2. Upload the **`.aab`**.
3. Complete **Store listing**, **Content rating**, **Target API** / policy declarations, and **Privacy policy** (required if you collect or transmit user data; many apps link a simple policy page).
4. For **Data safety**, declare what leaves the device (e.g. credentials and API calls to your backend).

## 5) Ongoing updates

1. Bump `versionCode` / `versionName` in `drone-ui/android/app/build.gradle` (or use a versioning plugin) for each Play upload.
2. Rebuild: `npm run build:android` → upload new **AAB**.

## Notes

- **App size:** This demo bundles large **MP4** feeds into the web build (and therefore into the **AAB**). If Play Console rejects the upload or users see huge downloads, plan for **Play Asset Delivery**, **on-demand video URLs**, or smaller assets—see Android Studio’s **Analyze APK / App Bundle** after `bundleRelease`.
- **TensorFlow.js** and **video assets** run on-device; first launch may download model weights (network permission is already typical for an API-backed app).
- **Cleartext HTTP** is allowed only in **debug** builds via `src/debug/AndroidManifest.xml` for emulator convenience; **release** builds should use **HTTPS** for `VITE_API_BASE_URL`.
