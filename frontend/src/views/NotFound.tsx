
import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <h1 className="font-serif text-[clamp(92px,18vw,220px)] font-normal leading-none tracking-[-.08em] text-neutral-800">404</h1>
      <h2 className="mt-3 text-3xl font-medium tracking-[-.04em]">Page Not Found</h2>
      <p className="mb-8 mt-4 max-w-md text-neutral-700">
        The arena path you requested does not exist or has been removed.
      </p>
      <Link
        to="/"
        className="metal-button-solid"
      >
        Return Home
      </Link>
    </div>
  );
}
