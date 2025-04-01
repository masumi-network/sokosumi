# DigitalOcean Function - API Caller

This is a TypeScript-based DigitalOcean Function that makes HTTP requests to trigger registry syncs.

If you do not use DigitalOcean, you can deploy on other functions platforms, with possibly slight adaptations.

## Prerequisites

- Node.js 18 or later
- DigitalOcean CLI (`doctl`) installed
- DigitalOcean account with Functions enabled

## Setup

1. Install dependencies:

```bash
npm install
```

2. Build the TypeScript code:

```bash
npm run build
```

3. Set up your environment variables in the DigitalOcean dashboard:
   - `API_URL`: The URL of the API endpoint to call

## Deployment

Deploy the function using the DigitalOcean CLI:

```bash
npm run deploy
```
