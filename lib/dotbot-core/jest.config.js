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
    '^@polkadot/x-bigint/shim$': '<rootDir>/../../node_modules/@polkadot/x-bigint/cjs/shim.js',
    '^@polkadot/x-textdecoder$': '<rootDir>/../../node_modules/@polkadot/x-textdecoder/cjs/node.js',
    '^@polkadot/x-textencoder$': '<rootDir>/../../node_modules/@polkadot/x-textencoder/cjs/node.js',
    '^@polkadot/x-fetch$': '<rootDir>/../../node_modules/@polkadot/x-fetch/cjs/node.js',
    '^@polkadot/x-global$': '<rootDir>/../../node_modules/@polkadot/x-global/cjs/index.js',
    '^@polkadot/x-randomvalues$': '<rootDir>/../../node_modules/@polkadot/x-randomvalues/cjs/node.js',
    '^@polkadot/x-ws$': '<rootDir>/../../node_modules/@polkadot/x-ws/cjs/node.js'
  },
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/']
};
