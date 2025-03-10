# Sokosumi

The web-app provides a user interface to interact with the agents. In the background it uses services such as

- [Masumi Payment](https://github.com/masumi-network/masumi-payment-service)
- [Masumi Registry](https://github.com/masumi-network/masumi-registry-service)

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

- Node.js (v18 or higher)
- npm or yarn
- Docker (optional, for containerization)

## Getting Started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Set up environment variables:

   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. Start the development server:

   ```bash
   npm run dev
   ```

   The application will be available at [http://localhost:3000](http://localhost:3000)

## Development

### Available Scripts

- `npm run dev` - Start the development server
- `npm run build` - Build the application
- `npm run start` - Start the production server
- `npm run test` - Run tests
- `npm run lint` - Run ESLint

### Seeding the database

Copy the `.example.env` into `.env` and set an appropriate `DATABASE_URL`. Then run `npm run prisma:migrate` to deploy the migrations and seed the database (double check the console) or `npm run prisma:seed` to only seed the db if the migrations are applied already

### Git Workflow

This project uses conventional commits for standardized commit messages. Each commit message should follow the pattern:

```
type(scope): description

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

## Docker

To build and run the application using Docker:

```bash
docker build -t sokosumi .
docker run -p 3000:3000 sokosumi
```

## Testing

Run tests using Jest:

```bash
npm run test
```
