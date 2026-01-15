/**
 * WebSocket Health Monitor
 * 
 * Optional debugging component to display WebSocket connection status.
 * Shows connection state, reconnection attempts, and transport method.
 * 
 * Usage:
 * - Add to your app during development to monitor WebSocket health
 * - Remove or hide in production
 */

import React from 'react';
import { useWebSocket } from '../../contexts/WebSocketContext';

interface WebSocketHealthMonitorProps {
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  showInProduction?: boolean;
}

const WebSocketHealthMonitor: React.FC<WebSocketHealthMonitorProps> = ({
  position = 'bottom-right',
  showInProduction = false
}) => {
  const { isConnected, isConnecting, connectionError } = useWebSocket();
  
  // Hide in production unless explicitly enabled
  if (process.env.NODE_ENV === 'production' && !showInProduction) {
    return null;
  }
  
  // Position styles
  const positionStyles: Record<string, React.CSSProperties> = {
    'top-left': { top: '10px', left: '10px' },
    'top-right': { top: '10px', right: '10px' },
    'bottom-left': { bottom: '10px', left: '10px' },
    'bottom-right': { bottom: '10px', right: '10px' },
  };
  
  // Status styles
  const statusColor = isConnected ? '#10b981' : isConnecting ? '#f59e0b' : '#ef4444';
  const statusText = isConnected ? 'Connected' : isConnecting ? 'Connecting...' : 'Disconnected';
  const statusIcon = isConnected ? '●' : isConnecting ? '◐' : '○';
  
  return (
    <div
      style={{
        position: 'fixed',
        ...positionStyles[position],
        background: 'rgba(0, 0, 0, 0.8)',
        color: '#fff',
        padding: '8px 12px',
        borderRadius: '6px',
        fontSize: '12px',
        fontFamily: 'monospace',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
      }}
    >
      <span style={{ color: statusColor, fontSize: '16px' }}>
        {statusIcon}
      </span>
      <span>
        <strong>WebSocket:</strong> {statusText}
      </span>
      {connectionError && (
        <span style={{ color: '#ef4444', fontSize: '10px' }}>
          ({connectionError})
        </span>
      )}
    </div>
  );
};

export default WebSocketHealthMonitor;
