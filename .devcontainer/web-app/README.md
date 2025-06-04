# Sokosumi Web App Development Container

A fully configured development environment for the Sokosumi Web App using VS Code Dev Containers. This container provides everything you need to start contributing to the project immediately.

## 🚀 Quick Start

### Prerequisites

- [Docker](https://www.docker.com/get-started) installed and running
- [VS Code](https://code.visualstudio.com/) with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

### Getting Started

1. **Clone the repository** (if you haven't already):
   ```bash
   git clone <repository-url>
   cd sokosumi
   ```

2. **Set up environment variables** in your local environment:
   ```bash
   # Required environment variables (add to your shell profile)
   export ADMIN_KEY="your-admin-key"
   export REGISTRY_API_KEY="your-registry-api-key"
   export PAYMENT_API_KEY="your-payment-api-key"
   export BETTER_AUTH_SECRET="your-auth-secret"
   export RESEND_API_KEY="your-resend-api-key"
   export STRIPE_SECRET_KEY="your-stripe-secret"
   export STRIPE_PUBLISHABLE_KEY="your-stripe-publishable-key"
   export STRIPE_WEBHOOK_SECRET="your-stripe-webhook-secret"
   export STRIPE_PRICE_ID="your-stripe-price-id"
   export STRIPE_WELCOME_COUPON="your-stripe-coupon"
   
   # Database configuration (REQUIRED)
   export DATABASE_URL="postgresql://username:password@localhost:5432/sokosumi_dev"
   ```

3. **Set up PostgreSQL Database**:
   The devcontainer expects a PostgreSQL database to be available. You have several options:
   
   **Option A: Local PostgreSQL Installation**
   ```bash
   # Install PostgreSQL locally (if not already installed)
   # macOS with Homebrew:
   brew install postgresql
   brew services start postgresql
   
   # Create database
   createdb sokosumi_dev
   ```
   
   **Option B: Docker PostgreSQL**
   ```bash
   # Run PostgreSQL in a separate container
   docker run --name sokosumi-postgres \
     -e POSTGRES_DB=sokosumi_dev \
     -e POSTGRES_USER=username \
     -e POSTGRES_PASSWORD=password \
     -p 5432:5432 \
     -d postgres:15
   ```
   
   **Option C: Cloud Database**
   Use a cloud PostgreSQL service (AWS RDS, Google Cloud SQL, etc.) and update your `DATABASE_URL` accordingly.

4. **Open in Dev Container**:
   - Open VS Code in the project root
   - Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
   - Type "Dev Containers: Reopen in Container"
   - Select "Sokosumi Web App Development"

5. **Wait for setup** - The container will automatically:
   - Pull the Node.js 22 base image
   - Install all required tools and extensions
   - Run `pnpm install` to install dependencies

## 🛠 What's Included

### Runtime Environment
- **Node.js 22** - Latest LTS version
- **pnpm** - Fast, disk space efficient package manager
- **Zsh with Oh My Zsh** - Enhanced shell experience

### Development Tools
- **Git** - Version control
- **GitHub CLI** - Command-line interface for GitHub
- **PostgreSQL Client** - Database interaction tools

### VS Code Extensions
- **Tailwind CSS IntelliSense** - CSS framework support
- **Prettier** - Code formatting
- **ESLint** - Code linting and quality
- **Code Spell Checker** - Spell checking for code
- **Prisma** - Database ORM support
- **i18n Ally** - Internationalization support

### Pre-configured Ports
- **3000** - Next.js Development Server
- **5555** - Prisma Studio

> **Note**: PostgreSQL (port 5432) is expected to be running externally as configured in your `DATABASE_URL`

## 🔧 Configuration Details

### Environment Variables

The container automatically loads environment variables from two sources:

1. **Local Environment Variables** (from your host machine):
   - API keys and secrets for external services
   - Authentication tokens
   - Stripe configuration
   - **DATABASE_URL** - PostgreSQL connection string (required)

2. **Container Environment File** (`.devcontainer/web-app/env.container`):
   - Application configuration
   - Development settings
   - Database seeding options

### VS Code Settings

The container comes pre-configured with:
- **Format on Save** enabled with Prettier
- **Auto-fix on Save** for ESLint
- **Tab Size** set to 2 spaces
- **Word Wrap** enabled
- **Tailwind CSS** file associations
- **i18n** locale paths configured

## 🚀 Development Workflow

### Starting the Application

Once the container is running:

```bash
# The dependencies are already installed via postCreateCommand
# Start the development server
pnpm dev
```

The application will be available at `http://localhost:3000`

### Database Operations

```bash
# Run Prisma migrations
pnpm prisma migrate dev

# Open Prisma Studio (available at http://localhost:5555)
pnpm prisma studio

# Seed the database
pnpm prisma db seed
```

### Code Quality

```bash
# Lint code
pnpm lint

# Format code
pnpm format

# Type checking
pnpm type-check
```

## 🗃 Database Configuration

The development environment expects:
- **PostgreSQL** accessible via your `DATABASE_URL` environment variable
- **Prisma Studio** for database management on port 5555
- **Auto-seeding** with developer account:
  - Email: `developer@sokosumi.com`
  - Password: `developer`

> **Important**: Ensure your PostgreSQL database is running and accessible before starting the development server. The container does not include PostgreSQL - you must set it up externally.

## 🌐 API Endpoints

The container is configured to work with:
- **Registry API**: `https://registry.masumi.network/api/v1`
- **Payment API**: `https://payment.masumi.network/api/v1`
- **BetterAuth URL**: `http://localhost:3000`

## 🔒 Security Notes

- Environment variables are loaded from your local machine
- Sensitive data is not stored in the container image
- The container runs as the `node` user for security
- Agent hostnames are blacklisted to prevent CSRF attacks

## 🐛 Troubleshooting

### Common Issues

1. **Port conflicts**: Ensure ports 3000 and 5555 are available
2. **Environment variables not loaded**: Check your shell profile and restart VS Code
3. **Database connection issues**: 
   - Verify PostgreSQL is running and accessible
   - Check your `DATABASE_URL` environment variable
   - Ensure the database specified in `DATABASE_URL` exists
4. **Extension not working**: Reload the window (`Ctrl+Shift+P` → "Developer: Reload Window")
5. **Prisma connection errors**: Run `pnpm prisma migrate dev` to ensure database schema is up to date

### Logs and Debugging

```bash
# Check container logs
docker logs <container-name>

# Restart the dev container
# Use Command Palette: "Dev Containers: Rebuild Container"
```

## 📝 Contributing

When working in this development container:

1. **Code Style**: Prettier and ESLint are configured and will auto-format/fix on save
2. **Commits**: Use [Conventional Commits](https://www.conventionalcommits.org/) format
3. **Internationalization**: Use the i18n Ally extension for managing translations
4. **Database Changes**: Always create Prisma migrations for schema changes

## 🆘 Getting Help

- Check the main project README for overall project documentation
- Review Prisma documentation for database operations
- Consult Next.js documentation for framework-specific questions
- Use the integrated terminal for running commands and debugging

---

**Note**: This development container is specifically configured for the Sokosumi Web App. For other parts of the project (like the sync function), use the appropriate devcontainer configuration. 