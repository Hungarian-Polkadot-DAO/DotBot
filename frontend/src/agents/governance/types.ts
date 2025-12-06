/**
 * Types for Governance Agent
 */

export interface VoteParams {
  /** Account address */
  address: string;
  
  /** Referendum index */
  referendumIndex: number;
  
  /** Vote: true for aye, false for nay */
  aye: boolean;
  
  /** Conviction (0-6) */
  conviction?: number;
}

export interface ProposeParams {
  /** Account address */
  address: string;
  
  /** Proposal call */
  proposal: any;
  
  /** Value to lock */
  value?: string;
}

export interface DelegateParams {
  /** Account address */
  address: string;
  
  /** Delegate to this address */
  to: string;
  
  /** Conviction (0-6) */
  conviction: number;
  
  /** Balance to delegate */
  balance?: string;
}

