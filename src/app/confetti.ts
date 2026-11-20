/**
 * The celebration: a burst of loose stickers in the cube's own colours. With reduced motion the
 * stickers are scattered once and stay still.
 */
interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  turn: number;
  spin: number;
  flip: number;
  flipRate: number;
  colour: string;
}

const GRAVITY = 1500;
const DRAG = 0.985;

/** Starts the confetti on this canvas and returns a function that stops and clears it. */
export function launchConfetti(canvas: HTMLCanvasElement, colours: readonly string[], reduced: boolean, around?: { left: number; top: number; width: number; height: number }): () => void {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const g = canvas.getContext('2d');
  if (!g || width === 0) return () => undefined;
  g.scale(ratio, ratio);
  const unit = Math.max(9, Math.min(16, width / 34));
  const pieces: Piece[] = [];
  const add = (x: number, y: number, angle: number, speed: number): void => {
    pieces.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: unit * (0.7 + Math.random() * 0.7),
      turn: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 9,
      flip: Math.random() * Math.PI,
      flipRate: 4 + Math.random() * 7,
      colour: colours[Math.floor(Math.random() * colours.length)] as string,
    });
  };

  const draw = (): void => {
    g.clearRect(0, 0, width, height);
    for (const p of pieces) {
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.turn);
      g.scale(1, Math.cos(p.flip));
      g.fillStyle = p.colour;
      g.strokeStyle = 'rgba(11, 10, 13, 0.55)';
      g.lineWidth = 1.5;
      g.beginPath();
      g.roundRect(-p.size / 2, -p.size / 2, p.size, p.size, p.size * 0.22);
      g.fill();
      g.stroke();
      g.restore();
    }
  };

  if (reduced) {
    // Still stickers lie round the cube picture only: never over the header, the words or the cube itself.
    const box = around && around.width > 0 ? around : { left: 0, top: height * 0.08, width, height: height * 0.4 };
    const clear = Math.min(box.width, box.height) * 0.4;
    for (let tries = 0; pieces.length < 40 && tries < 2000; tries++) {
      const x = box.left + unit + Math.random() * (box.width - 2 * unit);
      const y = box.top + unit + Math.random() * (box.height - 2 * unit);
      if (Math.hypot(x - (box.left + box.width / 2), y - (box.top + box.height / 2)) < clear) continue;
      add(x, y, 0, 0);
      (pieces[pieces.length - 1] as Piece).flip = (Math.random() - 0.5) * 1.6;
    }
    draw();
    return () => g.clearRect(0, 0, width, height);
  }

  const burst = (x: number, y: number, towards: number, count: number): void => {
    for (let i = 0; i < count; i++) add(x, y, towards + (Math.random() - 0.5) * 1.1, height * (0.9 + Math.random() * 0.9));
  };
  const up = -Math.PI / 2;
  burst(0, height * 0.72, up + 0.5, 70);
  burst(width, height * 0.72, up - 0.5, 70);
  const late = window.setTimeout(() => burst(width / 2, height * 0.9, up, 80), 550);

  let frame = 0;
  let last = performance.now();
  const started = last;
  const tick = (now: number): void => {
    const dt = Math.min(0.04, (now - last) / 1000);
    last = now;
    let live = false;
    for (const p of pieces) {
      p.vy += GRAVITY * dt;
      p.vx *= DRAG;
      p.vy *= DRAG;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.turn += p.spin * dt;
      p.flip += p.flipRate * dt;
      if (p.y < height + 40) live = true;
    }
    draw();
    if (live || now - started < 700) frame = requestAnimationFrame(tick);
    else g.clearRect(0, 0, width, height);
  };
  frame = requestAnimationFrame(tick);
  return () => {
    clearTimeout(late);
    cancelAnimationFrame(frame);
    g.clearRect(0, 0, width, height);
  };
}
