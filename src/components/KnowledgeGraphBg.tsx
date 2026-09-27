"use client";

import { useEffect, useRef } from "react";
import styles from "./KnowledgeGraphBg.module.css";

/**
 * 知识图谱网络背景：
 * 漂浮的知识节点彼此连线，中央「RAG 枢纽」与周围知识节点相连，
 * 光脉冲沿连接流动，表达 RAG 将分散知识连接、检索与汇聚的过程。
 * 仅装饰用：pointer-events: none，不拦截任何交互。
 */

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hub: boolean;
}

interface Pulse {
  from: number;
  to: number;
  t: number;
  speed: number;
}

const LINK_DISTANCE = 150; // 普通节点自动连线距离
const HUB_LINKS = 7; // 枢纽常连的最近知识节点数
const ACCENT = "79, 70, 229"; // 靛蓝
const ACCENT_2 = "8, 145, 178"; // 青

export default function KnowledgeGraphBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let nodes: Node[] = [];
    let pulses: Pulse[] = [];
    // 枢纽常连节点的索引对（每帧只画这些，避免重复计算）
    let hubEdges: [number, number][] = [];
    let rafId = 0;
    const mouse = { x: -9999, y: -9999 };

    const build = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // 节点数按屏幕面积计算，移动端更少
      const count = Math.max(
        18,
        Math.min(64, Math.floor((width * height) / 22000)),
      );

      nodes = [];
      // 中央 RAG 枢纽
      nodes.push({
        x: width / 2,
        y: height * 0.42,
        vx: 0,
        vy: 0,
        r: 5,
        hub: true,
      });

      for (let i = 0; i < count; i++) {
        nodes.push({
          x: Math.random() * width,
          y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.28,
          vy: (Math.random() - 0.5) * 0.28,
          r: 1.6 + Math.random() * 1.8,
          hub: false,
        });
      }

      // 计算枢纽最近的知识节点
      const hub = nodes[0]!;
      hubEdges = nodes
        .slice(1)
        .map((n, i) => ({
          i: i + 1,
          d: (n.x - hub.x) ** 2 + (n.y - hub.y) ** 2,
        }))
        .sort((a, b) => a.d - b.d)
        .slice(0, HUB_LINKS)
        .map((entry) => [0, entry.i]) as [number, number][];

      pulses = [];
    };

    /** 在一条边上发射一个沿边流动的光脉冲 */
    const spawnPulse = () => {
      // 70% 走枢纽边，突出「以 RAG 为中心连接知识」
      const useHub = Math.random() < 0.7 && hubEdges.length > 0;
      if (useHub) {
        const [from, to] =
          hubEdges[Math.floor(Math.random() * hubEdges.length)]!;
        pulses.push({ from, to, t: 0, speed: 0.006 + Math.random() * 0.006 });
      } else {
        const a = 1 + Math.floor(Math.random() * (nodes.length - 1));
        let b = 1 + Math.floor(Math.random() * (nodes.length - 1));
        if (a === b) b = b === nodes.length - 1 ? 1 : b + 1;
        pulses.push({ from: a, to: b, t: 0, speed: 0.004 + Math.random() * 0.005 });
      }
    };

    const drawEdges = () => {
      // 普通节点之间的邻近连接
      for (let i = 1; i < nodes.length; i++) {
        const a = nodes[i]!;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j]!;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < LINK_DISTANCE * LINK_DISTANCE) {
            const alpha = (1 - Math.sqrt(d2) / LINK_DISTANCE) * 0.16;
            ctx.strokeStyle = `rgba(${ACCENT}, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // 枢纽常连边（更明显）
      for (const [from, to] of hubEdges) {
        const a = nodes[from]!;
        const b = nodes[to]!;
        const gradient = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
        gradient.addColorStop(0, `rgba(${ACCENT}, 0.42)`);
        gradient.addColorStop(1, `rgba(${ACCENT_2}, 0.28)`);
        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
    };

    const drawNodes = () => {
      for (let i = 1; i < nodes.length; i++) {
        const n = nodes[i]!;
        ctx.fillStyle = `rgba(${ACCENT}, 0.5)`;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // 枢纽节点：外层辉光 + 内核
      const hub = nodes[0]!;
      const glow = ctx.createRadialGradient(
        hub.x,
        hub.y,
        0,
        hub.x,
        hub.y,
        26,
      );
      glow.addColorStop(0, `rgba(${ACCENT}, 0.28)`);
      glow.addColorStop(1, `rgba(${ACCENT}, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(hub.x, hub.y, 26, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `rgba(${ACCENT}, 0.95)`;
      ctx.beginPath();
      ctx.arc(hub.x, hub.y, hub.r, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.beginPath();
      ctx.arc(hub.x - 1.4, hub.y - 1.4, 1.6, 0, Math.PI * 2);
      ctx.fill();
    };

    const drawPulses = () => {
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i]!;
        const a = nodes[p.from]!;
        const b = nodes[p.to]!;
        const x = a.x + (b.x - a.x) * p.t;
        const y = a.y + (b.y - a.y) * p.t;

        const glow = ctx.createRadialGradient(x, y, 0, x, y, 7);
        glow.addColorStop(0, `rgba(${ACCENT_2}, 0.7)`);
        glow.addColorStop(1, `rgba(${ACCENT_2}, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(x, y, 7, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(${ACCENT_2}, 0.95)`;
        ctx.beginPath();
        ctx.arc(x, y, 1.8, 0, Math.PI * 2);
        ctx.fill();

        p.t += p.speed;
        if (p.t >= 1) pulses.splice(i, 1);
      }
    };

    const step = () => {
      ctx.clearRect(0, 0, width, height);

      if (!reducedMotion) {
        // 枢纽轻微呼吸漂移
        const hub = nodes[0]!;
        const t = performance.now() / 1000;
        hub.x = width / 2 + Math.sin(t / 7) * 26;
        hub.y = height * 0.42 + Math.cos(t / 9) * 16;

        for (let i = 1; i < nodes.length; i++) {
          const n = nodes[i]!;
          n.x += n.vx;
          n.y += n.vy;

          // 鼠标附近的节点轻微回避，产生「拨动知识网络」的感觉
          const dx = n.x - mouse.x;
          const dy = n.y - mouse.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 120 * 120 && d2 > 0.01) {
            const d = Math.sqrt(d2);
            const force = (1 - d / 120) * 0.18;
            n.x += (dx / d) * force;
            n.y += (dy / d) * force;
          }

          // 边界回绕
          if (n.x < -20) n.x = width + 20;
          if (n.x > width + 20) n.x = -20;
          if (n.y < -20) n.y = height + 20;
          if (n.y > height + 20) n.y = -20;
        }

        // 不断补充脉冲，保持画面中约 5~9 个流动光点
        if (pulses.length < 5 && Math.random() < 0.06) spawnPulse();
        if (pulses.length < 9 && Math.random() < 0.02) spawnPulse();
      }

      drawEdges();
      drawPulses();
      drawNodes();

      if (!reducedMotion) rafId = requestAnimationFrame(step);
    };

    const handleResize = () => build();
    const handleMouse = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    const handleVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(rafId);
      } else if (!reducedMotion) {
        rafId = requestAnimationFrame(step);
      }
    };

    build();
    step();
    window.addEventListener("resize", handleResize);
    window.addEventListener("mousemove", handleMouse);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("mousemove", handleMouse);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={styles.canvas}
      aria-hidden="true"
    />
  );
}
