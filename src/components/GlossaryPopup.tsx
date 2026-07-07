import { useState, useEffect, useMemo, useCallback } from 'react';
import { db } from '../db';
import type { GlossaryTerm } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export function GlossaryPopup({ isOpen, onClose }: Props) {
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedTerm, setCopiedTerm] = useState<string | null>(null);

  // Load glossary terms
  useEffect(() => {
    if (!isOpen) return;

    const loadTerms = async () => {
      try {
        const allTerms = await db.glossary.toArray();
        setTerms(allTerms);
      } catch (error) {
        console.error('Failed to load glossary:', error);
      } finally {
        setLoading(false);
      }
    };
    loadTerms();
  }, [isOpen]);

  // Filter terms based on search
  const filteredTerms = useMemo(() => {
    if (!searchQuery) return terms;

    const query = searchQuery.toLowerCase();
    return terms.filter(t =>
      t.term.toLowerCase().includes(query) ||
      t.definition.toLowerCase().includes(query) ||
      (t.category?.toLowerCase().includes(query) ?? false)
    );
  }, [terms, searchQuery]);

  // Group by category
  const groupedTerms = useMemo(() => {
    const groups = new Map<string, GlossaryTerm[]>();

    filteredTerms.forEach(term => {
      const cat = term.category || 'Other';
      if (!groups.has(cat)) {
        groups.set(cat, []);
      }
      groups.get(cat)!.push(term);
    });

    // Sort groups and terms within groups
    const sorted = new Map(
      [...groups.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([cat, terms]) => [cat, terms.sort((a, b) => a.term.localeCompare(b.term))])
    );

    return sorted;
  }, [filteredTerms]);

  const copyTerm = useCallback((term: string) => {
    navigator.clipboard.writeText(term);
    setCopiedTerm(term);
    setTimeout(() => setCopiedTerm(null), 1500);
  }, []);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Slide-out Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-gray-900 border-l border-gray-800 z-50 flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <h2 className="text-lg font-medium text-white">Trading Glossary</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="px-4 py-3 border-b border-gray-800">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search terms..."
              autoFocus
              className="w-full pl-10 pr-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
          </div>
          <p className="mt-2 text-xs text-gray-500">Click any term to copy it</p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-32">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500"></div>
            </div>
          ) : filteredTerms.length === 0 ? (
            <div className="p-8 text-center text-gray-400">
              {searchQuery ? 'No terms match your search.' : 'No glossary terms yet.'}
            </div>
          ) : (
            <div className="divide-y divide-gray-800">
              {Array.from(groupedTerms.entries()).map(([category, categoryTerms]) => (
                <div key={category} className="py-2">
                  <div className="px-4 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide">
                    {category}
                  </div>
                  <div className="space-y-1 px-2">
                    {categoryTerms.map(term => (
                      <button
                        key={term.term}
                        onClick={() => copyTerm(term.term)}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-800 transition-colors group"
                      >
                        <div className="flex items-center justify-between">
                          <span className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-sm font-mono">
                            {term.term}
                          </span>
                          {copiedTerm === term.term ? (
                            <span className="text-xs text-green-400">Copied!</span>
                          ) : (
                            <svg className="w-4 h-4 text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-gray-400">{term.definition}</p>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-gray-800 text-center">
          <a
            href="/settings/glossary"
            className="text-sm text-blue-400 hover:text-blue-300 transition-colors"
          >
            Manage glossary in Settings
          </a>
        </div>
      </div>
    </>
  );
}

// Hook to manage glossary popup state
export function useGlossaryPopup() {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen(prev => !prev), []);

  return { isOpen, open, close, toggle };
}

// Glossary button component for sidebar
export function GlossaryButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
      title="Trading Glossary"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    </button>
  );
}
