#!/usr/bin/env bash
#
# scripts/setup.sh
#
# Script de configuracion inicial para el monorepo "Local B".
# Verifica prerequisitos, instala dependencias, prepara los archivos .env
# y genera el cliente de Prisma. Pensado para correr una sola vez al
# clonar el repositorio (o luego de cambios grandes en dependencias).
#
# Uso:
#   chmod +x scripts/setup.sh
#   ./scripts/setup.sh

set -euo pipefail

# Colores para los mensajes de la terminal.
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # sin color

info()    { echo -e "${BLUE}[setup]${NC} $1"; }
success() { echo -e "${GREEN}[ok]${NC}   $1"; }
warn()    { echo -e "${YELLOW}[warn]${NC} $1"; }
error()   { echo -e "${RED}[error]${NC} $1"; }

# Se posiciona en la raiz del repo sin importar desde donde se invoque el script.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

echo ""
echo "=========================================="
echo "  Local B — Setup del entorno de desarrollo"
echo "=========================================="
echo ""

# ---------------------------------------------------------------------------
# 1. Verificar que Node.js este instalado y con una version soportada (>=20)
# ---------------------------------------------------------------------------
info "Verificando Node.js..."
if ! command -v node >/dev/null 2>&1; then
  error "Node.js no esta instalado. Instala Node.js 20+ desde https://nodejs.org"
  exit 1
fi

NODE_VERSION="$(node -v | sed 's/v//')"
NODE_MAJOR="${NODE_VERSION%%.*}"
if [ "$NODE_MAJOR" -lt 20 ]; then
  warn "Se detecto Node.js v$NODE_VERSION. Se recomienda Node.js 20 o superior."
else
  success "Node.js v$NODE_VERSION detectado."
fi

# ---------------------------------------------------------------------------
# 2. Verificar que npm este instalado
# ---------------------------------------------------------------------------
info "Verificando npm..."
if ! command -v npm >/dev/null 2>&1; then
  error "npm no esta instalado. Viene incluido con Node.js: https://nodejs.org"
  exit 1
fi
success "npm $(npm -v) detectado."

# ---------------------------------------------------------------------------
# 3. Instalar dependencias del monorepo (workspaces: apps/*, packages/*)
# ---------------------------------------------------------------------------
info "Instalando dependencias (npm ci)..."
if [ -f "package-lock.json" ]; then
  npm ci
else
  warn "No se encontro package-lock.json, usando npm install en su lugar."
  npm install
fi
success "Dependencias instaladas."

# ---------------------------------------------------------------------------
# 4. Copiar archivos .env.example a .env si no existen (no sobrescribe)
# ---------------------------------------------------------------------------
info "Preparando archivos de entorno (.env)..."

copy_env_if_missing() {
  local example_file="$1"
  local target_file="$2"
  if [ ! -f "$example_file" ]; then
    warn "No existe $example_file, se omite."
    return
  fi
  if [ -f "$target_file" ]; then
    warn "$target_file ya existe, no se sobrescribe."
  else
    cp "$example_file" "$target_file"
    success "Creado $target_file a partir de $example_file."
  fi
}

copy_env_if_missing "$ROOT_DIR/.env.example" "$ROOT_DIR/.env"
copy_env_if_missing "$ROOT_DIR/apps/web/.env.example" "$ROOT_DIR/apps/web/.env"
copy_env_if_missing "$ROOT_DIR/apps/server/.env.example" "$ROOT_DIR/apps/server/.env"

# ---------------------------------------------------------------------------
# 5. Generar el cliente de Prisma
# ---------------------------------------------------------------------------
info "Generando Prisma Client..."
npm run db:generate
success "Prisma Client generado."

# ---------------------------------------------------------------------------
# 6. Proximos pasos
# ---------------------------------------------------------------------------
echo ""
echo "=========================================="
success "Setup completado."
echo "=========================================="
echo ""
echo "Proximos pasos:"
echo ""
echo "  1. Completa las variables reales en los archivos .env generados:"
echo "       - .env"
echo "       - apps/web/.env"
echo "       - apps/server/.env"
echo ""
echo "  2. Levanta Postgres y Redis (via Docker) si no los tenes corriendo:"
echo "       docker compose up -d postgres redis"
echo ""
echo "  3. Sincroniza el esquema de la base de datos:"
echo "       npm run db:push"
echo ""
echo "  4. (Opcional) Carga datos de prueba:"
echo "       npm run db:seed"
echo ""
echo "  5. Inicia el entorno de desarrollo (web + server en paralelo):"
echo "       npm run dev"
echo ""
echo "  6. O levanta todo el stack con Docker Compose:"
echo "       docker compose up --build"
echo ""
