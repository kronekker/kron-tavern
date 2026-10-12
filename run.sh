#!/usr/bin/env bash

# ==============================================================================
# kron-tavern Development & Production Runner
# ==============================================================================

set -e

# Terminal colors
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# Determine script root directory
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

show_banner() {
  echo -e "${CYAN}${BOLD}"
  echo "  ██╗  ██╗██████╗  ██████╗ ███╗   ██╗      ████████╗ █████╗ ██╗   ██╗███████╗██████╗ ███╗   ██╗"
  echo "  ██║ ██╔╝██╔══██╗██╔═══██╗████╗  ██║      ╚══██╔══╝██╔══██╗██║   ██║██╔════╝██╔══██╗████╗  ██║"
  echo "  █████═╝ ██████╔╝██║   ██║██╔██╗ ██║  ███╗   ██║   ███████║██║   ██║█████╗  ██████╔╝██╔██╗ ██║"
  echo "  ██╔═██╗ ██╔══██╗██║   ██║██║╚██╗██║  ╚══╝   ██║   ██╔══██║╚██╗ ██╔╝██╔══╝  ██╔══██╗██║╚██╗██║"
  echo "  ██║ ╚██╗██║  ██║╚██████╔╝██║ ╚████║         ██║   ██║  ██║ ╚████╔╝ ███████╗██║  ██║██║ ╚████║"
  echo "  ╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝         ╚═╝   ╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝"
  echo -e "${NC}"
  echo -e "  ${BOLD}AI Companion & Roleplay Platform${NC} | Zero-Bloat, Full Transparency"
  echo -e "  --------------------------------------------------------------------------------"
  echo -e "  ${BLUE}● Backend Port:${NC}        http://localhost:3004"
  echo -e "  ${BLUE}● Swagger API Docs:${NC}    http://localhost:3004/api/docs"
  echo -e "  ${GREEN}● Frontend Dev Port:${NC}   http://localhost:4201  (proxies /api to 3004)"
  echo -e "  ${MAGENTA}● Unified Production:${NC}  http://localhost:3004  (serves SPA + API)"
  echo -e "  --------------------------------------------------------------------------------\n"
}

run_dev() {
  echo -e "\n${GREEN}${BOLD}🚀 Launching Full Development Environment (Backend + Frontend)...${NC}"
  echo -e "${YELLOW}Frontend will be live at http://localhost:4201 with dev proxy to :3004${NC}"
  echo -e "${YELLOW}Backend Swagger docs will be live at http://localhost:3004/api/docs${NC}\n"
  npm run dev
}

run_server() {
  echo -e "\n${BLUE}${BOLD}🚀 Launching Backend API in watch mode (Port 3004)...${NC}"
  echo -e "${YELLOW}API Docs at http://localhost:3004/api/docs${NC}\n"
  npm run dev:server
}

run_client() {
  echo -e "\n${GREEN}${BOLD}🚀 Launching Angular Frontend in dev mode (Port 4201)...${NC}"
  echo -e "${YELLOW}Local UI at http://localhost:4201${NC}\n"
  npm run dev:client
}

run_build() {
  echo -e "\n${MAGENTA}${BOLD}📦 Building Full Production Bundle (Client + Server)...${NC}\n"
  npm run build
  echo -e "\n${GREEN}${BOLD}✔ Production build complete!${NC}"
  echo -e "You can now run: ${BOLD}./run.sh start${NC} to launch the single-port production server.\n"
}

run_start() {
  if [ ! -d "client/dist/client/browser" ] || [ ! -d "server/dist" ]; then
    echo -e "${YELLOW}⚠️ Production build not found. Running build first...${NC}"
    run_build
  fi
  echo -e "\n${MAGENTA}${BOLD}🏰 Launching Unified Production Server on port 3004...${NC}"
  echo -e "${GREEN}Web App & API live on: http://localhost:3004${NC}\n"
  npm start
}

run_clean() {
  echo -e "\n${YELLOW}🧹 Cleaning build artifacts and caches...${NC}"
  npm run clean
  echo -e "${GREEN}✔ Clean complete.${NC}\n"
}

run_install() {
  echo -e "\n${CYAN}📥 Installing all workspace dependencies...${NC}\n"
  npm run install:all
  echo -e "\n${GREEN}✔ All packages installed successfully.${NC}\n"
}

show_menu() {
  echo -e "${BOLD}Select an action:${NC}"
  echo -e "  ${GREEN}1)${NC} ${BOLD}Full Dev Mode${NC}          (Start Backend :3004 & Frontend :4201 concurrently)"
  echo -e "  ${BLUE}2)${NC} ${BOLD}Backend Only${NC}           (Start NestJS on :3004 with Swagger)"
  echo -e "  ${CYAN}3)${NC} ${BOLD}Frontend Only${NC}          (Start Angular on :4201 with dev proxy)"
  echo -e "  ${MAGENTA}4)${NC} ${BOLD}Build All${NC}              (Compile Angular SPA + NestJS backend)"
  echo -e "  ${YELLOW}5)${NC} ${BOLD}Production Server${NC}      (Start single-port server on :3004)"
  echo -e "  ${BLUE}6)${NC} ${BOLD}Install Dependencies${NC}   (Run npm install across root, server, & client)"
  echo -e "  ${YELLOW}7)${NC} ${BOLD}Clean Build Cache${NC}      (Remove dist directories and build caches)"
  echo -e "  ${CYAN}q)${NC} Exit"
  echo ""
  read -rp "Enter choice [1-7 or q]: " choice

  case "$choice" in
    1) run_dev ;;
    2) run_server ;;
    3) run_client ;;
    4) run_build ;;
    5) run_start ;;
    6) run_install ;;
    7) run_clean ;;
    q|Q) echo -e "\nBye! 👋\n"; exit 0 ;;
    *) echo -e "\n${YELLOW}Invalid option. Please choose 1-7 or q.${NC}\n"; show_menu ;;
  esac
}

# Allow direct command line arguments (e.g. ./run.sh dev, ./run.sh build)
ACTION="${1:-}"

show_banner

case "$ACTION" in
  dev) run_dev ;;
  server) run_server ;;
  client) run_client ;;
  build) run_build ;;
  start|prod) run_start ;;
  clean) run_clean ;;
  install) run_install ;;
  help|--help|-h)
    echo "Usage: ./run.sh [dev|server|client|build|start|clean|install]"
    exit 0
    ;;
  "") show_menu ;;
  *)
    echo -e "${YELLOW}Unknown argument: $ACTION${NC}"
    echo "Usage: ./run.sh [dev|server|client|build|start|clean|install]"
    exit 1
    ;;
esac
