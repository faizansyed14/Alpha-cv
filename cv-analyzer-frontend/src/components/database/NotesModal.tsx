import React, { useState, useEffect } from 'react';
import { MessageSquare, Trash2, Send, Loader2, User } from 'lucide-react';
import { api } from '@/lib/api';

interface NotesModalProps {
    cvId: string;
    cvName?: string;
    onClose: () => void;
}

const formatDate = (dateString?: string) => {
    if (!dateString) return 'Just now';
    try {
        const d = new Date(dateString);
        return (
            d.toLocaleDateString() +
            ' ' +
            d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        );
    } catch {
        return 'N/A';
    }
};

export function NotesModal({ cvId, cvName, onClose }: NotesModalProps) {
    const [notes, setNotes] = useState<any[]>([]);
    const [newNote, setNewNote] = useState('');
    const [loading, setLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        const loadNotes = async () => {
            try {
                setLoading(true);
                const response = await api.getNotes(cvId);
                setNotes(response.notes || []);
            } catch (err) {
                console.error('Failed to load notes', err);
            } finally {
                setLoading(false);
            }
        };
        if (cvId) {
            loadNotes();
        }
    }, [cvId]);

    const handleSaveNote = async () => {
        if (!newNote.trim()) return;

        try {
            setIsSubmitting(true);
            const user = JSON.parse(localStorage.getItem('user_profile') || '{}');
            const hrUser = user.username || user.email || 'HR';

            await api.addNote(cvId, newNote, hrUser);

            // Refresh notes
            const response = await api.getNotes(cvId);
            setNotes(response.notes || []);
            setNewNote('');
        } catch (err) {
            console.error('Failed to save note', err);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteNote = async (hrUser: string) => {
        if (!confirm('Are you sure you want to delete this note?')) return;

        try {
            await api.deleteNote(cvId, hrUser);
            // Refresh notes
            const response = await api.getNotes(cvId);
            setNotes(response.notes || []);
        } catch (err) {
            console.error('Failed to delete note', err);
        }
    };

    return (
        <div className="flex flex-col h-full max-h-[600px]">
            <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-[300px]">
                {loading ? (
                    <div className="flex justify-center items-center h-full">
                        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                    </div>
                ) : notes.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
                            <MessageSquare className="h-5 w-5 text-gray-400" />
                        </div>
                        <p className="text-sm font-medium text-gray-900">No notes yet</p>
                        <p className="mt-1 text-[13px] text-gray-500">Add a note to start the discussion.</p>
                    </div>
                ) : (
                    notes.map((note: any, i: number) => (
                        <div
                            key={i}
                            className="group rounded-md border border-gray-200 bg-white p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2">
                                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-50">
                                        <User className="h-3.5 w-3.5 text-brand-600" />
                                    </span>
                                    <div className="leading-tight">
                                        <span className="text-[13px] font-medium text-gray-900">{note.hr_user}</span>
                                        <span className="ml-2 text-xs text-gray-500">
                                            {formatDate(note.updated_at || note.created_at)}
                                        </span>
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleDeleteNote(note.hr_user)}
                                    className="rounded p-1 text-gray-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                                    title="Delete note"
                                >
                                    <Trash2 className="h-4 w-4" />
                                </button>
                            </div>
                            <p className="mt-2 whitespace-pre-wrap pl-8 text-[13px] leading-relaxed text-gray-700">
                                {note.note}
                            </p>
                        </div>
                    ))
                )}
            </div>

            <div className="border-t border-gray-200 bg-white p-4">
                <div className="relative">
                    <textarea
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        placeholder={`Add a note for ${cvName || 'this candidate'}...`}
                        className="w-full resize-none rounded-md border border-gray-300 p-3 pr-12 text-[13px] text-gray-900 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
                        rows={3}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSaveNote();
                            }
                        }}
                    />
                    <button
                        onClick={handleSaveNote}
                        disabled={!newNote.trim() || isSubmitting}
                        className={`absolute bottom-3 right-3 flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
                            !newNote.trim() || isSubmitting
                                ? 'bg-gray-100 text-gray-400'
                                : 'bg-brand-600 text-white hover:bg-brand-700'
                        }`}
                    >
                        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    </button>
                </div>
                <div className="mt-2 text-right text-xs text-gray-400">
                    Press Enter to send, Shift+Enter for new line
                </div>
            </div>
        </div>
    );
}
