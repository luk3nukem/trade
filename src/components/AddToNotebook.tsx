import { useState, useRef, useEffect } from 'react';
import { db } from '../db';
import type { Note, CreateNote } from '../types';
import { NOTE_CATEGORY_PRESETS } from '../types';

interface AddToNotebookProps {
  className?: string;
}

export function AddToNotebook({ className = '' }: AddToNotebookProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('observation');
  const [isSaving, setIsSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Close on click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || isSaving) return;

    setIsSaving(true);
    try {
      const note: CreateNote = {
        content: content.trim(),
        category: category || 'observation',
        status: 'active',
        pinned: false,
      };

      await db.notes.add({
        ...note,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as Note);

      setContent('');
      setIsOpen(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 px-2 py-1 text-sm text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
        title="Add observation to notebook"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        <span className="hidden sm:inline">Note</span>
      </button>

      {isOpen && (
        <div
          ref={popoverRef}
          className="absolute z-50 right-0 mt-2 w-72 bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-3"
          onKeyDown={handleKeyDown}
        >
          <form onSubmit={handleSubmit}>
            <div className="space-y-2">
              <input
                ref={inputRef}
                type="text"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Quick observation..."
                className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded text-white text-sm placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <div className="flex items-center gap-2">
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="flex-1 px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                >
                  {NOTE_CATEGORY_PRESETS.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={!content.trim() || isSaving}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded font-medium"
                >
                  {isSaving ? '...' : 'Add'}
                </button>
              </div>
            </div>
          </form>
          <p className="mt-2 text-xs text-gray-500">
            Tip: Use #PAIR for instrument tags
          </p>
        </div>
      )}
    </div>
  );
}
