# 🚀 DotBot DevOps Guide

This comprehensive guide covers everything you need for DotBot DevOps: CI/CD pipelines, deployment automation, infrastructure management, and troubleshooting.

## 📁 DevOps File Structure

```
.github/workflows/          # GitHub Actions workflows
├── staging-deploy.yml      # Staging deployment (staging branch)
└── production-deploy.yml   # Production deployment (master branch)

config/                     # Environment configurations
├── staging.env            # Staging environment variables
├── production.env         # Production environment variables
└── env.example           # Template for local development

scripts/                   # Deployment and setup scripts
├── setup-server.sh       # Server setup automation
└── setup-deploy-user.sh  # Deploy user configuration

docker-compose.staging.yml  # Staging deployment (ports 3010/3011)
docker-compose.production.yml # Production deployment (ports 3020/3021)
backend/Dockerfile        # Backend container definition
frontend/Dockerfile       # Frontend container definition
```

## 🔄 CI/CD Pipeline

### Staging Deployment
- **Trigger**: Push to `staging` branch
- **Process**: Test → Build → Deploy to staging server
- **URL**: `http://[staging-server]:3010`

### Production Deployment
- **Trigger**: Push to `master` branch
- **Process**: Test → Security Scan → Build → Deploy to production server
- **URL**: `https://live.dotbot.zelmacorp.io`

## 🐳 Docker Configurations

### docker-compose.staging.yml
- Staging deployment with ports 3010/3011
- Direct port exposure for external Nginx reverse proxy
- Includes health checks and build configurations

### docker-compose.production.yml
- Production deployment with isolated ports (3020/3021)
- Avoids conflicts with staging environment
- Designed for use with external Nginx reverse proxy
- Production-optimized configurations

## 🛠️ Setup Instructions

### 1. Server Setup
Run on both staging and production servers:
```bash
wget https://raw.githubusercontent.com/your-org/dotbot/main/scripts/setup-server.sh
chmod +x setup-server.sh
./setup-server.sh
```

**Deployment Isolation:** Both environments use `/opt/dotbot` but run as separate containers:
- **Staging:** Uses `docker-compose.yml` with default container names (ports 3010/3011)
- **Production:** Uses `docker-compose.production.yml` with unique container names (ports 3020/3021)

### 2. Nginx Setup (Manual Configuration)
The project uses an external Nginx reverse proxy that you configure manually:

#### For Production (live.dotbot.zelmacorp.io):
- Frontend: proxies to `127.0.0.1:3020`
- Backend: proxies to `127.0.0.1:3021`

#### For Staging (sandbox.dotbot.zelmacorp.io):
- Frontend: proxies to `127.0.0.1:3010`  
- Backend: proxies to `127.0.0.1:3011`

Install Nginx and Certbot manually, then configure your server blocks to proxy to the appropriate ports.

### 3. GitHub Secrets Configuration
Add these secrets to your GitHub repository:

#### Staging Secrets
- `STAGING_HOST`: Server hostname/IP
- `STAGING_USER`: SSH username
- `STAGING_SSH_KEY`: SSH private key
- `STAGING_PORT`: SSH port (optional, defaults to 22)

#### Production Secrets
- `PRODUCTION_HOST`: Server hostname/IP
- `PRODUCTION_USER`: SSH username
- `PRODUCTION_SSH_KEY`: SSH private key
- `PRODUCTION_PORT`: SSH port (optional, defaults to 22)

#### Application Secrets
- `ASI_ONE_API_KEY`: API key for ASI One service
- `ASI_ONE_ENDPOINT`: API endpoint URL
- `SLACK_WEBHOOK_URL`: Slack notifications (optional)

### 4. Environment Configuration
Update the config files with your specific values:
- `config/staging.env`: Staging environment variables
- `config/production.env`: Production environment variables

## 🔌 Port Allocation

### Staging Environment
- Frontend: `3010` → Nginx proxy
- Backend: `3011` → Nginx proxy

### Production Environment  
- Frontend: `3020` → Nginx proxy
- Backend: `3021` → Nginx proxy

This separation prevents port conflicts when running both environments on the same server or network.

## 📊 Monitoring & Health Checks

### Health Endpoints

#### Staging
- Frontend: `http://localhost:3010/health`
- Backend: `http://localhost:3011/api/health`
- Via Nginx: `https://sandbox.dotbot.zelmacorp.io/health`

#### Production  
- Frontend: `http://localhost:3020/health`
- Backend: `http://localhost:3021/api/health`
- Via Nginx: `https://live.dotbot.zelmacorp.io/health`

### Container Health Checks
Both Docker containers include built-in health checks that automatically restart unhealthy containers.

### Container Management
```bash
# View all containers
docker ps -a

# Staging containers (default names)
docker logs dotbot_frontend_1
docker logs dotbot_backend_1

# Production containers (explicit names)
docker logs dotbot-production-frontend
docker logs dotbot-production-backend

# Stop/start specific environment
docker-compose down                                    # Staging
docker-compose -f docker-compose.production.yml down  # Production

docker-compose up -d                                          # Staging
docker-compose -f docker-compose.production.yml up -d        # Production
```

## 🔧 Troubleshooting

### Common Issues

1. **Port Already in Use**
   - Staging: Kill processes using ports 3010/3011
     - `sudo lsof -ti:3010 | xargs sudo kill -9`
     - `sudo lsof -ti:3011 | xargs sudo kill -9`
   - Production: Kill processes using ports 3020/3021
     - `sudo lsof -ti:3020 | xargs sudo kill -9`
     - `sudo lsof -ti:3021 | xargs sudo kill -9`

2. **Container Build Failures**
   - Check logs: `docker logs [container-name]`
   - Rebuild: `docker-compose up -d --build --force-recreate`

3. **SSL Certificate Issues**
   - Ensure domain points to server
   - Check Traefik logs: `docker logs dotbot-traefik-1`

### Log Access
```bash
# View all container logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f backend
docker-compose logs -f frontend
```

## 🔒 Security

- All containers run as non-root users
- Security scanning in production pipeline
- Automatic SSL certificates
- Environment variables for sensitive data
- Regular image cleanup to prevent disk space issues

## 🚀 Deployment Process

1. **Development**: Work on feature branches
2. **Staging**: Merge to `staging` branch → auto-deploy to staging
3. **Production**: Merge to `master` branch → auto-deploy to production

The CI/CD pipeline ensures all tests pass and security scans complete before deployment.
