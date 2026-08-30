import { UserPlus, Shield, Eye, Key, Mail } from 'lucide-react';

const steps = [
  {
    number: '01',
    title: 'Invitas con un link',
    description: 'En la tab Equipo de tu panel: nombre, correo y rol → te da un link (7 días, un solo uso). Lo mandas por WhatsApp.',
  },
  {
    number: '02',
    title: 'La persona se crea su acceso',
    description: 'Abre el link, elige su contraseña y llena su perfil: WhatsApp, puesto, horario y por dónde quiere que le avisen.',
  },
  {
    number: '03',
    title: 'Tú decides qué ve cada rol',
    description: 'Administrador ve todo. Equipo solo opera — y tú marcas qué secciones abre. Aplica al menú y a las URLs directas.',
  },
];

const prompts = [
  { name: 'Entregar el panel a un cliente', desc: 'Acceso Administrador para el jefe del negocio.', command: '/equipo' },
  { name: 'Dar acceso a mi equipo', desc: 'Empleados con rol Equipo; solo operan.', command: '/equipo' },
  { name: 'Decidir qué ve el equipo', desc: 'Solo la bandeja, solo clientes... tú eliges.', command: '/equipo' },
  { name: 'Recuperar un acceso', desc: 'Alguien olvidó su contraseña, o la maestra.', command: '/equipo' },
  { name: 'Configurar el correo del panel', desc: 'El correo desde donde salen las invitaciones.', command: '/equipo' },
];

export default function EquipoPage() {
  return (
    <div className="space-y-8">
      <p className="text-sm text-slate-400 max-w-2xl">
        Entrega el panel a tu cliente <strong className="text-white">sin darle tu contraseña</strong>.
        El jefe entra con su correo, invita a su gente y decide qué ven. Tú sigues entrando
        igual (admin + tu contraseña) y ves quién hizo qué.
      </p>

      <div>
        <p className="mono-label mb-2">CÓMO FUNCIONA</p>
        <h3 className="text-lg font-bold text-white mb-4">Una llave maestra, y llaves personales para cada quien</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {steps.map((step) => (
            <div key={step.number} className="card-accent relative">
              <span className="absolute top-4 right-4 text-2xl font-bold text-slate-700">{step.number}</span>
              <h4 className="font-semibold text-white mb-2">{step.title}</h4>
              <p className="text-sm text-slate-400">{step.description}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-4">
        <p className="text-xs text-slate-500 flex items-center gap-2">
          <Shield className="h-3.5 w-3.5" />
          Recuperar contraseña · Bitácora · Asignar conversaciones · Seguridad —
          «¿Olvidaste tu contraseña?» en el login (sin correo, el link te llega a ti como ticket).
          Bitácora de quién hizo qué. Asigna chats a personas y avísales solo en su horario.
          5 intentos fallidos → 15 min de bloqueo.
        </p>
      </div>

      <div>
        <p className="mono-label mb-2">HAZLO CON TU AGENTE</p>
        <h3 className="text-lg font-bold text-white mb-4">Copia el prompt y pégaselo a tu Claude</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {prompts.map((prompt) => (
            <div key={prompt.name} className="card-accent flex items-center gap-4 cursor-pointer hover:border-brand-500/50">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h4 className="text-sm font-medium text-white">{prompt.name}</h4>
                  <code className="text-[10px] font-mono text-slate-500 bg-surface px-1.5 py-0.5 rounded">{prompt.command}</code>
                </div>
                <p className="text-xs text-slate-400">{prompt.desc}</p>
              </div>
              <span className="text-slate-600">→</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
