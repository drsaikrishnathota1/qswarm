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
2. **Feed videos:** place `hawk-01.mp4` … `hawk-05.mp4` under `public/feeds/` for local `npm run dev`. Production builds **strip** those files from `dist/` so the **.aab** stays under Play’s **200 MB** base-module limit (gradient-only live feed in the store build unless you opt in via env vars in `.env.example`).
3. Open the native project: `npm run android:open` (requires Android Studio + SDK; see `android/local.properties.example`).
4. Full Play Console + Docker API steps: **`../docs/google-play-deploy.md`**.

### Backend requirements

Start the Spring Boot backend on port 8080:

```bash
cd drone-backend
mvn spring-boot:run
```

