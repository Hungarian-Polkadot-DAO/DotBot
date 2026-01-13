/**
 * Status utility functions for ExecutionFlow components
 */

import React from 'react';
import { CheckCircle2, XCircle, Clock, Loader2 } from 'lucide-react';
import { ExecutionItem } from '@dotbot/core/executionEngine/types';

export const getStatusIcon = (status: ExecutionItem['status']) => {
  switch (status) {
    case 'completed':
    case 'finalized':
      return <CheckCircle2 className="status-icon status-success" />;
    case 'failed':
      return <XCircle className="status-icon status-error" />;
    case 'cancelled':
      return <XCircle className="status-icon status-cancelled" />;
    case 'signing':
    case 'broadcasting':
    case 'executing':
      return <Loader2 className="status-icon status-executing animate-spin" />;
    case 'ready':
      return <Clock className="status-icon status-ready" />;
    case 'pending':
      return <Loader2 className="status-icon status-pending animate-spin" />;
    default:
      return <Clock className="status-icon status-pending" />;
  }
};

export const getStatusLabel = (status: ExecutionItem['status'], simulationEnabled: boolean = false): string => {
  switch (status) {
    case 'pending': 
      // Only show "Simulating..." if simulation is actually enabled
      return simulationEnabled ? 'Simulating...' : 'Ready';
    case 'ready': return 'Ready';
    case 'executing': return 'Executing';
    case 'signing': return 'Signing...';
    case 'broadcasting': return 'Broadcasting...';
    case 'in_block': return 'In Block';
    case 'finalized': return 'Finalized';
    case 'completed': return 'Completed';
    case 'failed': return 'Failed';
    case 'cancelled': return 'Cancelled';
    default: return status;
  }
};

export const getStatusColor = (status: ExecutionItem['status']): string => {
  switch (status) {
    case 'completed':
    case 'finalized':
      return 'var(--status-success)';
    case 'failed':
      return 'var(--status-error)';
    case 'cancelled':
      return 'var(--status-cancelled)';
    case 'signing':
    case 'broadcasting':
    case 'executing':
      return 'var(--status-executing)';
    case 'ready':
      return 'var(--status-ready)';
    default:
      return 'var(--status-pending)';
  }
};

