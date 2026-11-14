const ITEMS = ['Restaurante', 'Barbería', 'Farmacia', 'Gimnasio', 'Tienda', 'Taller', 'Spa', 'Dentista', 'Industria'];

/** Cinta animada de rubros. Se frena con el mouse/foco y queda quieta con prefers-reduced-motion. */
export default function Marquee() {
  const row = (hidden: boolean) => (
    <ul className="poster-marquee-row flex shrink-0 items-center" aria-hidden={hidden || undefined}>
      {ITEMS.map((t) => (
        <li key={t} className="poster-display flex items-center whitespace-nowrap px-6 text-2xl sm:text-3xl">
          {t}
          <span aria-hidden className="ml-12 text-[var(--p-red)]">
            ★
          </span>
        </li>
      ))}
    </ul>
  );
  return (
    <div className="poster-marquee overflow-hidden border-b-2 border-[var(--p-red)] bg-[var(--p-paper)] py-2 text-[var(--p-ink)]" role="region" aria-label="Rubros con robots asistentes">
      <div className="poster-marquee-track flex w-max">
        {row(false)}
        {row(true)}
      </div>
    </div>
  );
}
