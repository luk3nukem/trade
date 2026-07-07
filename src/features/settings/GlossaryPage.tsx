import { useState, useEffect, useMemo } from 'react';
import { db } from '../../db';
import type { GlossaryTerm } from '../../types';

// Default glossary terms to seed on first load
const DEFAULT_GLOSSARY_TERMS: GlossaryTerm[] = [
  // Order Blocks
  { term: 'OB', definition: 'Order Block — institutional candle where large orders were placed', category: 'Order Blocks' },
  { term: 'HOB', definition: 'Hidden Order Block — order block hidden within the body of a larger candle', category: 'Order Blocks' },
  { term: 'DHOB', definition: 'Double Hidden Order Block — two hidden OBs stacked at the same level', category: 'Order Blocks' },
  { term: 'BB', definition: 'Breaker Block — failed order block that becomes support/resistance', category: 'Order Blocks' },
  { term: 'MB', definition: 'Mitigation Block — order block used to mitigate losing positions', category: 'Order Blocks' },

  // Fair Value Gaps
  { term: 'FVG', definition: 'Fair Value Gap — imbalance/inefficiency in price, gap between candle wicks', category: 'Fair Value Gaps' },
  { term: 'BISI', definition: 'Buy-side Imbalance Sell-side Inefficiency — bullish FVG', category: 'Fair Value Gaps' },
  { term: 'SIBI', definition: 'Sell-side Imbalance Buy-side Inefficiency — bearish FVG', category: 'Fair Value Gaps' },
  { term: 'CE', definition: 'Consequent Encroachment — 50% level of a FVG', category: 'Fair Value Gaps' },

  // Market Structure
  { term: 'BOS', definition: 'Break of Structure — price breaks a significant high/low', category: 'Market Structure' },
  { term: 'CHoCH', definition: 'Change of Character — first sign of trend reversal', category: 'Market Structure' },
  { term: 'MSS', definition: 'Market Structure Shift — confirmed change in market direction', category: 'Market Structure' },
  { term: 'HH', definition: 'Higher High — price makes a new high above previous high', category: 'Market Structure' },
  { term: 'HL', definition: 'Higher Low — price makes a low above previous low', category: 'Market Structure' },
  { term: 'LH', definition: 'Lower High — price makes a high below previous high', category: 'Market Structure' },
  { term: 'LL', definition: 'Lower Low — price makes a new low below previous low', category: 'Market Structure' },

  // Key Levels
  { term: 'PDH', definition: 'Previous Day High — highest price of the previous trading day', category: 'Key Levels' },
  { term: 'PDL', definition: 'Previous Day Low — lowest price of the previous trading day', category: 'Key Levels' },
  { term: 'PWH', definition: 'Previous Week High — highest price of the previous trading week', category: 'Key Levels' },
  { term: 'PWL', definition: 'Previous Week Low — lowest price of the previous trading week', category: 'Key Levels' },
  { term: 'PMH', definition: 'Previous Month High — highest price of the previous month', category: 'Key Levels' },
  { term: 'PML', definition: 'Previous Month Low — lowest price of the previous month', category: 'Key Levels' },

  // Fibonacci
  { term: 'GP', definition: 'Golden Pocket — 0.618–0.65 fibonacci retracement zone, high probability reversal area', category: 'Fibonacci' },
  { term: 'OTE', definition: 'Optimal Trade Entry — 0.62–0.79 fibonacci retracement zone', category: 'Fibonacci' },

  // Entry Patterns
  { term: 'RRT', definition: 'Rounded Retest — price curves back to retest a level with momentum', category: 'Entry Patterns' },
  { term: 'LHPB', definition: 'Last High Pre-Break — the final high before a break of structure', category: 'Entry Patterns' },
  { term: 'QML', definition: 'Quasimodo Level — specific reversal pattern with unequal highs/lows', category: 'Entry Patterns' },

  // Liquidity
  { term: 'BSL', definition: 'Buy-side Liquidity — stop losses above highs that attract price', category: 'Liquidity' },
  { term: 'SSL', definition: 'Sell-side Liquidity — stop losses below lows that attract price', category: 'Liquidity' },
  { term: 'EQH', definition: 'Equal Highs — multiple highs at the same level creating liquidity pool', category: 'Liquidity' },
  { term: 'EQL', definition: 'Equal Lows — multiple lows at the same level creating liquidity pool', category: 'Liquidity' },
  { term: 'LG', definition: 'Liquidity Grab — quick move to take out stops before reversing', category: 'Liquidity' },
  { term: 'SH', definition: 'Stop Hunt — intentional move to trigger stop losses', category: 'Liquidity' },

  // Sessions & Time
  { term: 'KZ', definition: 'Kill Zone — high probability trading window during session opens', category: 'Sessions' },
  { term: 'LKZ', definition: 'London Kill Zone — 2-5am EST, London session open', category: 'Sessions' },
  { term: 'NYKZ', definition: 'New York Kill Zone — 7-10am EST, NY session open', category: 'Sessions' },
  { term: 'LOKZ', definition: 'London Open Kill Zone — same as LKZ', category: 'Sessions' },

  // Other Concepts
  { term: 'SMT', definition: 'Smart Money Technique/Divergence — divergence between correlated pairs', category: 'SMC Concepts' },
  { term: 'AMD', definition: 'Accumulation, Manipulation, Distribution — market cycle phases', category: 'SMC Concepts' },
  { term: 'PO3', definition: 'Power of Three — AMD pattern within a single session', category: 'SMC Concepts' },
  { term: 'ICT', definition: 'Inner Circle Trader — trading methodology/mentor', category: 'SMC Concepts' },
  { term: 'SMC', definition: 'Smart Money Concepts — institutional trading methodology', category: 'SMC Concepts' },
];

type SortField = 'term' | 'category';
type SortDirection = 'asc' | 'desc';

export function GlossaryPage() {
  const [terms, setTerms] = useState<GlossaryTerm[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('term');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  // Form state
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // Store id, not term
  const [editingTermName, setEditingTermName] = useState<string>(''); // For display only
  const [formData, setFormData] = useState({ term: '', definition: '', category: '' });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Load glossary terms
  const loadTerms = async () => {
    try {
      const allTerms = await db.glossary.toArray();

      // Seed default terms if empty
      if (allTerms.length === 0) {
        await db.glossary.bulkAdd(DEFAULT_GLOSSARY_TERMS);
        setTerms(DEFAULT_GLOSSARY_TERMS);
      } else {
        setTerms(allTerms);
      }
    } catch (error) {
      console.error('Failed to load glossary:', error);
      setMessage({ type: 'error', text: 'Failed to load glossary terms.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTerms();
  }, []);

  // Get unique categories
  const categories = useMemo(() => {
    const cats = new Set<string>();
    terms.forEach(t => {
      if (t.category) cats.add(t.category);
    });
    return Array.from(cats).sort();
  }, [terms]);

  // Filter and sort terms
  const filteredTerms = useMemo(() => {
    let result = terms;

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(t =>
        t.term.toLowerCase().includes(query) ||
        t.definition.toLowerCase().includes(query) ||
        (t.category?.toLowerCase().includes(query) ?? false)
      );
    }

    // Sort
    result = [...result].sort((a, b) => {
      let aVal = sortField === 'term' ? a.term : (a.category || '');
      let bVal = sortField === 'term' ? b.term : (b.category || '');

      const cmp = aVal.localeCompare(bVal);
      return sortDirection === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [terms, searchQuery, sortField, sortDirection]);

  // Group by category
  const groupedTerms = useMemo(() => {
    const groups = new Map<string, GlossaryTerm[]>();

    filteredTerms.forEach(term => {
      const cat = term.category || 'Uncategorized';
      if (!groups.has(cat)) {
        groups.set(cat, []);
      }
      groups.get(cat)!.push(term);
    });

    // Sort groups alphabetically
    return new Map([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])));
  }, [filteredTerms]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedCategories(new Set(categories));
  };

  const collapseAll = () => {
    setExpandedCategories(new Set());
  };

  const handleAdd = async () => {
    if (!formData.term.trim() || !formData.definition.trim()) {
      setMessage({ type: 'error', text: 'Term and definition are required.' });
      return;
    }

    // Check for duplicate using where clause (term is no longer primary key)
    const existing = await db.glossary.where('term').equals(formData.term.trim().toUpperCase()).first();
    if (existing) {
      setMessage({ type: 'error', text: `Term "${formData.term}" already exists.` });
      return;
    }

    try {
      const newTerm: GlossaryTerm = {
        term: formData.term.trim().toUpperCase(),
        definition: formData.definition.trim(),
        category: formData.category.trim() || undefined,
      };
      await db.glossary.add(newTerm);
      await loadTerms();
      setFormData({ term: '', definition: '', category: '' });
      setIsAdding(false);
      setMessage({ type: 'success', text: `Added "${newTerm.term}" to glossary.` });
    } catch (error) {
      console.error('Failed to add term:', error);
      setMessage({ type: 'error', text: 'Failed to add term.' });
    }
  };

  const handleEdit = async () => {
    if (!editingId || !formData.definition.trim()) {
      setMessage({ type: 'error', text: 'Definition is required.' });
      return;
    }

    try {
      await db.glossary.update(editingId, {
        definition: formData.definition.trim(),
        category: formData.category.trim() || undefined,
      });
      await loadTerms();
      setEditingId(null);
      setEditingTermName('');
      setFormData({ term: '', definition: '', category: '' });
      setMessage({ type: 'success', text: `Updated "${editingTermName}".` });
    } catch (error) {
      console.error('Failed to update term:', error);
      setMessage({ type: 'error', text: 'Failed to update term.' });
    }
  };

  const handleDelete = async (id: string, termName: string) => {
    if (!confirm(`Delete "${termName}" from glossary?`)) return;

    try {
      await db.glossary.delete(id);
      await loadTerms();
      setMessage({ type: 'success', text: `Deleted "${termName}".` });
    } catch (error) {
      console.error('Failed to delete term:', error);
      setMessage({ type: 'error', text: 'Failed to delete term.' });
    }
  };

  const startEditing = (term: GlossaryTerm) => {
    setEditingId(term.id!);
    setEditingTermName(term.term);
    setFormData({
      term: term.term,
      definition: term.definition,
      category: term.category || '',
    });
    setIsAdding(false);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditingTermName('');
    setIsAdding(false);
    setFormData({ term: '', definition: '', category: '' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Trading Glossary</h1>
          <p className="text-gray-400 mt-1">
            {terms.length} terms across {categories.length} categories
          </p>
        </div>
        <button
          onClick={() => {
            setIsAdding(true);
            setEditingId(null);
            setEditingTermName('');
            setFormData({ term: '', definition: '', category: '' });
          }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          + Add Term
        </button>
      </div>

      {/* Message */}
      {message && (
        <div className={`p-3 rounded-lg ${message.type === 'success' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
          {message.text}
          <button onClick={() => setMessage(null)} className="ml-2 hover:underline">Dismiss</button>
        </div>
      )}

      {/* Add/Edit Form */}
      {(isAdding || editingId) && (
        <div className="bg-gray-800 rounded-lg p-4 space-y-4">
          <h3 className="text-lg font-medium text-white">
            {isAdding ? 'Add New Term' : `Edit "${editingTermName}"`}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Term</label>
              <input
                type="text"
                value={formData.term}
                onChange={(e) => setFormData(prev => ({ ...prev, term: e.target.value }))}
                disabled={!!editingId}
                placeholder="e.g., FVG, OB, BOS"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Category</label>
              <input
                type="text"
                value={formData.category}
                onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
                placeholder="e.g., Order Blocks, Market Structure"
                list="categories"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
              <datalist id="categories">
                {categories.map(cat => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            </div>
            <div className="md:col-span-1">
              <label className="block text-sm font-medium text-gray-300 mb-1">Definition</label>
              <input
                type="text"
                value={formData.definition}
                onChange={(e) => setFormData(prev => ({ ...prev, definition: e.target.value }))}
                placeholder="Full explanation of the term"
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={isAdding ? handleAdd : handleEdit}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
            >
              {isAdding ? 'Add Term' : 'Save Changes'}
            </button>
            <button
              onClick={cancelEdit}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Search and Controls */}
      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search terms, definitions, or categories..."
            className="w-full px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={expandAll}
            className="px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Expand All
          </button>
          <button
            onClick={collapseAll}
            className="px-3 py-2 text-sm text-gray-400 hover:text-white transition-colors"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Grouped Terms */}
      <div className="space-y-4">
        {Array.from(groupedTerms.entries()).map(([category, categoryTerms]) => (
          <div key={category} className="bg-gray-800 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleCategory(category)}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-gray-750 transition-colors"
            >
              <div className="flex items-center gap-2">
                <svg
                  className={`w-4 h-4 text-gray-400 transition-transform ${expandedCategories.has(category) ? 'rotate-90' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                <span className="font-medium text-white">{category}</span>
                <span className="text-sm text-gray-400">({categoryTerms.length})</span>
              </div>
            </button>

            {expandedCategories.has(category) && (
              <div className="border-t border-gray-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-400 bg-gray-750">
                      <th
                        className="px-4 py-2 font-medium cursor-pointer hover:text-white w-32"
                        onClick={() => handleSort('term')}
                      >
                        Term {sortField === 'term' && (sortDirection === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-4 py-2 font-medium">Definition</th>
                      <th className="px-4 py-2 font-medium text-right w-24">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700">
                    {categoryTerms.map(term => (
                      <tr key={term.id || term.term} className="hover:bg-gray-750">
                        <td className="px-4 py-3">
                          <span className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-sm font-mono">
                            {term.term}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-300">{term.definition}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => startEditing(term)}
                              className="p-1 text-gray-400 hover:text-white transition-colors"
                              title="Edit"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDelete(term.id!, term.term)}
                              className="p-1 text-gray-400 hover:text-red-400 transition-colors"
                              title="Delete"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>

      {filteredTerms.length === 0 && (
        <div className="bg-gray-800 rounded-lg p-8 text-center">
          <p className="text-gray-400">
            {searchQuery ? 'No terms match your search.' : 'No glossary terms yet.'}
          </p>
        </div>
      )}
    </div>
  );
}
