#!/bin/bash
# Server Setup Script for DotBot Staging Environment

set -e

echo "🚀 Setting up DotBot staging environment..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [[ $EUID -eq 0 ]]; then
   echo -e "${RED}❌ This script should not be run as root${NC}"
   exit 1
fi

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Install Docker if not present
install_docker() {
    echo -e "${YELLOW}📦 Installing Docker...${NC}"
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
    echo -e "${GREEN}✅ Docker installed${NC}"
}

# Install Docker Compose if not present
install_docker_compose() {
    echo -e "${YELLOW}📦 Installing Docker Compose...${NC}"
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
    echo -e "${GREEN}✅ Docker Compose installed${NC}"
}

# Check system requirements
echo -e "${YELLOW}🔍 Checking system requirements...${NC}"

# Check Docker
if ! command_exists docker; then
    install_docker
    echo -e "${YELLOW}⚠️  Please log out and log back in to apply Docker group changes${NC}"
    echo -e "${YELLOW}   Then run this script again${NC}"
    exit 1
else
    echo -e "${GREEN}✅ Docker is installed${NC}"
fi

# Check Docker Compose
if ! command_exists docker-compose; then
    install_docker_compose
else
    echo -e "${GREEN}✅ Docker Compose is installed${NC}"
fi

# Check if user is in docker group
if ! groups $USER | grep -q docker; then
    echo -e "${RED}❌ User is not in docker group${NC}"
    echo -e "${YELLOW}   Run: sudo usermod -aG docker $USER${NC}"
    echo -e "${YELLOW}   Then log out and log back in${NC}"
    exit 1
fi

# Create application directory
APP_DIR="/opt/dotbot"
echo -e "${YELLOW}📁 Creating application directory: $APP_DIR${NC}"
sudo mkdir -p $APP_DIR
sudo chown $USER:$USER $APP_DIR

# Create logs directory
sudo mkdir -p $APP_DIR/logs
sudo chown $USER:$USER $APP_DIR/logs

# Clone repository or copy files
echo -e "${YELLOW}📥 Setting up application files...${NC}"
if [ ! -d "$APP_DIR/.git" ]; then
    echo -e "${YELLOW}   Please copy your project files to $APP_DIR${NC}"
    echo -e "${YELLOW}   Or clone the repository:${NC}"
    echo -e "${YELLOW}   git clone <your-repo> $APP_DIR${NC}"
fi

# Setup environment file
echo -e "${YELLOW}⚙️  Setting up environment configuration...${NC}"
if [ ! -f "$APP_DIR/.env" ]; then
    if [ -f "$APP_DIR/config/staging.env" ]; then
        cp "$APP_DIR/config/staging.env" "$APP_DIR/.env"
        echo -e "${GREEN}✅ Environment file created from staging template${NC}"
        echo -e "${YELLOW}⚠️  Please edit $APP_DIR/.env with your actual values${NC}"
    else
        echo -e "${RED}❌ No environment template found${NC}"
        echo -e "${YELLOW}   Please create $APP_DIR/.env manually${NC}"
    fi
fi

# Setup firewall rules
echo -e "${YELLOW}🔥 Configuring firewall...${NC}"
if command_exists ufw; then
    sudo ufw allow 22/tcp     # SSH
    sudo ufw allow 80/tcp     # HTTP
    sudo ufw allow 443/tcp    # HTTPS
    sudo ufw allow 8080/tcp   # Traefik dashboard
    sudo ufw --force enable
    echo -e "${GREEN}✅ Firewall configured${NC}"
else
    echo -e "${YELLOW}⚠️  UFW not found, please configure firewall manually${NC}"
fi

# Create systemd service for auto-start
echo -e "${YELLOW}🔧 Creating systemd service...${NC}"
sudo tee /etc/systemd/system/dotbot.service > /dev/null <<EOF
[Unit]
Description=DotBot Application
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$APP_DIR
ExecStart=/usr/local/bin/docker-compose up -d
ExecStop=/usr/local/bin/docker-compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable dotbot.service
echo -e "${GREEN}✅ Systemd service created${NC}"

# Final instructions
echo -e "${GREEN}🎉 Server setup complete!${NC}"
echo -e "${YELLOW}📋 Next steps:${NC}"
echo "1. Edit $APP_DIR/.env with your actual configuration"
echo "2. Ensure DNS records point to this server:"
echo "   - sandbox.dotbot.zelmacorp.io -> $(curl -s ifconfig.me)"
echo "3. Start the application:"
echo "   cd $APP_DIR && docker-compose up -d"
echo "4. Check logs:"
echo "   docker-compose logs -f"
echo "5. Access your application:"
echo "   https://sandbox.dotbot.zelmacorp.io"
echo "   https://sandbox.dotbot.zelmacorp.io/api/health"
echo "   https://traefik.sandbox.dotbot.zelmacorp.io (Traefik dashboard)"

echo -e "${GREEN}✅ Setup script completed successfully!${NC}"
