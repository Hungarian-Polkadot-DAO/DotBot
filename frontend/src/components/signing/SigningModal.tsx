/**
 * Signing Modal Component
 * 
 * Displays transaction signing requests to the user for approval.
 * Shows transaction details, estimated fees, and warnings.
 */

import React, { useState } from 'react';
import { X, AlertTriangle, Info } from 'lucide-react';
import { SigningRequest, BatchSigningRequest } from '../../lib/executionEngine/types';
import '../../styles/signing-modal.css';

interface SigningModalProps {
  request: SigningRequest | BatchSigningRequest | null;
  onClose: () => void;
}

const SigningModal: React.FC<SigningModalProps> = ({ request, onClose }) => {
  const [isApproving, setIsApproving] = useState(false);

  if (!request) return null;

  const isBatch = 'itemIds' in request;

  const handleApprove = async () => {
    setIsApproving(true);
    try {
      request.resolve(true);
      onClose();
    } catch (error) {
      console.error('Error approving transaction:', error);
      setIsApproving(false);
    }
  };

  const handleReject = () => {
    request.resolve(false);
    onClose();
  };

  const formatAddress = (address: string): string => {
    if (!address) return '';
    return `${address.slice(0, 8)}...${address.slice(-8)}`;
  };

  return (
    <div className="signing-modal-overlay">
      <div className="signing-modal-container">
        {/* Header */}
        <div className="signing-modal-header">
          <div className="signing-modal-title">
            <Info className="w-6 h-6 text-blue-500" />
            <h2 className="signing-modal-heading">
              {isBatch ? 'Approve Batch Transaction' : 'Approve Transaction'}
            </h2>
          </div>
          <button
            onClick={handleReject}
            className="signing-modal-close"
            disabled={isApproving}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="signing-modal-content">
          {/* Account Info */}
          <div className="signing-info-section">
            <div className="signing-info-label">Signing with account:</div>
            <div className="signing-info-value">{formatAddress(request.accountAddress)}</div>
          </div>

          {/* Transaction Details */}
          <div className="signing-details-section">
            <h3 className="signing-section-title">Transaction Details</h3>
            
            {isBatch ? (
              // Batch transaction
              <div className="signing-batch-details">
                <div className="signing-batch-count">
                  {(request as BatchSigningRequest).itemIds.length} operations
                </div>
                <div className="signing-operations-list">
                  {(request as BatchSigningRequest).descriptions.map((desc, index) => (
                    <div key={index} className="signing-operation-item">
                      <span className="signing-operation-number">{index + 1}.</span>
                      <span className="signing-operation-text">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              // Single transaction
              <div className="signing-single-details">
                <p className="signing-description">
                  {(request as SigningRequest).description}
                </p>
              </div>
            )}
          </div>

          {/* Estimated Fee */}
          {request.estimatedFee && (
            <div className="signing-fee-section">
              <div className="signing-info-label">Estimated Fee:</div>
              <div className="signing-fee-value">{request.estimatedFee}</div>
            </div>
          )}

          {/* Warnings */}
          {request.warnings && request.warnings.length > 0 && (
            <div className="signing-warnings-section">
              <div className="signing-warnings-header">
                <AlertTriangle className="w-5 h-5 text-yellow-500" />
                <span className="signing-warnings-title">Warnings</span>
              </div>
              <ul className="signing-warnings-list">
                {request.warnings.map((warning, index) => (
                  <li key={index} className="signing-warning-item">
                    {warning}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Metadata (if any) - only for SigningRequest */}
          {!isBatch && 'metadata' in request && request.metadata && Object.keys(request.metadata).length > 0 && (
            <div className="signing-metadata-section">
              <h4 className="signing-metadata-title">Additional Information</h4>
              <div className="signing-metadata-content">
                {Object.entries(request.metadata).map(([key, value]) => (
                  <div key={key} className="signing-metadata-item">
                    <span className="signing-metadata-key">{key}:</span>
                    <span className="signing-metadata-value">
                      {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="signing-modal-actions">
          <button
            onClick={handleReject}
            className="signing-reject-btn"
            disabled={isApproving}
          >
            Reject
          </button>
          <button
            onClick={handleApprove}
            className="signing-approve-btn"
            disabled={isApproving}
          >
            {isApproving ? 'Approving...' : 'Approve & Sign'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SigningModal;

