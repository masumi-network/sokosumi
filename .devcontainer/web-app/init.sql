-- Initialize PostgreSQL for Sokosumi Web App
-- This file is automatically executed when the database container starts

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "citext";

-- Create additional indexes or configuration if needed
-- (Prisma will handle the main schema via migrations)

-- Set timezone
SET timezone = 'UTC';

-- Log successful initialization
SELECT 'Sokosumi database initialized successfully' AS status; 