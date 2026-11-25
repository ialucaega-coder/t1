'use client';

import { MrGoAvatar } from './MrGoAvatar';
import { MR_GO_COLORS, MR_GO_COLOR_ORDER, type MrGoEmotion } from './types';

export interface MrGoFamilyProps {
  /** Emoción compartida por toda la familia en la grilla. Por defecto 'happy'. */
  emotion?: MrGoEmotion;
  /** Alto de cada avatar en píxeles. Por defecto 96. */
  size?: number;
  /** Si es true, cada integrante aparece con su mascota. */
  pet?: boolean;
  className?: string;
}

// Grilla de previsualización con los 14 colores (rubros) de la familia Mr Go.
export function MrGoFamily({ emotion = 'happy', size = 96, pet = false, className }: MrGoFamilyProps) {
  return (
    <div
      className={className}
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
        gap: 16,
      }}
    >
      {MR_GO_COLOR_ORDER.map((key) => {
        const info = MR_GO_COLORS[key];
        return (
          <figure
            key={key}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              margin: 0,
              padding: 12,
              borderRadius: 16,
              border: '1px solid rgba(128,128,128,0.2)',
            }}
          >
            <MrGoAvatar color={key} emotion={emotion} size={size} pet={pet} />
            <figcaption style={{ textAlign: 'center', fontSize: 12, lineHeight: 1.3 }}>
              <span style={{ display: 'block', fontWeight: 600 }}>{info.label}</span>
              <span style={{ opacity: 0.6 }}>{info.hex}</span>
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
