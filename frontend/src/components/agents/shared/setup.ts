export type JdSource = 'library' | 'pasted' | 'uploaded';
export type CvMode = 'none' | 'library' | 'uploaded';
export interface UploadedText { filename: string; text: string; chars: number }

/** What the person has attached to a new chat: the job description, and (interview agent) a candidate CV. */
export interface SetupState {
  jdSource: JdSource;
  libraryId: string;
  pastedText: string;
  uploaded: UploadedText | null;
  cvMode: CvMode;
  cvLibraryId: string;
  cvUploaded: UploadedText | null;
}

export const EMPTY_SETUP: SetupState = {
  jdSource: 'library', libraryId: '', pastedText: '', uploaded: null, cvMode: 'none', cvLibraryId: '', cvUploaded: null,
};

export function jdReady(s: SetupState): boolean {
  return s.jdSource === 'library' ? !!s.libraryId : s.jdSource === 'pasted' ? s.pastedText.trim().length > 0 : !!s.uploaded;
}

export function cvReady(s: SetupState): boolean {
  return s.cvMode === 'library' ? !!s.cvLibraryId : s.cvMode === 'uploaded' ? !!s.cvUploaded : false;
}
