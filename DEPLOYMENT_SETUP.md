# 🚀 DotBot Deployment Setup Guide

This guide walks you through setting up the CI/CD pipeline for automatic deployment to staging and production.

## 📋 Prerequisites Checklist

- [ ] GitHub repository with the code
- [ ] Server with Ubuntu/Debian (for staging: `sandbox.dotbot.zelmacorp.io`)
- [ ] Server with Ubuntu/Debian (for production: `live.dotbot.zelmacorp.io`)
- [ ] Domain names pointing to your servers
- [ ] SSH access to both servers

## Step 1: Server Setup

### 1.1 Run Server Setup Script

On **both** your staging and production servers:

```bash
# Download and run the setup script
wget https://raw.githubusercontent.com/your-org/dotbot/main/scripts/setup-server.sh
chmod +x setup-server.sh
./setup-server.sh
```

This script will:
- Install Docker and Docker Compose
- Create application directory (`/opt/dotbot`)
- Configure firewall
- Set up systemd service

### 1.2 Configure Environment Variables

On **staging server**:
```bash
# Copy staging environment template
sudo cp /opt/dotbot/config/staging.env /opt/dotbot/.env

# Edit with your actual values
sudo nano /opt/dotbot/.env
```

On **production server**:
```bash
# Copy production environment template
sudo cp /opt/dotbot/config/production.env /opt/dotbot/.env

# Edit with your actual values
sudo nano /opt/dotbot/.env
```

**Required changes in `.env`:**
- `ACME_EMAIL=your-email@company.com`
- `ASI_ONE_API_KEY=your_actual_api_key`
- `POSTGRES_PASSWORD=secure_random_password`
- `SESSION_SECRET=long_random_string`

## Step 2: SSH Key Setup

### 2.1 Generate Deployment SSH Key

On your local machine:
```bash
# Generate SSH key pair for deployment
ssh-keygen -t ed25519 -f ~/.ssh/dotbot_deploy -C "dotbot-deployment"

# Copy public key to both servers
ssh-copy-id -i ~/.ssh/dotbot_deploy.pub user@your-staging-server
ssh-copy-id -i ~/.ssh/dotbot_deploy.pub user@your-production-server

# Get the private key content for GitHub secrets
cat ~/.ssh/dotbot_deploy
```

## Step 3: Configure GitHub Repository

### 3.1 Add Repository Secrets

Go to your GitHub repository → Settings → Secrets and variables → Actions

Add these secrets:

**Staging Secrets:**
```
STAGING_HOST=your.staging.server.ip
STAGING_USER=your-username
STAGING_SSH_KEY=-----BEGIN OPENSSH PRIVATE KEY-----
(paste the private key content from step 2.1)
-----END OPENSSH PRIVATE KEY-----
```

**Production Secrets:**
```
PRODUCTION_HOST=your.production.server.ip
PRODUCTION_USER=your-username
PRODUCTION_SSH_KEY=-----BEGIN OPENSSH PRIVATE KEY-----
(paste the private key content from step 2.1)
-----END OPENSSH PRIVATE KEY-----
```

**Optional Notification Secrets:**
```
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
```

### 3.2 Enable GitHub Container Registry

In your GitHub repository:
1. Go to Settings → Actions → General
2. Under "Workflow permissions", select "Read and write permissions"
3. Check "Allow GitHub Actions to create and approve pull requests"

## Step 4: DNS Configuration

### 4.1 Create DNS Records

In your domain provider's DNS settings:

**For staging:**
```
Type: A
Name: sandbox.dotbot.zelmacorp.io
Value: YOUR_STAGING_SERVER_IP
TTL: 300
```

**For production:**
```
Type: A
Name: live.dotbot.zelmacorp.io
Value: YOUR_PRODUCTION_SERVER_IP
TTL: 300
```

**For Traefik dashboard (optional):**
```
Type: A
Name: traefik.sandbox.dotbot.zelmacorp.io
Value: YOUR_STAGING_SERVER_IP

Type: A
Name: traefik.live.dotbot.zelmacorp.io
Value: YOUR_PRODUCTION_SERVER_IP
```

### 4.2 Verify DNS Propagation

```bash
# Check if DNS is working
nslookup sandbox.dotbot.zelmacorp.io
nslookup live.dotbot.zelmacorp.io
```

## Step 5: Test the Pipeline

### 5.1 Create and Push Staging Branch

```bash
# Create staging branch from main
git checkout main
git pull origin main
git checkout -b staging
git push origin staging
```

### 5.2 Test Deployment

1. Make a small change to trigger deployment:
```bash
echo "# Test deployment" >> README.md
git add README.md
git commit -m "test: trigger staging deployment"
git push origin staging
```

2. Watch the GitHub Actions workflow:
   - Go to your repository → Actions tab
   - You should see "Deploy to Staging" workflow running

3. Verify deployment:
   - Wait for workflow to complete (5-10 minutes)
   - Visit `https://sandbox.dotbot.zelmacorp.io`
   - Check `https://sandbox.dotbot.zelmacorp.io/api/health`

## Step 6: Production Deployment

Once staging is working:

```bash
# Merge staging to main for production deployment
git checkout main
git merge staging
git push origin main
```

This will trigger production deployment to `https://live.dotbot.zelmacorp.io`

## 🔧 Troubleshooting

### Common Issues

**1. SSH Connection Failed**
```bash
# Test SSH connection manually
ssh -i ~/.ssh/dotbot_deploy user@your-server

# Check SSH key format (should be OpenSSH, not PEM)
ssh-keygen -p -m OpenSSH -f ~/.ssh/dotbot_deploy
```

**2. Docker Permission Denied**
```bash
# On server, add user to docker group
sudo usermod -aG docker $USER
# Log out and log back in
```

**3. DNS Not Resolving**
```bash
# Wait for DNS propagation (can take up to 48 hours)
# Use online DNS checker tools
```

**4. SSL Certificate Issues**
```bash
# Check Traefik logs on server
cd /opt/dotbot
docker-compose logs traefik
```

### Useful Commands

**Check deployment status:**
```bash
# On server
cd /opt/dotbot
docker-compose ps
docker-compose logs -f
```

**Manual deployment:**
```bash
# On server, if you need to deploy manually
cd /opt/dotbot
docker-compose pull
docker-compose up -d
```

**View application logs:**
```bash
# On server
cd /opt/dotbot
docker-compose logs frontend
docker-compose logs backend
```

## 🎉 Success Criteria

✅ Staging deployment works: `https://sandbox.dotbot.zelmacorp.io`
✅ Production deployment works: `https://live.dotbot.zelmacorp.io`
✅ SSL certificates are automatically generated
✅ Health checks pass
✅ GitHub Actions workflows complete successfully

## Next Steps After Setup

1. Set up monitoring and alerting
2. Configure backup strategies
3. Set up log aggregation
4. Implement blue-green deployments (optional)
5. Add integration tests to the pipeline

---

**Need Help?** Check the troubleshooting section or review the GitHub Actions logs for detailed error messages.
