import React, { useState } from 'react';
import dotbotLogo from '../../assets/dotbot-logo.svg';
import dotbotLogoLight from '../../assets/dotbot-logo_light.svg';
import iconWrite from '../../assets/icon-write.svg';
import iconSearch from '../../assets/icon-search.svg';
import iconTransactions from '../../assets/icon-transactions.svg';
import sidebarCollapseIcon from '../../assets/cuida_sidebar-collapse-outline.svg';

interface SidebarProps {
  onNewChat: () => void;
  onSearchChat: () => void;
  onTransactions: () => void;
  isExpanded: boolean;
  onToggle: (expanded: boolean) => void;
}

const CollapsibleSidebar: React.FC<SidebarProps> = ({
  onNewChat,
  onSearchChat,
  onTransactions,
  isExpanded,
  onToggle
}) => {
  const toggleSidebar = () => {
    onToggle(!isExpanded);
  };

  const menuItems = [
    {
      icon: iconWrite,
      label: 'New Chat',
      onClick: onNewChat
    },
    {
      icon: iconSearch,
      label: 'Search Chat',
      onClick: onSearchChat
    },
    {
      icon: iconTransactions,
      label: 'Transactions',
      onClick: onTransactions
    }
  ];

  return (
    <div className={`sidebar ${isExpanded ? 'expanded' : 'collapsed'}`}>
      {/* Logo Toggle Button */}
      <div className="sidebar-header">
        <button
          onClick={toggleSidebar}
          className="sidebar-logo-button"
        >
          <img 
            src={dotbotLogo} 
            alt="DotBot" 
            style={{ height: '32px', width: '32px', flexShrink: 0 }}
          />
          {isExpanded && <span className="sidebar-logo-text">DotBot</span>}
        </button>
      </div>

      {/* Menu Items */}
      <nav className="sidebar-nav">
        <ul>
          {menuItems.map((item, index) => (
            <li key={index}>
              <button
                onClick={item.onClick}
                className="sidebar-nav-item"
                title={!isExpanded ? item.label : undefined}
              >
                <img 
                  src={item.icon} 
                  alt={item.label}
                  className="sidebar-nav-icon"
                  style={{ flexShrink: 0 }}
                />
                {isExpanded && (
                  <span>{item.label}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {/* Footer - Powered by ASI.One */}
      {isExpanded && (
        <div className="sidebar-footer">
          <div className="sidebar-footer-text">
            Powered by ASI.One
          </div>
        </div>
      )}
    </div>
  );
};

export default CollapsibleSidebar;
