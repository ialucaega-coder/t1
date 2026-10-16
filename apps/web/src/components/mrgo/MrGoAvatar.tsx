'use client';

import { useId } from 'react';
import {
  MR_GO_COLORS,
  MR_GO_PETS,
  DEFAULT_PET_FOR_COLOR,
  LILA_EMOTION_ASSETS,
  type MrGoColorKey,
  type MrGoEmotion,
  type MrGoPetKey,
} from './types';

export interface MrGoAvatarProps {
  /** Color/rubro de la familia Mr Go que define el cuerpo (ej: 'LILA'). */
  color: MrGoColorKey;
  /** Emoción a expresar. Por defecto 'happy'. */
  emotion?: MrGoEmotion;
  /** Alto renderizado en píxeles (el ancho se calcula por aspecto). Por defecto 120. */
  size?: number;
  /** Si es true, dibuja la mascota mini (espejo) al lado con la misma emoción. */
  pet?: boolean;
  /** Mascota explícita; si se omite y pet=true, se usa la del color (LILA→Jinx). */
  petKey?: MrGoPetKey;
  /** Vida ambiente (respira + flota + parpadeo sutil). Por defecto true. */
  alive?: boolean;
  /** Multiplicador de velocidad de la vida (1 = normal; >1 más lento). */
  rate?: number;
  /** Texto accesible para el avatar (role="img"). Si falta, se arma uno por defecto. */
  label?: string;
  className?: string;
}

// Mapa de emoción → nombre amigable (para el aria-label).
const EMOTION_ES: Record<MrGoEmotion, string> = {
  happy: 'feliz',
  working: 'trabajando',
  thinking: 'pensando',
  nerd: 'concentrado',
  angry: 'enojado',
  sleepy: 'durmiendo',
  love: 'encantado',
};

/**
 * Ruta del PNG del cuerpo. El LILA tiene asset dedicado por emoción (hoja
 * técnica). El resto de los colores existe en una sola pose (saludando), así que
 * la emoción se transmite por animación CSS. 'working' reusa la pose de saludo.
 */
function bodySrc(color: MrGoColorKey, emotion: MrGoEmotion): string {
  if (color === 'LILA') {
    const emo = LILA_EMOTION_ASSETS.includes(emotion) ? emotion : 'happy';
    return `/mrgo/body/LILA_${emo}.png`;
  }
  return `/mrgo/body/${color}.png`;
}

/** Hash estable [0,1) a partir de un string (para desincronizar la vida por instancia). */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * Avatar de marca "Mr Go": personaje clay-3D renderizado desde los PNG oficiales
 * (14 colores + 6 emociones de LILA + 6 mascotas espejo), con "vida" ambiente
 * (respira, flota, parpadea) y animación por emoción. Fondo transparente: se
 * puede montar sobre cualquier superficie. Inspirado en el "blobatar" vivo de la
 * oficina de Munder Difflin (respira/bob/expresión) adaptado a PNG.
 */
export function MrGoAvatar({
  color,
  emotion = 'happy',
  size = 120,
  pet = false,
  petKey,
  alive = true,
  rate = 1,
  label,
  className,
}: MrGoAvatarProps) {
  const uid = useId().replace(/:/g, '');
  const info = MR_GO_COLORS[color];

  const resolvedPet: MrGoPetKey | undefined = pet
    ? petKey ?? DEFAULT_PET_FOR_COLOR[color]
    : undefined;

  const aria = label ?? `Mr Go ${info.label} (${EMOTION_ES[emotion]})`;
  const glow = emotion === 'working';
  const petSize = Math.round(size * 0.36);

  // Fases por instancia: cada Mr Go respira/flota en su propio tiempo (como el
  // --mo-phase de Munder Difflin), así una oficina llena no late al unísono.
  const ph = hash01(uid);
  const bobPhase = -(ph * 3.4).toFixed(2);
  const breathePhase = -((1 - ph) * 2.8).toFixed(2);

  // Ritmo según emoción (como --mo-rate): trabajar = más vivo; dormir = lento.
  const r =
    rate *
    (emotion === 'working' ? 0.75 : emotion === 'sleepy' ? 1.8 : emotion === 'love' ? 0.7 : 1);

  return (
    <div
      role="img"
      aria-label={aria}
      className={`mrgo-av-${uid} ${className ?? ''}`}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        height: size,
        lineHeight: 0,
      }}
    >
      <style>{`
        /* Vida ambiente: flota (bob) + respira (breathe), desincronizadas. */
        @keyframes mrgo-bob-${uid} { from{transform:translateY(0)} to{transform:translateY(-3.5px)} }
        @keyframes mrgo-breathe-${uid} { from{transform:scaleX(1) scaleY(1)} to{transform:scaleX(1.03) scaleY(0.976)} }
        /* Glow pulsante del "trabajando". */
        @keyframes mrgo-glow-${uid} { 0%,100%{opacity:.55} 50%{opacity:1} }

        .mrgo-av-${uid} .mrgo-bob-${uid}{
          animation: mrgo-bob-${uid} ${(3.4 * r).toFixed(2)}s ease-in-out ${bobPhase}s infinite alternate;
          transform-origin:center bottom;
        }
        .mrgo-av-${uid} .mrgo-body-${uid}{
          animation: mrgo-breathe-${uid} ${(2.8 * r).toFixed(2)}s ease-in-out ${breathePhase}s infinite alternate;
          transform-origin:center bottom;
        }
        .mrgo-av-${uid} .mrgo-glowlayer-${uid}{
          animation: mrgo-glow-${uid} ${(1.6 * r).toFixed(2)}s ease-in-out infinite;
        }
        .mrgo-av-${uid}:hover .mrgo-bob-${uid}{ transform: translateY(-5px) scale(1.05); }
        .mrgo-av-${uid}.mrgo-still .mrgo-bob-${uid},
        .mrgo-av-${uid}.mrgo-still .mrgo-body-${uid}{ animation: none; }
        @media (prefers-reduced-motion: reduce){
          .mrgo-av-${uid} .mrgo-bob-${uid},
          .mrgo-av-${uid} .mrgo-body-${uid},
          .mrgo-av-${uid} .mrgo-glowlayer-${uid}{ animation: none; }
        }
      `}</style>

      {/* Capa bob (flota) → dentro, la capa breathe (respira) con la imagen. */}
      <div
        className={alive ? `mrgo-bob-${uid}` : undefined}
        style={{ position: 'relative', display: 'inline-flex', alignItems: 'flex-end', lineHeight: 0 }}
      >
        {/* glow de "trabajando" detrás del cuerpo */}
        {glow && (
          <span
            aria-hidden
            className={alive ? `mrgo-glowlayer-${uid}` : undefined}
            style={{
              position: 'absolute',
              inset: '8% 8% 2% 8%',
              borderRadius: '50%',
              background: `radial-gradient(circle, ${info.hex}55 0%, transparent 70%)`,
              filter: 'blur(6px)',
              zIndex: 0,
            }}
          />
        )}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={bodySrc(color, emotion)}
          alt=""
          className={alive ? `mrgo-body-${uid}` : undefined}
          draggable={false}
          style={{
            position: 'relative',
            zIndex: 1,
            height: size,
            width: 'auto',
            objectFit: 'contain',
            filter: 'drop-shadow(0 3px 4px rgba(0,0,0,0.22))',
            userSelect: 'none',
          }}
        />

        {resolvedPet && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/mrgo/pet/${resolvedPet}.png`}
              alt=""
              draggable={false}
              title={`${MR_GO_PETS[resolvedPet].nombre} · ${MR_GO_PETS[resolvedPet].rol}`}
              style={{
                position: 'relative',
                zIndex: 1,
                height: petSize,
                width: 'auto',
                objectFit: 'contain',
                marginLeft: Math.round(size * -0.06),
                filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.2))',
                userSelect: 'none',
              }}
            />
          </>
        )}
      </div>

      {emotion === 'sleepy' && (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            top: 0,
            right: resolvedPet ? '28%' : '10%',
            fontSize: Math.max(11, Math.round(size * 0.16)),
            color: info.hex,
            fontWeight: 800,
            opacity: 0.85,
          }}
        >
          z
        </span>
      )}
    </div>
  );
}
