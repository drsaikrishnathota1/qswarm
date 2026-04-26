import React, { useEffect, useRef, useCallback } from "react";
import * as tf from "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";

/**
 * Browser-side object detection on the live <video> using COCO-SSD (TensorFlow.js).
 * Draws boxes in screen space using the same object-fit: cover mapping as the video.
 */
export function ObjectDetectionOverlay({ videoRef, enabled }) {
  const canvasRef = useRef(null);
  const modelRef = useRef(null);
  const rafRef = useRef(null);

  const mapBoxCover = useCallback((x, y, w, h, vw, vh, cw, ch) => {
    const s = Math.max(cw / vw, ch / vh);
    const ox = (cw - vw * s) / 2;
    const oy = (ch - vh * s) / 2;
    return { x: ox + x * s, y: oy + y * s, w: w * s, h: h * s };
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const c = canvasRef.current;
      if (c) {
        const ctx = c.getContext("2d");
        if (ctx && c.width) ctx.clearRect(0, 0, c.width, c.height);
      }
      if (modelRef.current) {
        try {
          modelRef.current.dispose();
        } catch {
          // ignore
        }
        modelRef.current = null;
      }
      return;
    }

    const canvas = canvasRef.current;
    const video = videoRef?.current;
    if (!canvas || !video) return undefined;

    let cancelled = false;
    let lastRun = 0;
    const minInterval = 480;

    (async () => {
      try {
        await tf.ready();
        try {
          await tf.setBackend("webgl");
        } catch {
          await tf.setBackend("cpu");
        }
        await tf.ready();
        if (cancelled) return;
        const model = await cocoSsd.load({ base: "lite_mobilenet_v2" });
        if (cancelled) {
          model.dispose();
          return;
        }
        modelRef.current = model;
      } catch {
        modelRef.current = null;
      }
    })();

    const tick = (t) => {
      if (cancelled) return;
      const model = modelRef.current;
      const wrap = canvas.parentElement;
      const cw = wrap ? wrap.clientWidth : canvas.clientWidth;
      const ch = wrap ? wrap.clientHeight : canvas.clientHeight;

      if (!model || cw < 4 || ch < 4) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      if (t - lastRun < minInterval) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      lastRun = t;

      if (video.readyState < 2) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      model
        .detect(video, 12, 0.4)
        .then((preds) => {
          if (cancelled) return;
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          const rs = window.getComputedStyle(document.documentElement);
          const accent = (rs.getPropertyValue("--accent-500") || "").trim() || "rgb(62, 148, 255)";
          const hudBg = (rs.getPropertyValue("--bg") || "").trim() || "#0a1628";
          const hudFill =
            hudBg.startsWith("#") && hudBg.length === 7 ? `${hudBg}E6` : "rgba(6, 14, 28, 0.9)";
          const text = (rs.getPropertyValue("--text") || "").trim() || "#e6edf7";
          ctx.clearRect(0, 0, cw, ch);
          ctx.lineWidth = 2;
          ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
          for (const p of preds) {
            const [bx, by, bw, bh] = p.bbox;
            const r = mapBoxCover(bx, by, bw, bh, vw, vh, cw, ch);
            ctx.strokeStyle = accent;
            ctx.strokeRect(r.x, r.y, r.w, r.h);
            const label = `${p.class} ${Math.round(p.score * 100)}%`;
            const tw = Math.min(ctx.measureText(label).width + 10, cw - r.x);
            ctx.fillStyle = hudFill;
            ctx.fillRect(r.x, Math.max(0, r.y - 20), tw, 20);
            ctx.fillStyle = text;
            ctx.fillText(label, r.x + 5, r.y - 6);
          }
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) rafRef.current = requestAnimationFrame(tick);
        });
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (modelRef.current) {
        try {
          modelRef.current.dispose();
        } catch {
          // ignore
        }
        modelRef.current = null;
      }
      const ctx = canvas.getContext("2d");
      if (ctx && canvas.width) ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [enabled, videoRef, mapBoxCover]);

  return <canvas ref={canvasRef} className="feedDetectCanvas" aria-hidden="true" />;
}
