import React from 'react';

const TypingIndicator: React.FC = () => {
  return (
    <div className="flex justify-start mb-4">
      <div className="max-w-[70%]">
        {/* Agent info */}
        <div className="flex items-center mb-2">
          <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center text-xs text-white mr-2">
            D
          </div>
          <span className="text-sm text-gray-400">DotBot</span>
        </div>

        {/* Typing bubble */}
        <div className="bg-gray-800 text-gray-100 rounded-lg px-4 py-3 mr-4">
          <div className="flex items-center space-x-1">
            <div className="flex space-x-1">
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
              <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
            </div>
            <span className="text-sm text-gray-500 ml-2">thinking...</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TypingIndicator;
