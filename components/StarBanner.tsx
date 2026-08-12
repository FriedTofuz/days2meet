/** Exported so the event header's GitHub icon points at the same place this does. */
export const REPO_URL = 'https://github.com/MeagerPotato/days2meet';

interface Props {
  className?: string;
}

/**
 * Only ever rendered where someone is setting an event up. A respondent opening
 * a shared link is mid-task, and a favour asked there is noise between them and
 * the grid.
 *
 * The colours are `.btn-edit` from globals.css spelled out, because a banner is
 * not a button and should not answer to the button class.
 */
export default function StarBanner({ className = '' }: Props) {
  return (
    <p
      className={`flex flex-wrap items-baseline gap-x-1.5 rounded-lg border border-[#8fd4ae] bg-[#d9f2e4] px-3 py-2 text-[0.8125rem] leading-relaxed text-[#0f4c33] ${className}`}
    >
      <span>days2meet is open source.</span>
      <a
        className="font-semibold underline underline-offset-2"
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        Star it on GitHub
      </a>
    </p>
  );
}
