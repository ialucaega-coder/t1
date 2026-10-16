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

// Clase de animación por emoción (definida en el <style> de abajo).
function animClass(emotion: MrGoEmotion, uid: string): string | undefined {
  switch (emotion) {
    case 'working':
      return `mrgo-working-${uid}`;
    case 'sleepy':
      return `mrgo-sleepy-${uid}`;
    case 'love':
      return `mrgo-love-${uid}`;
    case 'happy':
      return `mrgo-float-${uid}`;
    default:
      return undefined;
  }
}

/**
 * Avatar de marca "Mr Go": personaje clay-3D renderizado desde los PNG oficiales
 * (14 colores + 6 emociones de LILA + 6 mascotas espejo), con animación sutil
 * por emoción. Fondo transparente: se puede montar sobre cualquier superficie.
 */
export function MrGoAvatar({
  color,
  emotion = 'happy',
  size = 120,
  pet = false,
  petKey,
  label,
  className,
}: MrGoAvatarProps) {
  const uid = useId().replace(/:/g, '');
  const info = MR_GO_COLORS[color];

  const resolvedPet: MrGoPetKey | undefined = pet
    ? petKey ?? DEFAULT_PET_FOR_COLOR[color]
    : undefined;

  const aria = label ?? `Mr Go ${info.label} (${EMOTION_ES[emotion]})`;
  const anim = animClass(emotion, uid);
  const glow = emotion === 'working';

  // La mascota se dibuja al ~36% del alto, apoyada abajo a la derecha (espejo).
  const petSize = Math.round(size * 0.36);

  return (
    <div
      role="img"
      aria-label={aria}
      className={className}
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
        @keyframes mrgo-float-${uid} { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
        @keyframes mrgo-working-${uid} { 0%,100%{transform:rotate(-1.5deg)} 50%{transform:rotate(1.5deg)} }
        @keyframes mrgo-sleepy-${uid} { 0%,100%{transform:translateY(0)} 50%{transform:translateY(2px)} }
        @keyframes mrgo-love-${uid} { 0%,100%{transform:scale(1)} 50%{transform:scale(1.05)} }
        .mrgo-float-${uid}{animation:mrgo-float-${uid} 4s ease-in-out infinite;transform-origin:center bottom}
        .mrgo-working-${uid}{animation:mrgo-working-${uid} 1.1s ease-in-out infinite;transform-origin:50% 90%}
        .mrgo-sleepy-${uid}{animation:mrgo-sleepy-${uid} 3.5s ease-in-out infinite;transform-origin:center bottom}
        .mrgo-love-${uid}{animation:mrgo-love-${uid} 1.6s ease-in-out infinite;transform-origin:center bottom}
        @media (prefers-reduced-motion: reduce){
          .mrgo-float-${uid},.mrgo-working-${uid},.mrgo-sleepy-${uid},.mrgo-love-${uid}{animation:none}
        }
      `}</style>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={bodySrc(color, emotion)}
        alt=""
        className={anim}
        draggable={false}
        style={{
          height: size,
          width: 'auto',
          objectFit: 'contain',
          filter: glow
            ? `drop-shadow(0 0 ${Math.round(size * 0.08)}px ${info.hex}aa)`
            : 'drop-shadow(0 3px 4px rgba(0,0,0,0.18))',
          userSelect: 'none',
        }}
      />

      {resolvedPet && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/mrgo/pet/${resolvedPet}.png`}
            alt=""
            className={anim}
            draggable={false}
            title={`${MR_GO_PETS[resolvedPet].nombre} · ${MR_GO_PETS[resolvedPet].rol}`}
            style={{
              height: petSize,
              width: 'auto',
              objectFit: 'contain',
              marginLeft: Math.round(size * -0.06),
              filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.18))',
              userSelect: 'none',
            }}
          />
        </>
      )}

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
            opacity: 0.8,
          }}
        >
          z
        </span>
      )}
    </div>
  );
}
