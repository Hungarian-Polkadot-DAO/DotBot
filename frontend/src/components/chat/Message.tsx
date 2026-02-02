/**
 * Message Component
 * 
 * Renders a single text message (user, bot, or system).
 * 
 * This component will be part of @dotbot/react package.
 */

import React from 'react';
import { User } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import dotbotLogoWhite from '../../assets/dotbot-logo-white.svg';
import type { TextMessage, SystemMessage } from '@dotbot/core';

interface MessageProps {
  message: TextMessage | SystemMessage;
}

const Message: React.FC<MessageProps> = ({ message }) => {
  const formatDateTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const day = date.getDate();
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const time = date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
    return `${day}, ${month}, ${time}`;
  };

  // System messages are displayed as bot messages
  const displayType = message.type === 'system' ? 'bot' : message.type;
  const content = 'content' in message ? message.content : '';
  const senderName = displayType === 'user' ? 'You' : 'DotBot';

  return (
    <div className={`message ${displayType}`}>
      <div className="message-header">
        {displayType === 'user' ? (
          <>
            <span className="message-date">{formatDateTime(message.timestamp)}</span>
            <span className="message-name">{senderName}</span>
            <div className={`message-avatar ${displayType}`}>
              <User size={18} />
            </div>
          </>
        ) : (
          <>
            <div className={`message-avatar ${displayType}`}>
              <img src={dotbotLogoWhite} alt="DotBot" className="message-avatar-img" />
            </div>
            <span className="message-name">{senderName}</span>
            <span className="message-date">{formatDateTime(message.timestamp)}</span>
          </>
        )}
      </div>
      <div className="message-content">
        <div className="message-bubble">
          <ReactMarkdown
            components={{
              // Style code blocks - react-markdown wraps code blocks in <pre><code>
              code: ({ className, children, ...props }: any) => {
                const isInline = !className;
                return (
                  <code 
                    className={isInline ? "message-markdown-inline-code" : undefined}
                    {...props}
                  >
                    {children}
                  </code>
                );
              },
              // Style pre elements (code blocks)
              pre: ({ children, ...props }: any) => (
                <pre className="message-markdown-code-block" {...props}>
                  {children}
                </pre>
              ),
              // Style links
              a: ({ ...props }: any) => (
                <a className="message-markdown-link" target="_blank" rel="noopener noreferrer" {...props} />
              ),
              // Style lists
              ul: ({ ...props }: any) => (
                <ul className="message-markdown-list" {...props} />
              ),
              ol: ({ ...props }: any) => (
                <ol className="message-markdown-list message-markdown-list-ordered" {...props} />
              ),
              // Style blockquotes
              blockquote: ({ ...props }: any) => (
                <blockquote className="message-markdown-blockquote" {...props} />
              ),
              // Style headings
              h1: ({ ...props }: any) => (
                <h1 className="message-markdown-heading message-markdown-h1" {...props} />
              ),
              h2: ({ ...props }: any) => (
                <h2 className="message-markdown-heading message-markdown-h2" {...props} />
              ),
              h3: ({ ...props }: any) => (
                <h3 className="message-markdown-heading message-markdown-h3" {...props} />
              ),
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
};

export default Message;

