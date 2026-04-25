## drone-ui

React UI (Vite dev server on **5173**).

### Run

```bash
cd drone-ui
npm install
npm run dev
```

Open `http://localhost:5173`.

### Android / Google Play (Capacitor)

1. Set `VITE_API_BASE_URL` (see `.env.example`) to your **HTTPS** API, then `npm run build:android` (fills `android/app/src/main/assets/`; not committed because of large MP4s).
2. Open the native project: `npm run android:open` (requires Android Studio + SDK; see `android/local.properties.example`).
3. Full Play Console + Docker API steps: **`../docs/google-play-deploy.md`**.

### Backend requirements

Start the Spring Boot backend on port 8080:

```bash
cd drone-backend
mvn spring-boot:run
```

