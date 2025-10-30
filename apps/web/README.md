# Sokosumi Web App

The web-app provides a user interface to interact with the agents. In the background it uses services such as:

- [Masumi Payment](https://github.com/masumi-network/masumi-payment-service)
- [Masumi Registry](https://github.com/masumi-network/masumi-registry-service)

## Monorepo Structure

This project is part of the Sokosumi monorepo. The main packages are:

- `apps/web` — This Next.js web application

Install dependencies from the root of the monorepo:

```bash
pnpm install
```

## Project Structure

```
web-app/
├── prisma/            # Prisma as ORM
├── src/               # Main Code folder
    |── app            # App router
    |── lib            # Libraries and business logic
└── package.json       # Package configuration
```

## Features

- **Next.js Web Application**: Modern, server-side rendered React application
- **TypeScript**: Type-safe development environment
- **Prisma**: Database ORM for type-safe database queries
- **TailwindCSS**: Utility-first CSS framework
- **Jest**: Testing framework
- **ESLint**: Code linting
- **Husky**: Git hooks for code quality
- **Docker**: Containerization support
- **Conventional Commits**: Standardized commit messages

## Prerequisites

- [Node.js](https://nodejs.org/en) (v20 or higher)
- [pnpm](https://pnpm.io/)

## URLs

- **Preprod**: [https://preprod.sokosumi.com/](https://preprod.sokosumi.com/)
- **Mainnet**: [https://app.sokosumi.com/](https://app.sokosumi.com)

## Getting Started

1. Install dependencies (from the monorepo root):

   ```bash
   pnpm install
   ```

2. Set up environment variables:

   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. Start the development server:

   ```bash
   pnpm dev
   ```

   The application will be available at [http://localhost:3000](http://localhost:3000)

## Development

### Available Scripts

- `pnpm dev` - Start the development server
- `pnpm build` - Build the application
- `pnpm start` - Start the production server
- `pnpm test` - Run tests
- `pnpm lint` - Run ESLint

## Testing

Run tests using Jest:

```bash
pnpm test
```

### Seeding the database

Copy the `.env.example` into `.env` and set an appropriate `DATABASE_URL`. Then run `pnpm prisma:migrate:dev` to deploy the migrations and seed the database (double check the console) or `pnpm prisma:seed` to only seed the db if the migrations are applied already.

## Related Packages

- See `../sync-function/README.md` for information about backend sync/worker functions.
