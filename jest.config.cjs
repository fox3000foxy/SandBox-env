/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.spec.ts'], // Match only .ts files
  clearMocks: true,
  restoreMocks: true,
  maxWorkers: 1,
  slowTestThreshold: 15,
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }], // Simplified transform
  },
  extensionsToTreatAsEsm: ['.ts'], // Removed .mts
};
