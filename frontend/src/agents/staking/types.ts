/**
 * Types for Staking Agent
 */

export interface BondParams {
  /** Account address */
  address: string;
  
  /** Amount to bond (in smallest unit) */
  amount: string;
  
  /** Payee destination for rewards */
  payee?: 'Staked' | 'Stash' | 'Controller' | string;
}

export interface UnbondParams {
  /** Account address */
  address: string;
  
  /** Amount to unbond (in smallest unit) */
  amount: string;
}

export interface NominateParams {
  /** Account address */
  address: string;
  
  /** Validator addresses to nominate */
  validators: string[];
}

