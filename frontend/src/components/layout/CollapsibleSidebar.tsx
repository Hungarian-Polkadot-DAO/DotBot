import React, { useState } from 'react';
import { MessageSquarePlus, Search, Receipt, ChevronLeft, ChevronRight } from 'lucide-react';

interface SidebarProps {
  onNewChat: () => void;
  onSearchChat: () => void;
  onTransactions: () => void;
}

const CollapsibleSidebar: React.FC<SidebarProps> = ({
  onNewChat,
  onSearchChat,
  onTransactions
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const toggleSidebar = () => {
    setIsExpanded(!isExpanded);
  };

  const menuItems = [
    {
      icon: MessageSquarePlus,
      label: 'New Chat',
      onClick: onNewChat
    },
    {
      icon: Search,
      label: 'Search Chat',
      onClick: onSearchChat
    },
    {
      icon: Receipt,
      label: 'Transactions',
      onClick: onTransactions
    }
  ];

  return (
    <div className={`sidebar ${isExpanded ? 'expanded' : 'collapsed'}`}>
      {/* Logo and Toggle */}
      <div className="sidebar-header">
        {isExpanded && (
          <div className="sidebar-logo">
            <div className="sidebar-logo-icon">
              <span>D</span>
            </div>
            <span className="sidebar-logo-text">DotBot</span>
          </div>
        )}
        
        <button
          onClick={toggleSidebar}
          className="sidebar-toggle"
        >
          {isExpanded ? (
            <ChevronLeft className="sidebar-nav-icon" />
          ) : (
            <ChevronRight className="sidebar-nav-icon" />
          )}
        </button>
      </div>

      {/* Menu Items */}
      <nav className="sidebar-nav">
        <ul>
          {menuItems.map((item, index) => (
            <li key={index}>
              <button
                onClick={item.onClick}
                className={`sidebar-nav-item ${isExpanded ? 'expanded' : 'collapsed'}`}
                title={!isExpanded ? item.label : undefined}
              >
                <item.icon className="sidebar-nav-icon" />
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
