"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty">
      <h1>The catalog could not be loaded.</h1>
      <p>
        Check filesystem permissions and APS_STUDIO_ROOT. No studio files were
        changed.
      </p>
      <button className="primary-button" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
