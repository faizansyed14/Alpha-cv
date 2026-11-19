import { describe, expect, it } from 'vitest';
import { toBlocks } from './NoticePopup';

describe('the notice message', () => {
  it('turns the admin\'s numbered points into a heading and a numbered list', () => {
    const message = 'New Updates:\n\n1. Added age of cvs\n2. filter for all AUH and DXB job posts in Careers page\n3. Added new notification service\n4. Added Show  all Jobs in each job page';
    expect(toBlocks(message)).toEqual([
      { kind: 'p', text: 'New Updates:' },
      { kind: 'ol', items: [
        { n: '1', text: 'Added age of cvs' },
        { n: '2', text: 'filter for all AUH and DXB job posts in Careers page' },
        { n: '3', text: 'Added new notification service' },
        { n: '4', text: 'Added Show  all Jobs in each job page' },
      ] },
    ]);
  });

  it('reads bullets, keeps paragraphs apart and ignores Windows line endings', () => {
    expect(toBlocks('Hello team\r\n- one\r\n• two\r\n\r\nThanks')).toEqual([
      { kind: 'p', text: 'Hello team' },
      { kind: 'ul', items: ['one', 'two'] },
      { kind: 'p', text: 'Thanks' },
    ]);
  });

  it('keeps a one-line message as one paragraph', () => {
    expect(toBlocks('The system will be down at 6 pm.')).toEqual([{ kind: 'p', text: 'The system will be down at 6 pm.' }]);
  });
});
