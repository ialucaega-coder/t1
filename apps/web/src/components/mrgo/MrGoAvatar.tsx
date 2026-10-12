'use client';

import { useId } from 'react';
import { MR_GO_COLORS, type MrGoColorKey, type MrGoEmotion } from './types';

export interface MrGoAvatarProps {
  /** Color/rubro de la familia Mr Go que define el cuerpo (ej: 'LILA'). */
  color: MrGoColorKey;
  /** Emoción a expresar. Por defecto 'happy'. */
  emotion?: MrGoEmotion;
  /** Alto renderizado en píxeles (el ancho se calcula por aspecto). Por defecto 120. */
  size?: number;
  /** Si es true, dibuja una mascota mini (gatito) al lado con la misma emoción. */
  pet?: boolean;
  /** Texto accesible para el avatar (role="img"). Si falta, se arma uno por defecto. */
  label?: string;
  className?: string;
}

// Coordenadas internas fijas del dibujo (todo el escalado se hace por viewBox).
const VB_HEIGHT = 140;
const VB_WIDTH_BASE = 120; // solo Mr Go
const VB_WIDTH_PET = 190; // Mr Go + mascota

const LEFT_EYE = { x: 48, y: 70 };
const RIGHT_EYE = { x: 72, y: 70 };
const EYE_R = 5;

// Componente visual de marca "Mr Go": un personaje "clay 3D" en forma de gota,
// dibujado 100% con SVG inline (sin PNGs externos) para que funcione ya.
export function MrGoAvatar({
  color,
  emotion = 'happy',
  size = 120,
  pet = false,
  label,
  className,
}: MrGoAvatarProps) {
  // IDs únicos por instancia para que gradientes/filtros no colisionen en la grilla.
  const uid = useId().replace(/:/g, '');
  const highlightId = `mrgo-hl-${uid}`;
  const shadeId = `mrgo-sh-${uid}`;
  const glowId = `mrgo-glow-${uid}`;

  const info = MR_GO_COLORS[color];
  const bodyColor = info.hex;
  const vbWidth = pet ? VB_WIDTH_PET : VB_WIDTH_BASE;
  const height = size;
  const width = (size * vbWidth) / VB_HEIGHT;

  const emotionEs = EMOTION_LABELS_ES[emotion];
  const resolvedLabel = label ?? `Mr Go ${info.label} (${emotionEs})`;

  // Trazo de la gota (teardrop): punta arriba, base redonda abajo.
  const teardrop =
    'M60 8 C90 25 106 55 106 78 A46 46 0 0 1 14 78 C14 55 30 25 60 8 Z';

  const showGlow = emotion === 'working';

  return (
    <div
      role="img"
      aria-label={resolvedLabel}
      className={className}
      style={{ display: 'inline-block', lineHeight: 0 }}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${vbWidth} ${VB_HEIGHT}`}
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Animación de saludo (solo si el usuario no pidió movimiento reducido). */}
        <style>{`
          @media (prefers-reduced-motion: no-preference) {
            .mrgo-wave-${uid} {
              transform-box: fill-box;
              transform-origin: 50% 88%;
              animation: mrgo-wave-${uid} 1.1s ease-in-out infinite;
            }
          }
          @keyframes mrgo-wave-${uid} {
            0%, 100% { transform: rotate(-10deg); }
            50% { transform: rotate(20deg); }
          }
        `}</style>

        <defs>
          {/* Brillo superior izquierdo para el look clay 3D. */}
          <radialGradient id={highlightId} cx="38%" cy="26%" r="62%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="60%" stopColor="#ffffff" stopOpacity="0" />
          </radialGradient>
          {/* Sombra inferior derecha para dar volumen. */}
          <radialGradient id={shadeId} cx="64%" cy="82%" r="60%">
            <stop offset="0%" stopColor="#000000" stopOpacity="0.2" />
            <stop offset="70%" stopColor="#000000" stopOpacity="0" />
          </radialGradient>
          {showGlow && (
            <filter id={glowId} x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="4" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          )}
        </defs>

        {/* Sombra de apoyo en el piso. */}
        <ellipse cx="60" cy="128" rx="40" ry="7" fill="#000000" opacity="0.12" />

        {/* Glow de "working" detrás del cuerpo (opcional). */}
        {showGlow && (
          <path d={teardrop} fill={bodyColor} opacity="0.35" filter={`url(#${glowId})`} />
        )}

        {/* Cuerpo gota + overlays de volumen. */}
        <g>
          <path d={teardrop} fill={bodyColor} stroke="rgba(0,0,0,0.14)" strokeWidth="1.5" />
          <path d={teardrop} fill={`url(#${highlightId})`} />
          <path d={teardrop} fill={`url(#${shadeId})`} />
        </g>

        {/* Cara: ojos, nariz, boca y extras según emoción. */}
        <MrGoEyes emotion={emotion} left={LEFT_EYE} right={RIGHT_EYE} r={EYE_R} />
        {emotion === 'angry' && <MrGoBrows left={LEFT_EYE} right={RIGHT_EYE} />}
        {emotion === 'nerd' && <MrGoGlasses left={LEFT_EYE} right={RIGHT_EYE} />}
        <MrGoNose x={60} y={83} />
        <MrGoMouth emotion={emotion} />
        {emotion === 'sleepy' && <MrGoZzz x={92} y={34} />}

        {/* Mano saludando (5 dedos). Se anima en 'working'. */}
        <g>
          <g className={emotion === 'working' ? `mrgo-wave-${uid}` : undefined}>
            <MrGoHand color={bodyColor} />
          </g>
        </g>

        {/* Mascota mini (gatito) haciendo la misma emoción, espejada. */}
        {pet && (
          <g transform="translate(176 96) scale(-1 1)">
            <MrGoPet emotion={emotion} color={bodyColor} />
          </g>
        )}
      </svg>
    </div>
  );
}

// Etiquetas en español para armar el aria-label por defecto.
const EMOTION_LABELS_ES: Record<MrGoEmotion, string> = {
  happy: 'feliz',
  working: 'trabajando',
  thinking: 'pensando',
  nerd: 'nerd',
  angry: 'enojado',
  sleepy: 'dormido',
  love: 'enamorado',
};

type Pt = { x: number; y: number };

// --- Piezas de la cara (sub-componentes internos, sin exportar) ---

function MrGoEyes({
  emotion,
  left,
  right,
  r,
}: {
  emotion: MrGoEmotion;
  left: Pt;
  right: Pt;
  r: number;
}) {
  if (emotion === 'sleepy') {
    // Ojos cerrados: arcos hacia abajo.
    return (
      <g fill="none" stroke="#1f1f1f" strokeWidth="2.5" strokeLinecap="round">
        <path d={`M${left.x - 5} ${left.y} Q${left.x} ${left.y + 5} ${left.x + 5} ${left.y}`} />
        <path d={`M${right.x - 5} ${right.y} Q${right.x} ${right.y + 5} ${right.x + 5} ${right.y}`} />
      </g>
    );
  }
  if (emotion === 'love') {
    // Ojos corazón rosas.
    return (
      <g fill="#FF4D8D">
        <path d={heartPath(left.x, left.y, 6)} />
        <path d={heartPath(right.x, right.y, 6)} />
      </g>
    );
  }
  // Ojitos normales: puntos negros.
  return (
    <g fill="#1f1f1f">
      <circle cx={left.x} cy={left.y} r={r} />
      <circle cx={right.x} cy={right.y} r={r} />
      {/* Pequeño brillo para que se vean vivos. */}
      <circle cx={left.x + 1.6} cy={left.y - 1.6} r={1.3} fill="#ffffff" />
      <circle cx={right.x + 1.6} cy={right.y - 1.6} r={1.3} fill="#ffffff" />
    </g>
  );
}

function MrGoBrows({ left, right }: { left: Pt; right: Pt }) {
  // Cejas enojadas: inclinadas hacia el centro.
  return (
    <g stroke="#1f1f1f" strokeWidth="3" strokeLinecap="round">
      <line x1={left.x - 6} y1={left.y - 11} x2={left.x + 6} y2={left.y - 6} />
      <line x1={right.x + 6} y1={right.y - 11} x2={right.x - 6} y2={right.y - 6} />
    </g>
  );
}

function MrGoGlasses({ left, right }: { left: Pt; right: Pt }) {
  // Anteojos negros (nerd) encima de los ojos.
  return (
    <g fill="none" stroke="#1f1f1f" strokeWidth="2.5">
      <rect x={left.x - 8} y={left.y - 8} width="16" height="16" rx="4" />
      <rect x={right.x - 8} y={right.y - 8} width="16" height="16" rx="4" />
      <line x1={left.x + 8} y1={left.y} x2={right.x - 8} y2={right.y} />
    </g>
  );
}

function MrGoNose({ x, y }: { x: number; y: number }) {
  // Nariz bulbosa con brillo.
  return (
    <g>
      <ellipse cx={x} cy={y} rx="7" ry="6" fill="rgba(0,0,0,0.12)" />
      <ellipse cx={x} cy={y} rx="5.5" ry="4.8" fill="rgba(255,255,255,0.18)" />
      <circle cx={x - 1.6} cy={y - 1.6} r="1.4" fill="#ffffff" opacity="0.8" />
    </g>
  );
}

function MrGoMouth({ emotion }: { emotion: MrGoEmotion }) {
  const stroke = '#1f1f1f';
  switch (emotion) {
    case 'happy':
    case 'love':
      return (
        <path
          d="M45 93 Q60 110 75 93"
          fill="none"
          stroke={stroke}
          strokeWidth="3"
          strokeLinecap="round"
        />
      );
    case 'working':
    case 'nerd':
      return (
        <path
          d="M49 94 Q60 103 71 94"
          fill="none"
          stroke={stroke}
          strokeWidth="3"
          strokeLinecap="round"
        />
      );
    case 'thinking':
      // Boca "o" chica.
      return <circle cx="60" cy="97" r="4" fill="none" stroke={stroke} strokeWidth="2.5" />;
    case 'angry':
      // Boca recta.
      return <line x1="50" y1="98" x2="70" y2="98" stroke={stroke} strokeWidth="3" strokeLinecap="round" />;
    case 'sleepy':
      // Boquita relajada.
      return (
        <path
          d="M55 96 Q60 100 65 96"
          fill="none"
          stroke={stroke}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      );
  }
}

function MrGoZzz({ x, y }: { x: number; y: number }) {
  // "z z z" para la emoción sleepy.
  return (
    <g fill="#1f1f1f" fontFamily="sans-serif" fontWeight="700" opacity="0.7">
      <text x={x} y={y} fontSize="8">z</text>
      <text x={x + 7} y={y - 7} fontSize="10">z</text>
      <text x={x + 16} y={y - 16} fontSize="13">z</text>
    </g>
  );
}

function MrGoHand({ color }: { color: string }) {
  // Mano saludando con 5 dedos (4 dedos + pulgar) y palma redonda.
  return (
    <g stroke="rgba(0,0,0,0.14)" strokeWidth="1">
      {/* Dedos (capsulas con linecap redondo). */}
      <g stroke={color} strokeWidth="5.5" strokeLinecap="round">
        <line x1="97" y1="50" x2="93" y2="37" />
        <line x1="101" y1="47" x2="100" y2="32" />
        <line x1="106" y1="47" x2="109" y2="32" />
        <line x1="110" y1="49" x2="115" y2="37" />
        {/* Pulgar. */}
        <line x1="97" y1="59" x2="88" y2="53" strokeWidth="6" />
      </g>
      {/* Palma. */}
      <ellipse cx="104" cy="58" rx="10" ry="11" fill={color} />
    </g>
  );
}

function MrGoPet({ emotion, color }: { emotion: MrGoEmotion; color: string }) {
  // Gatito mini dibujado en coordenadas locales (centro ~0,0), ~30% del tamaño.
  // El color del cuerpo es un poco más tenue que Mr Go pero de la misma familia.
  const eyes = (() => {
    if (emotion === 'sleepy') {
      return (
        <g fill="none" stroke="#1f1f1f" strokeWidth="1.5" strokeLinecap="round">
          <path d="M-7 -2 Q-4 1 -1 -2" />
          <path d="M1 -2 Q4 1 7 -2" />
        </g>
      );
    }
    if (emotion === 'love') {
      return (
        <g fill="#FF4D8D">
          <path d={heartPath(-4, -2, 3)} />
          <path d={heartPath(4, -2, 3)} />
        </g>
      );
    }
    return (
      <g fill="#1f1f1f">
        <circle cx="-4" cy="-2" r="2.2" />
        <circle cx="4" cy="-2" r="2.2" />
      </g>
    );
  })();

  const mouth =
    emotion === 'angry' ? (
      <line x1="-3" y1="6" x2="3" y2="6" stroke="#1f1f1f" strokeWidth="1.5" strokeLinecap="round" />
    ) : (
      <path d="M-3 4 Q0 7 3 4" fill="none" stroke="#1f1f1f" strokeWidth="1.5" strokeLinecap="round" />
    );

  return (
    <g transform="scale(0.85)">
      <ellipse cx="0" cy="22" rx="12" ry="9" fill={color} opacity="0.92" />
      {/* Orejas. */}
      <path d="M-13 -11 L-7 -2 L-16 -2 Z" fill={color} />
      <path d="M13 -11 L7 -2 L16 -2 Z" fill={color} />
      {/* Cabeza. */}
      <circle cx="0" cy="2" r="14" fill={color} />
      <circle cx="0" cy="2" r="14" fill="rgba(255,255,255,0.12)" />
      {/* Cola. */}
      <path d="M11 26 Q22 24 20 14" fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" />
      {eyes}
      {emotion === 'angry' && (
        <g stroke="#1f1f1f" strokeWidth="1.5" strokeLinecap="round">
          <line x1="-7" y1="-6" x2="-2" y2="-4" />
          <line x1="7" y1="-6" x2="2" y2="-4" />
        </g>
      )}
      {/* Naricita. */}
      <circle cx="0" cy="2.5" r="1.6" fill="#1f1f1f" />
      {mouth}
    </g>
  );
}

// Trazo de corazón centrado en (cx,cy) con "radio" s (para ojos love).
function heartPath(cx: number, cy: number, s: number): string {
  return (
    `M${cx} ${cy + s * 0.9} ` +
    `C${cx - s * 1.4} ${cy - s * 0.2} ${cx - s} ${cy - s} ${cx} ${cy - s * 0.3} ` +
    `C${cx + s} ${cy - s} ${cx + s * 1.4} ${cy - s * 0.2} ${cx} ${cy + s * 0.9} Z`
  );
}
