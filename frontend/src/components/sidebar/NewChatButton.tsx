import React from 'react';

interface NewChatButtonProps {
  onClick: () => void;
}

const NewChatButton: React.FC<NewChatButtonProps> = ({ onClick }) => {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors duration-200 font-medium"
    >
      <span className="text-lg">+</span>
      <span>New Chat</span>
    </button>
  );
};

export default NewChatButton;
