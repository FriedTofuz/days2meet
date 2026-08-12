/** Exported so the event header's GitHub icon points at the same place this does. */
export const REPO_URL = 'https://github.com/MeagerPotato/days2meet';

interface Props {
  className?: string;
  /**
   * Sized and centred as `.btn-primary`'s twin — same box, same type — for the
   * phone layout, where the banner sits directly above the submit button and
   * has to read as part of that stack rather than as a stray line of prose.
   */
  buttonSized?: boolean;
}

/**
 * Only ever rendered where someone is setting an event up. A respondent opening
 * a shared link is mid-task, and a favour asked there is noise between them and
 * the grid.
 *
 * The colours are `.btn-edit` from globals.css spelled out, because a banner is
 * not a button and should not answer to the button class.
 */
export default function StarBanner({ className = '', buttonSized = false }: Props) {
  return (
    <p
      className={`flex flex-wrap rounded-lg border border-[#8fd4ae] bg-[#d9f2e4] text-[#0f4c33] ${
        buttonSized
          ? // The padding, size, weight and line height are .btn/.btn-primary's
            // own numbers, so the two boxes come out the same height to the pixel.
            'items-center justify-center gap-x-1.5 px-4 py-[0.5625rem] text-[0.875rem] font-medium leading-normal'
          : 'items-baseline gap-x-1.5 px-3 py-2 text-[0.8125rem] leading-relaxed'
      } ${className}`}
    >
      <span>days2meet is open source.</span>
      <a
        className={`underline underline-offset-2 ${buttonSized ? '' : 'font-semibold'}`}
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        Star it on GitHub
      </a>
    </p>
  );
}
