import { entryOriginLinks } from '../source-search-bridge.ts';
import '../styles/source-search-bridge.css';

/** Opens the website behind a result and the work's own page there, in a new tab. */
export function SourceOriginLinks({ entry }: { entry: { metadata?: Record<string, unknown> | undefined } }) {
  const { site, page } = entryOriginLinks(entry);
  if (!site && !page) return null;
  return (
    <span className="source-origin-links">
      {page && (
        <a className="source-bridge-link" href={page} target="_blank" rel="noopener noreferrer">
          原页 ↗
        </a>
      )}
      {site && site !== page && (
        <a className="source-bridge-link" href={site} target="_blank" rel="noopener noreferrer">
          原站 ↗
        </a>
      )}
    </span>
  );
}
