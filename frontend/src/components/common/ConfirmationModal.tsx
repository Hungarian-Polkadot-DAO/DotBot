/**
 * ConfirmationModal Component
 * 
 * A reusable modal for confirmation dialogs (delete, confirm actions, etc.)
 */

import React, { useEffect } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import '../styles/confirmation-modal.css';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  isLoading?: boolean;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  isLoading = false,
}) => {
  // Close on ESC key
  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose, isLoading]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    if (!isLoading) {
      onConfirm();
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (!isLoading && e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div className="confirmation-modal-overlay" onClick={handleOverlayClick}>
      <div className="confirmation-modal" onClick={(e) => e.stopPropagation()}>
        <div className="confirmation-modal-header">
          <div className="confirmation-modal-title-row">
            {variant === 'danger' && (
              <AlertTriangle className="confirmation-modal-icon confirmation-modal-icon-danger" size={20} />
            )}
            <h2 className="confirmation-modal-title">{title}</h2>
          </div>
          <button 
            onClick={onClose} 
            className="confirmation-modal-close"
            disabled={isLoading}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="confirmation-modal-content">
          <p className="confirmation-modal-message">{message}</p>
        </div>

        <div className="confirmation-modal-footer">
          <button
            onClick={onClose}
            className="confirmation-modal-button confirmation-modal-button-cancel"
            disabled={isLoading}
          >
            {cancelText}
          </button>
          <button
            onClick={handleConfirm}
            className={`confirmation-modal-button confirmation-modal-button-confirm confirmation-modal-button-${variant}`}
            disabled={isLoading}
          >
            {isLoading ? 'Processing...' : confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationModal;

