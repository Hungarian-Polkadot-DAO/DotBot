/**
 * Asset Transfer Agent Definition
 * 
 * Definition for the Asset Transfer Agent used in system prompts.
 * This tells the LLM what the agent can do and how to use it.
 */

import { AgentDefinition } from './types';

export const ASSET_TRANSFER_AGENT: AgentDefinition = {
  className: 'AssetTransferAgent',
  displayName: 'Asset Transfer Agent',
  purpose: 'Handles DOT and token transfers between accounts on Polkadot/Kusama',
  description: `The Asset Transfer Agent creates extrinsics for transferring DOT and tokens
    between accounts on the Polkadot or Kusama networks. It supports standard transfers,
    keep-alive transfers (to prevent account reaping), and batch transfers to multiple
    recipients in a single transaction. The agent validates addresses, checks balances,
    estimates fees, and provides detailed warnings and metadata.`,
  
  functions: [
    {
      name: 'transfer',
      description: 'Transfer DOT or tokens from one account to another',
      detailedDescription: `Creates a transfer extrinsic to send DOT or tokens from the sender's
        account to a recipient. The agent automatically validates addresses, checks balances,
        estimates fees, and can optionally use transferKeepAlive to ensure the sender account
        remains alive after the transfer. Amounts can be specified in human-readable format
        (e.g., "1.5" DOT) or in Planck (smallest unit).`,
      parameters: [
        {
          name: 'address',
          type: 'string (SS58 Address)',
          required: true,
          description: 'The sender account address',
          examples: [
            '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
            '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
          ],
          constraints: 'Must be a valid SS58 address',
        },
        {
          name: 'recipient',
          type: 'string (SS58 Address)',
          required: true,
          description: 'The recipient account address',
          examples: [
            '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
            '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
          ],
          constraints: 'Must be a valid SS58 address, cannot be the same as sender',
        },
        {
          name: 'amount',
          type: 'string | number',
          required: true,
          description: 'Amount to transfer (can be human-readable like "1.5" or in Planck)',
          examples: ['1.5', '1000000000000', '0.1', 2.5],
          constraints: 'Must be greater than zero',
        },
        {
          name: 'keepAlive',
          type: 'boolean',
          required: false,
          description: 'Whether to use transferKeepAlive (prevents account reaping)',
          examples: ['true', 'false'],
          default: false,
          constraints: 'Optional, defaults to false',
        },
        {
          name: 'validateBalance',
          type: 'boolean',
          required: false,
          description: 'Whether to validate balance before creating extrinsic',
          examples: ['true', 'false'],
          default: true,
          constraints: 'Optional, defaults to true',
        },
        {
          name: 'network',
          type: 'string',
          required: false,
          description: 'Network identifier (polkadot, kusama, etc.)',
          examples: ['polkadot', 'kusama'],
          default: 'polkadot',
        },
      ],
      returns: {
        type: 'extrinsic',
        description: 'Returns an AgentResult containing the transfer extrinsic, estimated fee, description, and metadata',
      },
      examples: [
        'Transfer 5 DOT to Alice',
        'Send 1.5 DOT to 5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
        'Transfer 10 DOT to Bob with keepAlive',
        'Send 0.1 DOT to Charlie',
      ],
      requiresConfirmation: true,
      relatedFunctions: ['batchTransfer'],
    },
    {
      name: 'batchTransfer',
      description: 'Transfer DOT or tokens to multiple recipients in a single transaction',
      detailedDescription: `Creates a batch transfer extrinsic that sends DOT or tokens to multiple
        recipients atomically in a single transaction. All transfers succeed or fail together.
        Useful for airdrops, payroll, or sending to multiple recipients efficiently. The agent
        validates all addresses, calculates total amount, checks balance, and estimates fees.`,
      parameters: [
        {
          name: 'address',
          type: 'string (SS58 Address)',
          required: true,
          description: 'The sender account address',
          examples: [
            '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY',
            '5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty',
          ],
          constraints: 'Must be a valid SS58 address',
        },
        {
          name: 'transfers',
          type: 'Array<{ recipient: string, amount: string | number }>',
          required: true,
          description: 'Array of transfers, each with recipient and amount. Example: [{ recipient: "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty", amount: "1.0" }, { recipient: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY", amount: "2.5" }]',
          constraints: 'Must have at least 1 transfer, maximum 100 transfers',
        },
        {
          name: 'validateBalance',
          type: 'boolean',
          required: false,
          description: 'Whether to validate balance before creating extrinsic',
          examples: ['true', 'false'],
          default: true,
          constraints: 'Optional, defaults to true',
        },
        {
          name: 'network',
          type: 'string',
          required: false,
          description: 'Network identifier (polkadot, kusama, etc.)',
          examples: ['polkadot', 'kusama'],
          default: 'polkadot',
        },
      ],
      returns: {
        type: 'extrinsic',
        description: 'Returns an AgentResult containing the batch transfer extrinsic, estimated fee, description, and metadata including transfer count and total amount',
      },
      examples: [
        'Send 1 DOT each to Alice, Bob, and Charlie',
        'Batch transfer: 0.5 DOT to 5 recipients',
        'Airdrop 2 DOT to 10 addresses',
      ],
      requiresConfirmation: true,
      relatedFunctions: ['transfer'],
    },
  ],
  
  useCases: [
    'User wants to send DOT to another account',
    'User wants to transfer tokens between accounts',
    'User wants to send to multiple recipients efficiently',
    'User wants to ensure account stays alive after transfer',
    'User wants to perform airdrops or batch payments',
  ],
  
  prerequisites: [
    'Polkadot API instance must be initialized',
    'Sender account must have sufficient balance (including fees)',
    'Valid SS58 addresses for sender and recipient(s)',
  ],
  
  networks: ['polkadot', 'kusama', 'all'],
  
  limitations: [
    'Only supports native DOT transfers (not cross-chain XCM transfers)',
    'Does not support token transfers on parachains (only relay chain)',
    'Batch transfers limited to 100 recipients',
    'Cannot transfer to the same address as sender',
    'Does not handle asset swaps (use Asset Swap Agent for that)',
  ],
  
  dependencies: [],
  
  compatibleAgents: [
    // Can be used with other agents in execution arrays
  ],
  
  categories: ['transfers', 'assets', 'payments'],
};

