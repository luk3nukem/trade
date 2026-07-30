import { useState, useEffect, useMemo, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db';
import type { Note, NoteStatus, CreateNote } from '../../types';
import { NOTE_CATEGORY_PRESETS, ZONE_LEVEL_TYPES } from '../../types';

// All level types for token highlighting
const ALL_LEVEL_TYPES = [...ZONE_LEVEL_TYPES, 'LCPB', 'fib', 'S/R', 'EQ'] as string[];

// Helper to format relative time
function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// Token highlighting component
function HighlightedContent({ content }: { content: string }) {
  // Pattern for #PAIR tokens (e.g., #NZDJPY, #XAUUSD) and level types
  const pairPattern = /#[A-Z]{3,10}/g;
  const levelTypePattern = new RegExp(`\\b(${ALL_LEVEL_TYPES.join('|')})\\b`, 'g');

  const parts: { text: string; type: 'text' | 'pair' | 'level' }[] = [];
  let lastIndex = 0;

  // Find all tokens and their positions
  const tokens: { start: number; end: number; type: 'pair' | 'level' }[] = [];

  let match;
  while ((match = pairPattern.exec(content)) !== null) {
    tokens.push({ start: match.index, end: match.index + match[0].length, type: 'pair' });
  }
  while ((match = levelTypePattern.exec(content)) !== null) {
    tokens.push({ start: match.index, end: match.index + match[0].length, type: 'level' });
  }

  // Sort by position and remove overlaps
  tokens.sort((a, b) => a.start - b.start);
  const filteredTokens = tokens.filter((t, i) => {
    if (i === 0) return true;
    return t.start >= tokens[i - 1].end;
  });

  for (const token of filteredTokens) {
    if (token.start > lastIndex) {
      parts.push({ text: content.slice(lastIndex, token.start), type: 'text' });
    }
    parts.push({ text: content.slice(token.start, token.end), type: token.type });
    lastIndex = token.end;
  }
  if (lastIndex < content.length) {
    parts.push({ text: content.slice(lastIndex), type: 'text' });
  }

  if (parts.length === 0) {
    return <span>{content}</span>;
  }

  return (
    <span>
      {parts.map((part, i) => {
        if (part.type === 'pair') {
          return (
            <span key={i} className="text-blue-400 bg-blue-500/10 px-0.5 rounded">
              {part.text}
            </span>
          );
        }
        if (part.type === 'level') {
          return (
            <span key={i} className="text-amber-400 bg-amber-500/10 px-0.5 rounded">
              {part.text}
            </span>
          );
        }
        return <span key={i}>{part.text}</span>;
      })}
    </span>
  );
}

// Status badge component
function StatusBadge({
  status,
  onClick,
}: {
  status: NoteStatus;
  onClick?: () => void;
}) {
  const config = {
    active: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Active' },
    validated: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Validated' },
    retired: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Retired' },
  };
  const c = config[status];

  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded text-xs font-medium ${c.bg} ${c.text} ${onClick ? 'cursor-pointer hover:opacity-80' : ''}`}
      title={onClick ? 'Click to cycle status' : undefined}
    >
      {c.label}
    </button>
  );
}

// Category badge component
function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="px-2 py-0.5 rounded text-xs font-medium bg-purple-500/20 text-purple-400">
      {category}
    </span>
  );
}

// Single note card component
function NoteCard({
  note,
  onUpdate,
  onDelete,
}: {
  note: Note;
  onUpdate: (id: string, updates: Partial<Note>) => void;
  onDelete: (id: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(note.content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(editContent.length, editContent.length);
    }
  }, [isEditing]);

  const cycleStatus = () => {
    const statusOrder: NoteStatus[] = ['active', 'validated', 'retired'];
    const currentIndex = statusOrder.indexOf(note.status);
    const nextStatus = statusOrder[(currentIndex + 1) % 3];
    onUpdate(note.id!, { status: nextStatus });
  };

  const handleSave = () => {
    if (editContent.trim() !== note.content) {
      onUpdate(note.id!, { content: editContent.trim() });
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSave();
    }
    if (e.key === 'Escape') {
      setEditContent(note.content);
      setIsEditing(false);
    }
  };

  return (
    <div className={`p-3 bg-gray-750 rounded-lg border-l-2 ${note.pinned ? 'border-amber-500' : 'border-transparent'}`}>
      <div className="flex items-start gap-3">
        {/* Pin indicator */}
        <button
          onClick={() => onUpdate(note.id!, { pinned: !note.pinned })}
          className={`mt-0.5 p-1 rounded hover:bg-gray-700 ${note.pinned ? 'text-amber-400' : 'text-gray-600 hover:text-gray-400'}`}
          title={note.pinned ? 'Unpin' : 'Pin to top'}
        >
          <svg className="w-4 h-4" fill={note.pinned ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <textarea
              ref={textareaRef}
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              onBlur={handleSave}
              onKeyDown={handleKeyDown}
              className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm resize-none"
              rows={3}
            />
          ) : (
            <p
              className="text-gray-200 text-sm cursor-pointer hover:bg-gray-700/50 rounded px-1 -mx-1"
              onClick={() => setIsEditing(true)}
              title="Click to edit"
            >
              <HighlightedContent content={note.content} />
            </p>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <CategoryBadge category={note.category} />
            <StatusBadge status={note.status} onClick={cycleStatus} />
            <span className="text-xs text-gray-500">{formatRelativeTime(note.createdAt)}</span>
            <span className="flex-1" />
            <button
              onClick={() => onDelete(note.id!)}
              className="text-gray-500 hover:text-red-400 p-1 rounded hover:bg-gray-700"
              title="Delete note"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function NotebookPage() {
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState('observation');
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [searchText, setSearchText] = useState('');
  const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);
  const [showRetired, setShowRetired] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load all notes
  const allNotes = useLiveQuery(() => db.notes.toArray(), []);

  // Get unique categories for autocomplete
  const allCategories = useMemo(() => {
    if (!allNotes) return NOTE_CATEGORY_PRESETS as unknown as string[];
    const customCategories = allNotes.map((n) => n.category).filter((c) => !NOTE_CATEGORY_PRESETS.includes(c as typeof NOTE_CATEGORY_PRESETS[number]));
    const uniqueCustom = [...new Set(customCategories)];
    return [...NOTE_CATEGORY_PRESETS, ...uniqueCustom];
  }, [allNotes]);

  // Filter and sort notes
  const { activeNotes, retiredNotes } = useMemo(() => {
    if (!allNotes) return { activeNotes: [], retiredNotes: [] };

    let filtered = allNotes;

    // Apply category filter
    if (filterCategory) {
      filtered = filtered.filter((n) => n.category === filterCategory);
    }

    // Apply status filter
    if (filterStatus) {
      filtered = filtered.filter((n) => n.status === filterStatus);
    }

    // Apply search filter
    if (searchText) {
      const searchLower = searchText.toLowerCase();
      filtered = filtered.filter((n) => n.content.toLowerCase().includes(searchLower));
    }

    // Separate retired notes
    const retired = filtered.filter((n) => n.status === 'retired');
    const active = filtered.filter((n) => n.status !== 'retired');

    // Sort: pinned first, then by createdAt descending
    const sortFn = (a: Note, b: Note) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    };

    return {
      activeNotes: active.sort(sortFn),
      retiredNotes: retired.sort(sortFn),
    };
  }, [allNotes, filterCategory, filterStatus, searchText]);

  const handleQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim()) return;

    const note: CreateNote = {
      content: newContent.trim(),
      category: newCategory || 'observation',
      status: 'active',
      pinned: false,
    };

    await db.notes.add({
      ...note,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Note);

    setNewContent('');
    inputRef.current?.focus();
  };

  const handleUpdate = async (id: string, updates: Partial<Note>) => {
    await db.notes.update(id, { ...updates, updatedAt: new Date() });
  };

  const handleDelete = async (id: string) => {
    if (confirm('Delete this note?')) {
      await db.notes.delete(id);
    }
  };

  const filteredCategorySuggestions = allCategories.filter((c) =>
    c.toLowerCase().includes(newCategory.toLowerCase())
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Trading Notebook</h1>
        <p className="text-gray-400 text-sm mt-1">
          Capture observations, rules, and hypotheses. Use #PAIR tokens for quick visual scanning.
        </p>
      </div>

      {/* Quick Add Box */}
      <form onSubmit={handleQuickAdd} className="bg-gray-800 rounded-lg p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <div className="flex-1">
            <input
              ref={inputRef}
              type="text"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              placeholder="Quick note... (use #PAIR for instrument tags)"
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              autoFocus
            />
          </div>
          <div className="relative">
            <input
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              onFocus={() => setShowCategorySuggestions(true)}
              onBlur={() => setTimeout(() => setShowCategorySuggestions(false), 150)}
              placeholder="Category"
              className="w-full md:w-32 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
            />
            {showCategorySuggestions && filteredCategorySuggestions.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-gray-700 border border-gray-600 rounded-lg shadow-lg max-h-40 overflow-auto">
                {filteredCategorySuggestions.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => {
                      setNewCategory(cat);
                      setShowCategorySuggestions(false);
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-gray-600"
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={!newContent.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium"
          >
            Add
          </button>
        </div>
      </form>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">Filter:</span>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
          >
            <option value="">All categories</option>
            {allCategories.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="validated">Validated</option>
            <option value="retired">Retired</option>
          </select>
        </div>
        <div className="flex-1" />
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="Search notes..."
          className="w-48 px-3 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm placeholder-gray-500"
        />
      </div>

      {/* Notes List */}
      <div className="space-y-2">
        {activeNotes.length === 0 && retiredNotes.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            {allNotes?.length === 0
              ? 'No notes yet. Start capturing observations above.'
              : 'No notes match your filters.'}
          </div>
        ) : (
          <>
            {/* Active notes */}
            {activeNotes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
              />
            ))}

            {/* Retired notes section */}
            {retiredNotes.length > 0 && (
              <div className="mt-6">
                <button
                  onClick={() => setShowRetired(!showRetired)}
                  className="flex items-center gap-2 text-gray-500 hover:text-gray-400 text-sm"
                >
                  <svg
                    className={`w-4 h-4 transition-transform ${showRetired ? 'rotate-90' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  Retired ({retiredNotes.length})
                </button>
                {showRetired && (
                  <div className="mt-2 space-y-2 opacity-60">
                    {retiredNotes.map((note) => (
                      <NoteCard
                        key={note.id}
                        note={note}
                        onUpdate={handleUpdate}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Stats footer */}
      {allNotes && allNotes.length > 0 && (
        <div className="text-center text-sm text-gray-500">
          {allNotes.filter((n) => n.status === 'active').length} active
          {' · '}
          {allNotes.filter((n) => n.status === 'validated').length} validated
          {' · '}
          {allNotes.filter((n) => n.status === 'retired').length} retired
        </div>
      )}
    </div>
  );
}
