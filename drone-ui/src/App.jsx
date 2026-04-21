import React, { useEffect, useMemo, useState } from "react";
import videoHawk01 from "./assets/videos/hawk-01.mp4";
import videoHawk02 from "./assets/videos/hawk-02.mp4";
import videoHawk03 from "./assets/videos/hawk-03.mp4";
import videoHawk04 from "./assets/videos/hawk-04.mp4";
import videoHawk05 from "./assets/videos/hawk-05.mp4";

const API_BASE = "http://localhost:8080";

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function StatusBadge({ status }) {
  const isActive = String(status || "").toLowerCase() === "active";
  const badgeClass = isActive ? "badge badgeActive" : "badge badgeStandby";
  const dotClass = isActive ? "dot dotActive" : "dot dotStandby";
  const label = isActive ? "Active" : "Standby";
  return (
    <span className={badgeClass}>
      <span className={dotClass} />
      {label}
    </span>
  );
}

function Modal({ title, children, onClose }) {
  return (
    <div
      className="modalOverlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="row spaceBetween" style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 900 }}>{title}</div>
          <button className="btnSecondary" onClick={onClose}>
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

async function apiFetch(path, { token, method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const msg = `HTTP ${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`;
    throw new Error(msg);
  }

  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return await res.json();
  return await res.text();
}

function ErrorBanner({ error }) {
  if (!error) return null;
  return (
    <div
      style={{
        marginBottom: 14,
        padding: 10,
        borderRadius: 12,
        border: "1px solid rgba(255, 90, 90, 0.30)",
        background: "rgba(255, 90, 90, 0.08)",
        color: "#ffd3d3",
        fontWeight: 700,
      }}
    >
      {error}
    </div>
  );
}

function LoginScreen({ onLoggedIn }) {
  const [operatorId, setOperatorId] = useState("operator1");
  const [passphrase, setPassphrase] = useState("password123");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function login() {
    setError("");
    setLoading(true);
    try {
      const data = await apiFetch("/api/auth/login", {
        method: "POST",
        body: { username: "operator1", password: "password123" },
      });
      if (!data?.token) throw new Error("Login succeeded but token missing.");
      onLoggedIn(data.token);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container">
      <div className="title">AEROS Command — Drone Surveillance Portal</div>
      <div className="subtle" style={{ marginBottom: 18, maxWidth: 760 }}>
        Secure operator access. Demo credentials are used for the backend call
        (operator1/password123).
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <div style={{ fontWeight: 900, marginBottom: 10 }}>Military Sign-In</div>

        <div className="subtle" style={{ marginBottom: 12 }}>
          Operator ID
        </div>
        <input
          className="input"
          value={operatorId}
          onChange={(e) => setOperatorId(e.target.value)}
          placeholder="Operator ID"
          autoComplete="username"
        />

        <div className="subtle" style={{ marginTop: 12, marginBottom: 12 }}>
          Passphrase
        </div>
        <input
          className="input"
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Passphrase"
          autoComplete="current-password"
        />

        <ErrorBanner error={error} />

        <div style={{ marginTop: 14, display: "flex", justifyContent: "flex-end" }}>
          <button className="btn" onClick={login} disabled={loading} title="Login to proceed">
            {loading ? "Signing in..." : "Login"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DroneCard({ drone, selected, onSelect, onViewFeed }) {
  const coords = `${drone.latitude.toFixed(4)}, ${drone.longitude.toFixed(4)}`;
  return (
    <div
      className={`card ${selected ? "selected" : ""}`}
      style={{ cursor: "pointer" }}
      onClick={onSelect}
    >
      <div className="row spaceBetween" style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 900 }}>{drone.name}</div>
        <StatusBadge status={drone.status} />
      </div>

      <div className="subtle" style={{ fontSize: 13, lineHeight: 1.4 }}>
        <div>
          <strong>Battery: </strong>
          {drone.batteryPercentage}%
        </div>
        <div>
          <strong>GPS: </strong>
          {coords}
        </div>
        <div>
          <strong>Altitude: </strong>
          {drone.altitude.toFixed(1)} m
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
        <button
          className="btnSecondary"
          onClick={(e) => {
            e.stopPropagation();
            onViewFeed();
          }}
        >
          View Live Feed
        </button>
      </div>
    </div>
  );
}

function DroneSelectionScreen({ token, onViewFeed, onOptimized }) {
  const [drones, setDrones] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [optimizing, setOptimizing] = useState(false);
  const [modal, setModal] = useState(null);

  async function loadDrones() {
    setError("");
    setLoading(true);
    try {
      const data = await apiFetch("/api/drones", { token });
      setDrones(Array.isArray(data) ? data : []);
      if (!selectedId && Array.isArray(data) && data.length) setSelectedId(data[0].id);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDrones();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const selected = useMemo(() => drones.find((d) => d.id === selectedId) || null, [drones, selectedId]);

  async function assignToMission() {
    setOptimizing(true);
    setError("");
    try {
      const data = await apiFetch("/api/drones/optimize", {
        token,
        method: "POST",
        body: { targetLat: 32.87, targetLon: -96.65 },
      });
      setModal(data);
      if (data?.selectedDroneName) onOptimized?.(data.selectedDroneName);
    } catch (e) {
      setError(e?.message || String(e));
    } finally {
      setOptimizing(false);
    }
  }

  return (
    <div>
      <div className="container">
        <div className="row spaceBetween" style={{ marginBottom: 10 }}>
          <div>
            <div className="title">Drone Selection</div>
            <div className="subtle">
              Select a drone, then assign a mission target for quantum optimization.
            </div>
          </div>
          <button className="btnSecondary" onClick={loadDrones} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <ErrorBanner error={error} />

        <div className="grid">
          {drones.map((d) => (
            <DroneCard
              key={d.id}
              drone={d}
              selected={d.id === selectedId}
              onSelect={() => setSelectedId(d.id)}
              onViewFeed={() => onViewFeed(d)}
            />
          ))}
        </div>
      </div>

      <div className="footerBar">
        <div className="container">
          <div className="row spaceBetween">
            <div className="subtle">
              {selected ? (
                <div>
                  <strong>Selected: </strong>
                  {selected.name} {"  •  "}
                  <strong>Battery: </strong>
                  {selected.batteryPercentage}%
                </div>
              ) : (
                "No drone selected."
              )}
            </div>

            <button className="btn" onClick={assignToMission} disabled={optimizing || !selected}>
              {optimizing ? "Optimizing..." : "Assign to Mission"}
            </button>
          </div>
        </div>
      </div>

      {modal ? (
        <Modal title="Quantum Optimization Result" onClose={() => setModal(null)}>
          <div style={{ display: "grid", gap: 10 }}>
            <div className="card">
              <div style={{ fontWeight: 900, marginBottom: 6 }}>Selected drone</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: "#9fd0ff" }}>
                {modal.selectedDroneName || "Unknown"}
              </div>
              <div className="subtle" style={{ marginTop: 6 }}>
                {modal.selectionReason || ""}
              </div>
            </div>

            <div className="card">
              <div style={{ fontWeight: 900, marginBottom: 8 }}>Raw optimizer output</div>
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontSize: 12,
                  lineHeight: 1.35,
                  color: "rgba(230, 237, 247, 0.85)",
                }}
              >
                {String(modal.rawOutput || "").slice(0, 9000)}
              </pre>
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function LiveFeedScreen({ drone, onBack, lastOptimizedDroneName }) {
  const baseLat = Number(drone?.latitude ?? 0);
  const baseLon = Number(drone?.longitude ?? 0);
  const baseAlt = Number(drone?.altitude ?? 0);

  const scene = useMemo(() => {
    const name = drone?.name || "";
    const presets = {
      "HAWK-01": {
        label: "Swarm Surveillance — Desert grid",
        feedBackdrop:
          "linear-gradient(165deg, #0f1419 0%, #1a2433 35%, #2a1f14 70%, #0a0806 100%)",
        video: videoHawk01
      },
      "HAWK-02": {
        label: "Roadwatch — Coastal Track",
        feedBackdrop:
          "linear-gradient(180deg, #061a24 0%, #0c3044 45%, #082030 70%, #040c12 100%)",
        video: videoHawk02
      },
      "HAWK-03": {
        label: "Quantum Tasking — Skyline mission",
        feedBackdrop:
          "linear-gradient(155deg, #120a1c 0%, #251838 40%, #1a1030 100%)",
        video: videoHawk03
      },
      "HAWK-04": {
        label: "Base Perimeter — Strike Ready",
        feedBackdrop:
          "linear-gradient(170deg, #141010 0%, #2a1818 50%, #1a0a0a 100%)",
        video: videoHawk04
      },
      "HAWK-05": {
        label: "Patrol Sweep — Long Pan",
        feedBackdrop:
          "linear-gradient(160deg, #081208 0%, #122418 55%, #0a140c 100%)",
        video: videoHawk05
      }
    };
    return presets[name] || presets["HAWK-03"];
  }, [drone?.name]);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 900);
    return () => clearInterval(id);
  }, []);

  // Audio: browsers require a user gesture; we provide a toggle button.
  const [audioOn, setAudioOn] = useState(false);
  const audioRef = React.useRef(null); // { stop }
  const videoRef = React.useRef(null);

  useEffect(() => {
    return () => {
      if (audioRef.current?.stop) audioRef.current.stop();
    };
  }, []);

  async function toggleAudio() {
    if (audioOn) {
      setAudioOn(false);
      if (audioRef.current?.stop) audioRef.current.stop();
      audioRef.current = null;
      if (videoRef.current) videoRef.current.muted = true;
      return;
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    await ctx.resume();

    const master = ctx.createGain();
    master.gain.value = 0.065;
    master.connect(ctx.destination);

    // Helper to create looped noise.
    const makeNoise = (seconds, amp) => {
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * amp;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      return src;
    };

    const nodesToStop = [];

    const mode = String(scene.label || "").toLowerCase();

    // Base rotor (very subtle, consistent).
    const rotor = ctx.createOscillator();
    rotor.type = "sine";
    rotor.frequency.value = 18;
    const rotorGain = ctx.createGain();
    rotorGain.gain.value = 0.012;
    rotor.connect(rotorGain).connect(master);
    rotor.start();
    nodesToStop.push(rotor);

    if (mode.includes("coastal")) {
      // Ocean: filtered noise + slow wave swell.
      const noise = makeNoise(2.0, 0.45);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900;
      const swell = ctx.createOscillator();
      swell.type = "sine";
      swell.frequency.value = 0.25;
      const swellGain = ctx.createGain();
      swellGain.gain.value = 0.02;
      const gain = ctx.createGain();
      gain.gain.value = 0.03;
      swell.connect(swellGain).connect(gain.gain);
      noise.connect(lp).connect(gain).connect(master);
      noise.start();
      swell.start();
      nodesToStop.push(noise, swell);
    } else if (mode.includes("desert")) {
      // Desert wind: bandpass noise with gentle gusting.
      const noise = makeNoise(2.0, 0.55);
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = 420;
      bp.Q.value = 0.8;
      const gust = ctx.createOscillator();
      gust.type = "sine";
      gust.frequency.value = 0.12;
      const gustGain = ctx.createGain();
      gustGain.gain.value = 0.03;
      const gain = ctx.createGain();
      gain.gain.value = 0.028;
      gust.connect(gustGain).connect(gain.gain);
      noise.connect(bp).connect(gain).connect(master);
      noise.start();
      gust.start();
      nodesToStop.push(noise, gust);
    } else if (mode.includes("skyline")) {
      // City hum: low sine + a touch of hiss.
      const hum = ctx.createOscillator();
      hum.type = "sine";
      hum.frequency.value = 60;
      const humGain = ctx.createGain();
      humGain.gain.value = 0.01;
      hum.connect(humGain).connect(master);
      hum.start();
      nodesToStop.push(hum);

      const hiss = makeNoise(1.5, 0.25);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 2200;
      const gain = ctx.createGain();
      gain.gain.value = 0.012;
      hiss.connect(lp).connect(gain).connect(master);
      hiss.start();
      nodesToStop.push(hiss);
    } else if (mode.includes("strike")) {
      // Strike zone: more radio/static and a low rumble.
      const staticN = makeNoise(1.0, 0.7);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1200;
      const gain = ctx.createGain();
      gain.gain.value = 0.03;
      staticN.connect(hp).connect(gain).connect(master);
      staticN.start();
      nodesToStop.push(staticN);

      const rumble = ctx.createOscillator();
      rumble.type = "sine";
      rumble.frequency.value = 38;
      const rumbleGain = ctx.createGain();
      rumbleGain.gain.value = 0.012;
      rumble.connect(rumbleGain).connect(master);
      rumble.start();
      nodesToStop.push(rumble);
    } else {
      // Night inferno / default: crackle-ish noise (highpass) + low rumble.
      const crackle = makeNoise(0.9, 0.65);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 700;
      const gain = ctx.createGain();
      gain.gain.value = 0.02;
      crackle.connect(hp).connect(gain).connect(master);
      crackle.start();
      nodesToStop.push(crackle);
    }

    const stop = () => {
      for (const n of nodesToStop) {
        try {
          n.stop();
        } catch {
          // ignore
        }
      }
      try {
        ctx.close();
      } catch {
        // ignore
      }
    };

    audioRef.current = { stop };
    setAudioOn(true);
    if (videoRef.current) {
      // Unmute after user gesture.
      videoRef.current.muted = false;
      videoRef.current.volume = 0.55;
      // eslint-disable-next-line no-empty
      try { await videoRef.current.play(); } catch {}
    }
  }

  const lat = baseLat + Math.sin(tick / 6) * 0.0007;
  const lon = baseLon + Math.cos(tick / 7) * 0.0007;
  const alt = baseAlt + Math.sin(tick / 5) * 2.2;
  const speed = 22 + (Math.sin(tick / 4) + 1) * 6.5;
  const signal = 2 + Math.round(((Math.sin(tick / 3.5) + 1) / 2) * 3); // 2..5

  const timestamp = useMemo(() => {
    const t = new Date();
    return t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }, [tick]);

  const isMissionDrone = !!(drone?.name && lastOptimizedDroneName && drone.name === lastOptimizedDroneName);
  const isStandby = String(drone?.status || "").toLowerCase() === "standby";

  return (
    <div className="container">
      <div className="row spaceBetween">
        <div>
          <div className="title">Live Feed</div>
          <div className="subtle">
            {drone?.name || "Unknown Drone"} {" • "} {scene.label}
          </div>
        </div>
        <div className="row">
          <button className="btnSecondary" onClick={toggleAudio} title="Enable simulated feed audio">
            {audioOn ? "Audio: ON" : "Audio: OFF"}
          </button>
          <button className="btnSecondary" onClick={onBack}>
            Back
          </button>
        </div>
      </div>

      <div
        className="feedBox"
        style={{
          backgroundImage: scene.feedBackdrop,
          backgroundSize: "cover",
          backgroundPosition: "center"
        }}
      >
        <div className="feedBgDrift" />

        <div className="feedVideoWrap">
          <video
            ref={videoRef}
            className={`feedVideo ${isStandby ? "feedVideoDim" : ""}`}
            src={scene.video}
            autoPlay
            loop
            playsInline
            muted={!audioOn}
            preload="auto"
          />
        </div>

        <div className="crosshairH" />
        <div className="crosshairV" />

        {drone?.name === "HAWK-02" ? <div className="trackBox" /> : null}

        <div className="feedHudTop">
          <div className="feedHudLeft">
            CAM-01 / SIMULATED FEED — {scene.label}
          </div>
          <div className="feedHudRight">
            <span className="recDot" />
            REC
            <span className="feedHudSep" />
            {timestamp}
            <span className="feedHudSep" />
            <span className="signalBars" aria-label={`Signal ${signal}/5`}>
              {Array.from({ length: 5 }).map((_, i) => (
                <span
                  // eslint-disable-next-line react/no-array-index-key
                  key={i}
                  className={`signalBar ${i < signal ? "signalOn" : "signalOff"}`}
                />
              ))}
            </span>
          </div>
        </div>

        {isMissionDrone ? <div className="missionFrame">MISSION AREA</div> : null}

        <div className="feedCorner tl" />
        <div className="feedCorner tr" />
        <div className="feedCorner bl" />
        <div className="feedCorner br" />
      </div>

      <div className="telemetry">
        <div className="telemetryItem">
          <div className="telemetryLabel">Latitude</div>
          <div className="telemetryValue">{lat.toFixed(5)}</div>
        </div>
        <div className="telemetryItem">
          <div className="telemetryLabel">Longitude</div>
          <div className="telemetryValue">{lon.toFixed(5)}</div>
        </div>
        <div className="telemetryItem">
          <div className="telemetryLabel">Altitude (m)</div>
          <div className="telemetryValue">{alt.toFixed(1)}</div>
        </div>
        <div className="telemetryItem">
          <div className="telemetryLabel">Speed (km/h)</div>
          <div className="telemetryValue">{clamp(speed, 0, 120).toFixed(1)}</div>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const [screen, setScreen] = useState("login"); // login | drones | feed
  const [token, setToken] = useState("");
  const [feedDrone, setFeedDrone] = useState(null);
  const [lastOptimizedDroneName, setLastOptimizedDroneName] = useState("");

  if (screen === "login") {
    return (
      <LoginScreen
        onLoggedIn={(t) => {
          setToken(t);
          setScreen("drones");
        }}
      />
    );
  }

  if (screen === "feed") {
    return (
      <LiveFeedScreen
        drone={feedDrone}
        lastOptimizedDroneName={lastOptimizedDroneName}
        onBack={() => setScreen("drones")}
      />
    );
  }

  return (
    <DroneSelectionScreen
      token={token}
      onOptimized={(name) => setLastOptimizedDroneName(name)}
      onViewFeed={(drone) => {
        setFeedDrone(drone);
        setScreen("feed");
      }}
    />
  );
}

