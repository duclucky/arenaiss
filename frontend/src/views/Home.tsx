import { useEffect, useRef, useState, type RefObject } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { useAppContext } from '../context';

const HERO_FRAME_COUNT = 97;
const HERO_FIRST_FRAME = '/hero-sequence/frame-001.webp';
const HERO_LINES = [
  { key: 'brand', text: 'Arena ISS' },
  { key: 'standard', text: 'Arena Intelligence, Safety & Standards.' },
  { key: 'promise', text: 'Test how agents think, act, and follow rules.' },
] as const;
const HERO_TEXT = HERO_LINES.map(({ text }) => text).join('\n');
const HERO_LABEL = HERO_LINES.map(({ text }) => text).join(' ');
const FRAME_RESPONSE = 14;
const FRAME_EPSILON = 0.08;
const PARALLAX_RESPONSE = 10;
const PARALLAX_EPSILON = 0.05;
const PARALLAX_X_PX = 14;
const PARALLAX_Y_PX = 8;

function heroFrameSource(index: number) {
  return `/hero-sequence/frame-${String(index + 1).padStart(3, '0')}.webp`;
}

function useTypewriter(text: string, speed = 38, startDelay = 600) {
  const [displayed, setDisplayed] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) {
      setDisplayed(text);
      setDone(true);
      return;
    }
    setDisplayed('');
    setDone(false);
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = window.setTimeout(() => {
      let index = 0;
      interval = setInterval(() => {
        index += 1;
        setDisplayed(text.slice(0, index));
        if (index >= text.length) {
          clearInterval(interval);
          setDone(true);
        }
      }, speed);
    }, startDelay);
    return () => {
      window.clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, [text, speed, startDelay]);

  return { displayed, done };
}

function useHeroFrameSequence(canvasRef: RefObject<HTMLCanvasElement>) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const coarsePointer = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const loadedFrames = new Map<number, HTMLImageElement>();
    const frameRequests = new Map<number, Promise<void>>();
    const createdImages = new Set<HTMLImageElement>();
    let active = true;
    let targetFrame = 0;
    let renderedFrame = 0;
    let drawnFrame = -1;
    let targetX = 0;
    let targetY = 0;
    let renderedX = 0;
    let renderedY = 0;
    let animationFrame: number | null = null;
    let lastTimestamp: number | null = null;

    const resizeCanvas = () => {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const pixelWidth = Math.round(width * dpr);
      const pixelHeight = Math.round(height * dpr);
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        drawnFrame = -1;
      }
      return { width, height, dpr };
    };

    const drawFrame = (requestedIndex: number) => {
      if (requestedIndex === drawnFrame) return;
      const image = loadedFrames.get(requestedIndex);
      const context = canvas.getContext('2d', { alpha: false });
      if (!image || !context) return;

      const { width, height, dpr } = resizeCanvas();
      const imageWidth = image.naturalWidth || image.width;
      const imageHeight = image.naturalHeight || image.height;
      if (!imageWidth || !imageHeight) return;

      const scale = Math.max(width / imageWidth, height / imageHeight);
      const sourceWidth = width / scale;
      const sourceHeight = height / scale;
      const sourceX = Math.max(0, (imageWidth - sourceWidth) * 0.7);
      const sourceY = Math.max(0, (imageHeight - sourceHeight) * 0.5);

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height);
      drawnFrame = requestedIndex;
      canvas.dataset.ready = 'true';
    };

    const loadFrame = (index: number) => {
      const safeIndex = Math.min(HERO_FRAME_COUNT - 1, Math.max(0, index));
      const existing = frameRequests.get(safeIndex);
      if (existing) return existing;

      const request = new Promise<void>((resolve) => {
        const image = new Image();
        createdImages.add(image);
        image.decoding = 'async';
        image.onload = () => {
          if (active) {
            loadedFrames.set(safeIndex, image);
            if (safeIndex === Math.round(renderedFrame) || canvas.dataset.ready !== 'true') {
              drawFrame(safeIndex);
            }
          }
          resolve();
        };
        image.onerror = () => resolve();
        image.src = heroFrameSource(safeIndex);
      });
      frameRequests.set(safeIndex, request);
      return request;
    };

    const scheduleAnimation = () => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame((timestamp) => {
        animationFrame = null;
        const elapsedSeconds = lastTimestamp === null
          ? 0.016
          : Math.min(0.032, Math.max(0.001, (timestamp - lastTimestamp) / 1000));
        lastTimestamp = timestamp;
        const frameAlpha = 1 - Math.exp(-FRAME_RESPONSE * elapsedSeconds);
        const parallaxAlpha = 1 - Math.exp(-PARALLAX_RESPONSE * elapsedSeconds);

        const frameDistance = targetFrame - renderedFrame;
        if (Math.abs(frameDistance) < FRAME_EPSILON) {
          renderedFrame = targetFrame;
        } else {
          renderedFrame += frameDistance * frameAlpha;
        }
        renderedX += (targetX - renderedX) * parallaxAlpha;
        renderedY += (targetY - renderedY) * parallaxAlpha;

        const requestedFrame = Math.round(renderedFrame);
        canvas.dataset.renderedFrame = String(requestedFrame);
        canvas.style.setProperty('--hero-shift-x', `${renderedX.toFixed(3)}px`);
        canvas.style.setProperty('--hero-shift-y', `${renderedY.toFixed(3)}px`);
        drawFrame(requestedFrame);
        void loadFrame(requestedFrame);

        if (Math.abs(targetFrame - renderedFrame) >= FRAME_EPSILON || Math.abs(targetX - renderedX) >= PARALLAX_EPSILON || Math.abs(targetY - renderedY) >= PARALLAX_EPSILON) {
          scheduleAnimation();
        } else {
          lastTimestamp = null;
        }
      });
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== 'mouse') return;
      const normalizedX = Math.min(1, Math.max(0, event.clientX / window.innerWidth));
      const normalizedY = Math.min(1, Math.max(0, event.clientY / window.innerHeight));
      targetFrame = normalizedX * (HERO_FRAME_COUNT - 1);
      canvas.dataset.targetFrame = String(Math.round(targetFrame));
      targetX = reducedMotion ? 0 : (normalizedX - 0.5) * 2 * PARALLAX_X_PX;
      targetY = reducedMotion ? 0 : (normalizedY - 0.5) * 2 * PARALLAX_Y_PX;
      const requestedFrame = Math.round(targetFrame);
      for (let offset = -2; offset <= 2; offset += 1) void loadFrame(requestedFrame + offset);
      scheduleAnimation();
    };

    const onPointerLeave = () => {
      targetX = 0;
      targetY = 0;
      scheduleAnimation();
    };

    canvas.dataset.targetFrame = '0';
    canvas.dataset.renderedFrame = '0';
    void loadFrame(0);

    if (!coarsePointer) {
      window.addEventListener('pointermove', onPointerMove, { passive: true });
      document.documentElement.addEventListener('pointerleave', onPointerLeave);

      const anchors = [24, 48, 72, 96];
      const remaining = Array.from({ length: HERO_FRAME_COUNT - 1 }, (_, index) => index + 1)
        .filter((index) => !anchors.includes(index));
      for (const index of anchors) void loadFrame(index);
      for (let worker = 0; worker < 4; worker += 1) {
        void (async () => {
          while (active) {
            const index = remaining.shift();
            if (index === undefined) return;
            await loadFrame(index);
          }
        })();
      }
    }

    const onResize = () => {
      drawnFrame = -1;
      drawFrame(Math.round(renderedFrame));
    };
    window.addEventListener('resize', onResize, { passive: true });

    return () => {
      active = false;
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      window.removeEventListener('pointermove', onPointerMove);
      document.documentElement.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('resize', onResize);
      for (const image of createdImages) {
        image.onload = null;
        image.onerror = null;
      }
    };
  }, [canvasRef]);
}

export function Home() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { account } = useAppContext();
  const { openLogin } = useOutletContext<{ openLogin: (destination?: string) => void }>();
  const { displayed, done } = useTypewriter(HERO_TEXT);
  useHeroFrameSequence(canvasRef);
  const displayedLines = displayed.split('\n');
  const activeLine = Math.min(displayedLines.length - 1, HERO_LINES.length - 1);

  return <section className="hero-stage">
    <canvas
      ref={canvasRef}
      className="hero-canvas"
      aria-hidden="true"
      data-frame-count={HERO_FRAME_COUNT}
      data-frame-source={HERO_FIRST_FRAME}
      data-target-frame="0"
      data-rendered-frame="0"
    />
    <div className="hero-wash" aria-hidden="true" />
    <div className="hero-content">
      <h1 aria-label={HERO_LABEL} className="hero-typewriter">
        {HERO_LINES.map((line, index) => <span
          key={line.key}
          aria-hidden="true"
          className={`hero-line hero-line--${line.key}`}
          data-hero-line={line.key}
        >
          {displayedLines[index] ?? ''}
          {!done && activeLine === index && <span className="type-cursor" aria-hidden="true" />}
        </span>)}
      </h1>
      <div className="hero-actions" data-visible="true">
        {account
          ? <Link className="hero-pill hero-pill--light" to="/agents">Start with Agent</Link>
          : <button className="hero-pill hero-pill--light" type="button" onClick={() => openLogin('/agents')}>Start with Agent</button>}
        <Link className="hero-pill hero-pill--outline" to="/docs">Read Docs</Link>
      </div>
    </div>
    <div className="hero-footnote" aria-label="Technology stack">
      <span>Arc-native USDC escrow</span><span>GenLayer semantic verdicts</span><span>Asynchronous by design</span>
    </div>
  </section>;
}
