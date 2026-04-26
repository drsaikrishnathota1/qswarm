import React, { useEffect, useMemo, useRef, useState } from "react";

function roundCoord(n) {
  // Keep cache keys stable while drone jitters.
  return Math.round(Number(n) * 1000) / 1000;
}

function formatDegToCompass(deg) {
  const d = ((Number(deg) % 360) + 360) % 360;
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(d / 22.5) % 16];
}

function fmtNum(n, digits = 0) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function fmtMetersToKm(m, digits = 0) {
  const v = Number(m);
  if (!Number.isFinite(v)) return "—";
  return (v / 1000).toFixed(digits);
}

function fmtTimeLocal(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const cache = new Map(); // key -> { at:number, data:any }

async function fetchOpenMeteoCurrent({ latitude, longitude, signal }) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(latitude));
  url.searchParams.set("longitude", String(longitude));
  // "current" is limited; we also request "hourly" and pick the nearest hour for extended metrics.
  url.searchParams.set("current", ["temperature_2m", "cloud_cover", "wind_speed_10m", "wind_direction_10m", "wind_gusts_10m"].join(","));
  url.searchParams.set(
    "hourly",
    [
      "temperature_2m",
      "relative_humidity_2m",
      "dew_point_2m",
      "cloud_cover",
      "cloud_cover_low",
      "cloud_cover_mid",
      "cloud_cover_high",
      "visibility",
      "precipitation_probability",
      "precipitation",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m",
      "pressure_msl",
    ].join(",")
  );
  url.searchParams.set("daily", ["sunrise", "sunset"].join(","));
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "2");

  const res = await fetch(url.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
    signal,
  });
  if (!res.ok) throw new Error(`Weather fetch failed: HTTP ${res.status}`);
  return await res.json();
}

function pickNearestHourlyIndex(hourly) {
  const times = hourly?.time;
  if (!Array.isArray(times) || !times.length) return -1;
  const now = Date.now();
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < times.length; i++) {
    const t = new Date(times[i]).getTime();
    if (!Number.isFinite(t)) continue;
    const diff = Math.abs(t - now);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}

function getHourlyValue(hourly, field, idx) {
  const arr = hourly?.[field];
  if (!Array.isArray(arr) || idx < 0 || idx >= arr.length) return undefined;
  return arr[idx];
}

function computeFlightBadge(metrics, thresholds) {
  const issues = [];
  if (Number.isFinite(metrics.windSpeed) && metrics.windSpeed > thresholds.windSpeedMax) issues.push("Wind");
  if (Number.isFinite(metrics.gust) && metrics.gust > thresholds.gustMax) issues.push("Gusts");
  if (Number.isFinite(metrics.precipProb) && metrics.precipProb > thresholds.precipProbMax) issues.push("Precip");
  if (Number.isFinite(metrics.visibilityM) && metrics.visibilityM < thresholds.visibilityMinM) issues.push("Visibility");

  const level = issues.length === 0 ? "go" : issues.length <= 2 ? "caution" : "nogo";
  return { level, issues };
}

export function WeatherWidget({ latitude, longitude, refreshMs = 60_000 }) {
  const [state, setState] = useState({ status: "idle", data: null, error: "" });
  const abortRef = useRef(null);

  const key = useMemo(() => {
    const lat = roundCoord(latitude);
    const lon = roundCoord(longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return "";
    return `${lat},${lon}`;
  }, [latitude, longitude]);

  useEffect(() => {
    if (!key) {
      setState({ status: "error", data: null, error: "Missing GPS coordinates." });
      return undefined;
    }

    let cancelled = false;

    const run = async (force = false) => {
      const now = Date.now();
      const cached = cache.get(key);
      if (!force && cached && now - cached.at < refreshMs) {
        setState({ status: "ready", data: cached.data, error: "" });
        return;
      }

      if (abortRef.current) abortRef.current.abort();
      const ac = new AbortController();
      abortRef.current = ac;

      setState((s) => (s.status === "ready" ? s : { status: "loading", data: s.data, error: "" }));

      try {
        const [latS, lonS] = key.split(",").map(Number);
        const json = await fetchOpenMeteoCurrent({ latitude: latS, longitude: lonS, signal: ac.signal });
        if (cancelled) return;
        cache.set(key, { at: now, data: json });
        setState({ status: "ready", data: json, error: "" });
      } catch (e) {
        if (cancelled) return;
        if (e?.name === "AbortError") return;
        setState({ status: "error", data: null, error: e?.message || String(e) });
      }
    };

    run(false);
    const id = setInterval(() => run(false), refreshMs);

    return () => {
      cancelled = true;
      clearInterval(id);
      if (abortRef.current) abortRef.current.abort();
    };
  }, [key, refreshMs]);

  const current = state.data?.current || null;
  const hourly = state.data?.hourly || null;
  const daily = state.data?.daily || null;
  const units = state.data?.hourly_units || state.data?.current_units || {};
  const hourlyIdx = useMemo(() => pickNearestHourlyIndex(hourly), [hourly]);

  const temp = current?.temperature_2m ?? getHourlyValue(hourly, "temperature_2m", hourlyIdx);
  const clouds = current?.cloud_cover ?? getHourlyValue(hourly, "cloud_cover", hourlyIdx);
  const windSpeed = current?.wind_speed_10m ?? getHourlyValue(hourly, "wind_speed_10m", hourlyIdx);
  const windDir = current?.wind_direction_10m ?? getHourlyValue(hourly, "wind_direction_10m", hourlyIdx);
  const gust = current?.wind_gusts_10m ?? getHourlyValue(hourly, "wind_gusts_10m", hourlyIdx);

  const rh = getHourlyValue(hourly, "relative_humidity_2m", hourlyIdx);
  const dew = getHourlyValue(hourly, "dew_point_2m", hourlyIdx);
  const visibilityM = getHourlyValue(hourly, "visibility", hourlyIdx);
  const precipProb = getHourlyValue(hourly, "precipitation_probability", hourlyIdx);
  const precipMm = getHourlyValue(hourly, "precipitation", hourlyIdx);
  const pressure = getHourlyValue(hourly, "pressure_msl", hourlyIdx);

  const cloudsLow = getHourlyValue(hourly, "cloud_cover_low", hourlyIdx);
  const cloudsMid = getHourlyValue(hourly, "cloud_cover_mid", hourlyIdx);
  const cloudsHigh = getHourlyValue(hourly, "cloud_cover_high", hourlyIdx);

  const sunrise = Array.isArray(daily?.sunrise) ? daily.sunrise[0] : null;
  const sunset = Array.isArray(daily?.sunset) ? daily.sunset[0] : null;

  const thresholds = useMemo(
    () => ({
      windSpeedMax: 28, // km/h (reasonable default; can be made user-configurable later)
      gustMax: 38, // km/h
      precipProbMax: 35, // %
      visibilityMinM: 3000, // 3 km
    }),
    []
  );

  const badge = useMemo(
    () =>
      computeFlightBadge(
        { windSpeed: Number(windSpeed), gust: Number(gust), precipProb: Number(precipProb), visibilityM: Number(visibilityM) },
        thresholds
      ),
    [windSpeed, gust, precipProb, visibilityM, thresholds]
  );

  return (
    <div className="weatherWidget" aria-live="polite">
      <div className="weatherHeader">
        <div className="weatherTitle">WEATHER</div>
        <div className="weatherMeta">
          {state.status === "loading" ? "Syncing…" : state.status === "error" ? "Offline" : "Live"}
        </div>
      </div>

      <div className={`flightBadge flightBadge_${badge.level}`} aria-label="Flight condition indicator">
        <span className="flightBadgeLabel">{badge.level === "go" ? "GO" : badge.level === "caution" ? "CAUTION" : "NO-GO"}</span>
        {badge.issues.length ? <span className="flightBadgeIssues">{badge.issues.slice(0, 3).join(", ")}</span> : <span className="flightBadgeIssues">Conditions OK</span>}
      </div>

      {state.status === "error" ? (
        <div className="weatherError" title={state.error}>
          {state.error}
        </div>
      ) : null}

      <div className="weatherGrid">
        <div className="weatherItem">
          <div className="weatherLabel">Temp</div>
          <div className="weatherValue">
            {fmtNum(temp, 1)}
            <span className="weatherUnit">{units.temperature_2m || "°C"}</span>
          </div>
        </div>

        <div className="weatherItem">
          <div className="weatherLabel">Clouds</div>
          <div className="weatherValue">
            {fmtNum(clouds, 0)}
            <span className="weatherUnit">%</span>
          </div>
        </div>

        <div className="weatherItem weatherItemWide">
          <div className="weatherLabel">Wind</div>
          <div className="weatherValue">
            {fmtNum(windSpeed, 0)}
            <span className="weatherUnit">{units.wind_speed_10m || "km/h"}</span>
            <span className="weatherSep">•</span>
            {Number.isFinite(Number(windDir)) ? (
              <span className="weatherDim">
                {formatDegToCompass(windDir)} {fmtNum(windDir, 0)}°
              </span>
            ) : (
              <span className="weatherDim">—</span>
            )}
            {Number.isFinite(Number(gust)) ? (
              <>
                <span className="weatherSep">•</span>
                <span className="weatherDim">
                  Gust {fmtNum(gust, 0)}
                  <span className="weatherUnit">{units.wind_gusts_10m || units.wind_speed_10m || "km/h"}</span>
                </span>
              </>
            ) : null}
          </div>
        </div>

        <div className="weatherItem">
          <div className="weatherLabel">Visibility</div>
          <div className="weatherValue">
            {fmtMetersToKm(visibilityM, 1)}
            <span className="weatherUnit">km</span>
          </div>
        </div>

        <div className="weatherItem">
          <div className="weatherLabel">Precip</div>
          <div className="weatherValue">
            {fmtNum(precipProb, 0)}
            <span className="weatherUnit">%</span>
            <span className="weatherSep">•</span>
            <span className="weatherDim">
              {fmtNum(precipMm, 1)}
              <span className="weatherUnit">{units.precipitation || "mm"}</span>
            </span>
          </div>
        </div>

        <div className="weatherItem">
          <div className="weatherLabel">Humidity</div>
          <div className="weatherValue">
            {fmtNum(rh, 0)}
            <span className="weatherUnit">%</span>
            <span className="weatherSep">•</span>
            <span className="weatherDim">
              Dew {fmtNum(dew, 1)}
              <span className="weatherUnit">{units.dew_point_2m || "°C"}</span>
            </span>
          </div>
        </div>

        <div className="weatherItem">
          <div className="weatherLabel">Pressure</div>
          <div className="weatherValue">
            {fmtNum(pressure, 0)}
            <span className="weatherUnit">{units.pressure_msl || "hPa"}</span>
          </div>
        </div>

        <div className="weatherItem weatherItemWide">
          <div className="weatherLabel">Cloud Layers</div>
          <div className="weatherValue">
            <span className="weatherDim">Low {fmtNum(cloudsLow, 0)}%</span>
            <span className="weatherSep">•</span>
            <span className="weatherDim">Mid {fmtNum(cloudsMid, 0)}%</span>
            <span className="weatherSep">•</span>
            <span className="weatherDim">High {fmtNum(cloudsHigh, 0)}%</span>
          </div>
        </div>

        <div className="weatherItem weatherItemWide">
          <div className="weatherLabel">Sun</div>
          <div className="weatherValue">
            <span className="weatherDim">Sunrise {fmtTimeLocal(sunrise)}</span>
            <span className="weatherSep">•</span>
            <span className="weatherDim">Sunset {fmtTimeLocal(sunset)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

