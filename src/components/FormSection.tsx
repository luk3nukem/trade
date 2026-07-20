import { useState, type ReactNode } from 'react';

interface FormSectionProps {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

export function FormSection({ title, children, defaultOpen = true, className = '' }: FormSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`border border-gray-700 rounded-lg ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-800 hover:bg-gray-750 transition-colors text-left"
      >
        <span className="font-medium text-gray-200">{title}</span>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="p-4 bg-gray-850">
          {children}
        </div>
      )}
    </div>
  );
}
