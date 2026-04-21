# qswarm — Swarm & Surveillance Drone Demo (Quantum + Full Stack)

This repo is a full, local-first demo that ties together:

- a **Spring Boot 3 backend** with fake JWT auth, drone telemetry APIs, and a Python optimizer integration
- a **React (Vite) UI** that simulates a command-and-control portal with drone selection and “live feeds”
- a **local quantum optimization script** (QAOA-style) that selects a best-fit drone based on mission target distance + battery

Everything runs locally (no cloud services required).

## What’s implemented

### Backend (`drone-backend/`) — Spring Boot 3 (Java 17)

- **Auth**
  - `POST /api/auth/login`
  - Accepts `{"username":"operator1","password":"password123"}`
  - Returns a fake token: `{"token":"fake-jwt-token"}`

- **Drone listing**
  - `GET /api/drones`
  - Requires header `Authorization: Bearer fake-jwt-token`
  - Returns 5 hardcoded drones (`HAWK-01`…`HAWK-05`) with:
    - `id`, `name`, `status` (`ACTIVE`/`STANDBY`), `batteryPercentage`, `latitude`, `longitude`, `altitude`

- **Optimization endpoint (Python integration)**
  - `POST /api/drones/optimize`
  - Body: `{"targetLat": 32.87, "targetLon": -96.65}`
  - Runs the local script at `../quantum_optimizer.py` via `ProcessBuilder`
  - Parses and returns the selected drone name plus the raw Python output

- **CORS**
  - Enabled for `http://localhost:5173` and `http://127.0.0.1:5173`
  - JWT filter allows OPTIONS preflights (so browsers can send `Authorization` headers)

### Quantum optimizer (`quantum_optimizer.py`) — Qiskit + Aer (fully local)

- Simulates 5 drones with:
  - names `HAWK-01`…`HAWK-05`
  - random battery levels \(50–100%\)
  - random GPS near Dallas, TX
- Takes a target GPS coordinate
- Builds a **QAOA-style circuit** locally and evaluates it on local simulators
- Prints:
  - all drone stats
  - the circuit that was built
  - the selected optimal drone and the reasoning

**Local execution**: uses Qiskit + Qiskit Aer locally (no cloud backends).

### UI (`drone-ui/`) — React + Vite (no UI libraries)

Three-screen command portal:

1) **Military sign-in**
   - Dark navy theme
   - Calls backend login with demo credentials
   - Stores token in React state

2) **Drone selection**
   - Fetches `/api/drones` using the token
   - Grid of drone cards with status badges and telemetry
   - Selects a drone (blue border highlight)
   - “Assign to Mission” calls `/api/drones/optimize` and displays result in a modal

3) **Live feed**
   - Uses **real MP4 video clips** per drone from `drone-ui/src/assets/videos/`
   - Overlay UI: crosshair, HUD (REC + timestamp + signal bars), cinematic pan/zoom
   - Drone 2 includes an animated “tracking box” overlay
   - If a drone was quantum-selected, its feed can show a “MISSION AREA” highlight
   - “Audio ON/OFF” uses a user gesture to enable audio (browser autoplay rules)

## Why quantum computing here (and why it matters)

This demo uses quantum optimization because **mission assignment is naturally a combinatorial optimization problem**:

- You choose **one** drone (or more generally, a subset) subject to constraints
- The “best” choice depends on multiple competing objectives:
  - distance / time-to-target
  - battery headroom
  - status, availability, risk, payload, airspace constraints
  - multi-target routing, coverage, and synchronization constraints (for swarms)

In real operations, those constraints and objectives quickly create a **large search space** that grows exponentially with:

- number of drones
- number of targets
- path/route decisions
- discrete constraints (no-fly zones, fuel/battery limits, minimum coverage, etc.)

### What QAOA contributes

QAOA (Quantum Approximate Optimization Algorithm) is designed to search large discrete spaces by:

- encoding the objective/constraints into a **cost Hamiltonian** \(a diagonal operator whose eigenvalues represent scores/costs)
- alternating between:
  - a **problem evolution** that imprints phases based on the cost
  - a **mixer evolution** that explores neighboring solutions
- tuning parameters \(γ, β\) to bias probability mass toward high-quality solutions

In this repo we run QAOA **on a simulator**, but the structure mirrors how you’d run the same circuit on quantum hardware.

### Quantum vs traditional techniques (honest comparison)

- For **5 drones**, classical methods are trivial and will beat quantum simulation on speed.
  - In fact, the script also computes/prints the classical best one-hot state for comparison.

- The reason to model this with QAOA is **not** “quantum is faster today for 5 items”.
  - It’s to demonstrate an architecture that can extend to larger, constraint-heavy mission planning problems where:
    - exact brute-force becomes expensive
    - classical heuristics may get trapped or require significant tuning
    - quantum-inspired/quantum-native approaches provide another optimization tool in the toolbox

In practice, teams often use **hybrid** approaches:

- classical preprocessing + constraint reduction
- QAOA (or quantum-inspired solvers) for the hardest discrete core
- classical postprocessing and validation

## Run instructions

### 1) Backend (port 8080)

```bash
cd drone-backend
mvn spring-boot:run
```

### 2) UI (port 5173)

```bash
cd drone-ui
npm install
npm run dev
```

Open `http://localhost:5173`.

### 3) Quantum optimizer (standalone)

```bash
python3 quantum_optimizer.py --target-lat 32.78 --target-lon -96.80
```

## Notes

- **Audio**: browsers block autoplay audio; the UI requires a click on “Audio ON” in the live feed.
- **Local-only**: all services run locally; no cloud credentials or databases are required.
