import React from 'react';

interface InputFieldProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onKeyPress: (e: React.KeyboardEvent) => void;
  onVoiceInput?: () => void;
  placeholder?: string;
  disabled?: boolean;
}

const InputField: React.FC<InputFieldProps> = ({
  value,
  onChange,
  onSend,
  onKeyPress,
  onVoiceInput,
  placeholder = "Type your message...",
  disabled = false
}) => {
  return (
    <div className="flex items-end space-x-3">
      {/* Text input */}
      <div className="flex-1 relative">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyPress={onKeyPress}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="w-full px-4 py-3 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            minHeight: '50px',
            maxHeight: '150px'
          }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = 'auto';
            target.style.height = `${Math.min(target.scrollHeight, 150)}px`;
          }}
        />
      </div>

      {/* Voice input button */}
      {onVoiceInput && (
        <button
          onClick={onVoiceInput}
          disabled={disabled}
          className="p-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="Voice input"
        >
          🎤
        </button>
      )}

      {/* Send button */}
      <button
        onClick={onSend}
        disabled={disabled || !value.trim()}
        className="p-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        title="Send message"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22,2 15,22 11,13 2,9 22,2"></polygon>
        </svg>
      </button>
    </div>
  );
};

export default InputField;
