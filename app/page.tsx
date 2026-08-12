import CreateEventForm from '@/components/CreateEventForm';
import StarBanner from '@/components/StarBanner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default function CreatePage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      {/* Centres rather than baselines: the banner is a filled box, and a box
          sat on the title's baseline hangs below it. Below sm: the title claims
          the whole line so its text has the full column to centre in, which
          also drops the banner onto a line of its own at full width. */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h1 className="w-full text-center text-2xl font-bold tracking-tight sm:w-auto sm:text-left sm:text-[1.75rem]">
          days2meet
        </h1>
        <StarBanner className="min-w-0 grow sm:grow-0" />
      </div>
      <CreateEventForm />
    </main>
  );
}
