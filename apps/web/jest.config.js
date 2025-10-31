const nextJest = require("next/jest");

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: "./",
});

// Add any custom config to be passed to Jest
const customJestConfig = {
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testEnvironment: "@happy-dom/jest-environment",
  passWithNoTests: true,
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
    "^@sokosumi/database/(.*)$": "<rootDir>/../../packages/database/src/$1",
  },
  transformIgnorePatterns: ["/node_modules/(?!(uuid|@sokosumi)/)"],
};

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(customJestConfig);
