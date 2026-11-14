import Reveal from './Reveal';

// Solo respuestas que el producto ya promete en la propia landing.
export const FAQ_ITEMS = [
  { q: '¿Necesito tarjeta o instalar algo para empezar?', a: 'No. Creás tu cuenta en minutos, sin tarjeta ni instalación, y arrancás con el plan Gratis.' },
  { q: '¿Por qué canales atienden los robots?', a: 'Por WhatsApp y por la web de tu negocio, y desde un solo panel ves todas las conversaciones.' },
  { q: '¿Qué hace el robot por mi negocio?', a: 'Automatiza reservas, pedidos, cobros y atención al cliente, las 24 horas, según el giro que elijas.' },
  { q: '¿Para qué tipo de negocio sirve?', a: 'Hay equipos pensados para restaurante, barbería, farmacia, gimnasio, tienda, taller, spa, dentista e industria, y más giros.' },
  { q: '¿Cuánto cuesta?', a: 'Tenés un plan Gratis para probar y planes pagos (Starter, Pro y Enterprise) que crecen con tu negocio. Podés ver los precios más arriba.' },
  { q: '¿Puedo probarlo antes de decidir?', a: 'Sí: chateá con el bot demo en esta misma página y mirá cómo atiende, agenda, vende y cobra.' },
];

export default function Faq() {
  return (
    <section id="faq" className="poster-band scroll-mt-16">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div>
        <h2 className="poster-display text-3xl sm:text-4xl">
          <span className="poster-banner">Preguntas frecuentes</span>
        </h2>
        <p className="mt-4 max-w-sm text-xl leading-snug text-[var(--p-mute)]">
          Lo básico para arrancar. Si te queda algo sin responder, probá el chat de la demo.
        </p>
      </div>
      <div className="grid content-start gap-3">
        {FAQ_ITEMS.map((f, i) => (
          <Reveal key={f.q} delay={i * 50}>
            <details name="faq" className="poster-faq poster-frame group">
              <summary className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4 text-2xl font-bold">
                {f.q}
                <span aria-hidden className="poster-display shrink-0 text-3xl text-[var(--p-red)] transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="px-5 pb-5 text-xl leading-snug text-[var(--p-paper)]/90">{f.a}</p>
            </details>
          </Reveal>
        ))}
      </div>
      </div>
    </section>
  );
}
