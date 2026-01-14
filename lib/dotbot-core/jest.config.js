module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: [
    '**/tests/**/*.test.ts',
    '**/__tests__/**/*.test.ts'
  ],
  collectCoverageFrom: [
    '**/*.ts',
    '!**/*.d.ts',
    '!**/dist/**',
    '!**/node_modules/**',
    '!**/tests/**'
  ],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: {
        esModuleInterop: true,
        allowSyntheticDefaultImports: true
      }
    }]
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@polkadot|@acala-network)/)'
  ],
  moduleNameMapper: {
    '^@polkadot/rpc-core/types/(.*)$': '<rootDir>/../../node_modules/@polkadot/rpc-core/cjs/types/$1',
    '^@polkadot/([^/]+)/(?!cjs/)(.+)$': '<rootDir>/../../node_modules/@polkadot/$1/cjs/$2',
    '^@polkadot/x-bigint$': '<rootDir>/../../node_modules/@polkadot/x-bigint/cjs/index.js',
    '^@polkadot/x-bigint/shim$': '<rootDir>/../../node_modules/@polkadot/x-bigint/cjs/shim.js'
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/']
};
