#!/bin/bash
# Setup dedicated deployment user for DotBot CI/CD

set -e

echo "🔐 Setting up GitHub deployment user for DotBot CI/CD..."

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
DEPLOY_USER="github-deployer"
DEPLOY_HOME="/home/${DEPLOY_USER}"
APP_DIR="/opt/dotbot"

# Check if running as root or with sudo
if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}❌ This script must be run as root or with sudo${NC}"
   exit 1
fi

echo -e "${YELLOW}📋 Creating deployment user: ${DEPLOY_USER}${NC}"

# Create deployment user
if id "$DEPLOY_USER" &>/dev/null; then
    echo -e "${YELLOW}⚠️  User ${DEPLOY_USER} already exists${NC}"
else
    useradd -m -s /bin/bash "$DEPLOY_USER"
    echo -e "${GREEN}✅ User ${DEPLOY_USER} created${NC}"
fi

# Create SSH directory
mkdir -p "${DEPLOY_HOME}/.ssh"
chmod 700 "${DEPLOY_HOME}/.ssh"
chown "${DEPLOY_USER}:${DEPLOY_USER}" "${DEPLOY_HOME}/.ssh"

# Generate SSH key pair
echo -e "${YELLOW}🔑 Generating SSH key pair...${NC}"
su - "$DEPLOY_USER" -c "ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N '' -C 'github-deployer'"

# Set proper permissions
chmod 600 "${DEPLOY_HOME}/.ssh/id_ed25519"
chmod 644 "${DEPLOY_HOME}/.ssh/id_ed25519.pub"
chown "${DEPLOY_USER}:${DEPLOY_USER}" "${DEPLOY_HOME}/.ssh/id_ed25519"*

# Add public key to authorized_keys
cp "${DEPLOY_HOME}/.ssh/id_ed25519.pub" "${DEPLOY_HOME}/.ssh/authorized_keys"
chmod 600 "${DEPLOY_HOME}/.ssh/authorized_keys"
chown "${DEPLOY_USER}:${DEPLOY_USER}" "${DEPLOY_HOME}/.ssh/authorized_keys"

# Add user to docker group
usermod -aG docker "$DEPLOY_USER"

# Give deployment user access to application directory
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "$APP_DIR"

# Create sudoers rule for specific commands only
cat > "/etc/sudoers.d/${DEPLOY_USER}" << EOF
# Allow deployment user to restart specific services
${DEPLOY_USER} ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart dotbot.service
${DEPLOY_USER} ALL=(ALL) NOPASSWD: /usr/bin/systemctl reload nginx
${DEPLOY_USER} ALL=(ALL) NOPASSWD: /usr/bin/systemctl reload apache2
${DEPLOY_USER} ALL=(ALL) NOPASSWD: /usr/local/bin/docker-compose
${DEPLOY_USER} ALL=(ALL) NOPASSWD: /usr/bin/docker-compose
EOF

echo -e "${GREEN}✅ Deployment user setup complete!${NC}"
echo ""
echo -e "${YELLOW}📋 Next steps:${NC}"
echo "1. Copy the PRIVATE key for GitHub secrets:"
echo -e "${YELLOW}   sudo cat ${DEPLOY_HOME}/.ssh/id_ed25519${NC}"
echo ""
echo "2. Test SSH connection:"
echo -e "${YELLOW}   ssh ${DEPLOY_USER}@localhost${NC}"
echo ""
echo "3. Add GitHub secrets:"
echo "   STAGING_HOST = your-server-ip"
echo "   STAGING_USER = github-deployer"
echo "   STAGING_SSH_KEY = (private key content from step 1)"
echo ""
echo -e "${GREEN}🔐 Security features enabled:${NC}"
echo "   ✅ Dedicated user with limited permissions"
echo "   ✅ Docker group access for container management"
echo "   ✅ Sudo access only for specific deployment commands"
echo "   ✅ SSH key-based authentication"
echo "   ✅ Application directory ownership"
