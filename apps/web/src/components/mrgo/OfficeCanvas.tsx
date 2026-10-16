'use client';

/**
 * OfficeCanvas — "La oficina, en vivo".
 *
 * Renderiza la oficina de Mr Go como una escena: una sala cálida con escritorios
 * donde cada agente activo está "trabajando" con su laptop (glow cuando está en
 * 'working'), su mascota al lado y una etiqueta con nombre + rol. El CEO (lila)
 * ocupa el puesto de dirección, destacado arriba. Al derivarse una orden, el
 * escritorio del agente elegido se ilumina.
 *
 * Es 100% CSS/divs (sin Pixi ni dependencias nuevas): fiable, liviano y encaja
 * en el panel oscuro como un "escenario" cálido. El layout es responsive: los
 * escritorios se acomodan (wrap) y en móvil quedan en una o dos columnas.
 */

import { MrGoAvatar } from './MrGoAvatar';
import {
  MR_GO_PETS,
  type MrGoColorKey,
  type MrGoEmotion,
  type MrGoPetKey,
} from './types';

export interface OfficeDesk {
  key: string;
  nombre: string;
  rol: string;
  color: MrGoColorKey;
  emotion: MrGoEmotion;
  /** Mascota del puesto (opcional); el CEO usa Jinx. */
  pet?: MrGoPetKey;
  /** Resaltado (recibió la última orden). */
  highlighted?: boolean;
  /** Es el puesto de dirección (CEO). */
  director?: boolean;
}

export interface OfficeCanvasProps {
  desks: OfficeDesk[];
  /** Puesto de dirección (CEO); se dibuja arriba, grande. */
  director?: OfficeDesk | null;
  /** Clave seleccionada (click); se marca con anillo. */
  selectedKey?: string | null;
  onSelect?: (key: string) => void;
  className?: string;
}

export function OfficeCanvas({
  desks,
  director,
  selectedKey,
  onSelect,
  className,
}: OfficeCanvasProps) {
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        borderRadius: 18,
        padding: '22px 18px 26px',
        overflow: 'hidden',
        // Sala cálida: pared lila muy suave arriba, piso claro abajo.
        background:
          'linear-gradient(180deg, #2a2342 0%, #342a52 42%, #3f3560 100%)',
        border: '1px solid rgba(168,120,247,0.25)',
      }}
    >
      {/* Piso: una banda más clara con leve perspectiva. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: '46%',
          background:
            'linear-gradient(180deg, rgba(245,240,255,0.05) 0%, rgba(245,240,255,0.12) 100%)',
          borderTop: '1px solid rgba(168,120,247,0.18)',
        }}
      />
      {/* Ventanal decorativo de la pared. */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: 16,
          right: 18,
          width: 120,
          height: 70,
          borderRadius: 10,
          background:
            'linear-gradient(135deg, rgba(126,200,227,0.25), rgba(168,120,247,0.12))',
          border: '2px solid rgba(255,255,255,0.12)',
          boxShadow: 'inset 0 0 0 6px rgba(42,35,66,0.5)',
        }}
      />

      {/* Puesto de dirección (CEO) */}
      {director && (
        <div style={{ position: 'relative', display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
          <DeskStation desk={{ ...director, director: true }} selected={selectedKey === director.key} onSelect={onSelect} big />
        </div>
      )}

      {/* Equipo: escritorios en una grilla cálida */}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 14,
          justifyContent: 'center',
        }}
      >
        {desks.map((d) => (
          <DeskStation key={d.key} desk={d} selected={selectedKey === d.key} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

/** Un puesto: escritorio + laptop (glow si trabaja) + Mr Go sentado + mascota + etiqueta. */
function DeskStation({
  desk,
  selected,
  onSelect,
  big = false,
}: {
  desk: OfficeDesk;
  selected: boolean;
  onSelect?: (key: string) => void;
  big?: boolean;
}) {
  const working = desk.emotion === 'working';
  const avatarSize = big ? 104 : 72;
  const deskW = big ? 176 : 128;
  const clickable = Boolean(onSelect);

  return (
    <div
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onSelect!(desk.key) : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect!(desk.key);
              }
            }
          : undefined
      }
      aria-label={`${desk.nombre} — ${desk.rol}`}
      style={{
        position: 'relative',
        width: deskW,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '6px 8px 10px',
        borderRadius: 14,
        cursor: clickable ? 'pointer' : 'default',
        transition: 'transform .15s ease, box-shadow .15s ease',
        transform: selected || desk.highlighted ? 'translateY(-2px)' : 'none',
        boxShadow:
          selected || desk.highlighted
            ? '0 0 0 2px rgba(168,120,247,0.9), 0 10px 24px rgba(168,120,247,0.25)'
            : 'none',
        background:
          selected || desk.highlighted ? 'rgba(168,120,247,0.08)' : 'transparent',
      }}
    >
      {/* Etiqueta flotante */}
      <div
        style={{
          marginBottom: 2,
          padding: '2px 8px',
          borderRadius: 999,
          background: 'rgba(15,12,28,0.72)',
          border: '1px solid rgba(168,120,247,0.3)',
          fontSize: big ? 12 : 11,
          fontWeight: 600,
          color: '#fff',
          whiteSpace: 'nowrap',
          maxWidth: deskW,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {desk.nombre}
      </div>
      <div style={{ fontSize: 10, color: 'rgba(226,220,245,0.65)', marginBottom: 2, textAlign: 'center', lineHeight: 1.1 }}>
        {desk.rol}
      </div>

      {/* Avatar sentado (su base queda detrás del frente del escritorio) */}
      <div style={{ position: 'relative', zIndex: 1, marginBottom: -Math.round(avatarSize * 0.22) }}>
        <MrGoAvatar
          color={desk.color}
          emotion={desk.emotion}
          size={avatarSize}
          pet={Boolean(desk.pet)}
          petKey={desk.pet}
          label={`${desk.nombre} (${desk.rol})`}
        />
      </div>

      {/* Escritorio: superficie + frente (da sensación 3D) + laptop con glow */}
      <div style={{ position: 'relative', zIndex: 2, width: deskW - 16 }}>
        {/* superficie */}
        <div
          style={{
            height: 10,
            borderRadius: '8px 8px 2px 2px',
            background: desk.director
              ? 'linear-gradient(180deg,#b58af0,#8b5cf6)'
              : 'linear-gradient(180deg,#6b5a8a,#4b3f66)',
          }}
        />
        {/* frente */}
        <div
          style={{
            height: big ? 18 : 14,
            borderRadius: '0 0 8px 8px',
            background: desk.director
              ? 'linear-gradient(180deg,#8b5cf6,#6d28d9)'
              : 'linear-gradient(180deg,#4b3f66,#352c4d)',
            position: 'relative',
          }}
        >
          {/* laptop */}
          <div
            aria-hidden
            style={{
              position: 'absolute',
              top: -7,
              left: '50%',
              transform: 'translateX(-50%)',
              width: big ? 30 : 24,
              height: big ? 20 : 16,
              borderRadius: 3,
              background: '#1b1530',
              border: '1px solid rgba(255,255,255,0.18)',
              boxShadow: working
                ? `0 0 10px 2px rgba(126,200,227,0.7)`
                : 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 2,
                borderRadius: 2,
                background: working
                  ? 'linear-gradient(135deg,#7ec8e3,#a855f7)'
                  : 'rgba(126,200,227,0.25)',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Helper: la mascota sugerida por rol (para armar los desks desde afuera). */
export function petForRole(roleKey: string): MrGoPetKey | undefined {
  const map: Record<string, MrGoPetKey> = {
    ceo: 'jinx',
    inbox: 'rayito',
    soporte: 'rayito',
    reservas: 'relojito',
    cobros: 'billetin',
    finanzas: 'billetin',
    analitica: 'cerebrito',
    operaciones: 'cerebrito',
    marketing: 'megafonito',
    campanas: 'megafonito',
  };
  const pet = map[roleKey];
  return pet && pet in MR_GO_PETS ? pet : undefined;
}
